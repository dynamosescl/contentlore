// ================================================================
// functions/api/admin/creators/enrich-batch.js
// POST /api/admin/creators/enrich-batch
// Paginated bio enrichment. Designed for a client-side loop that
// processes all creators in chunks of ~10.
//
// Auth: X-Admin-Password required.
//
// Body:
//   { offset: 0,           // skip this many
//     batch: 10,           // process this many in one call
//     mode: 'low_quality'  // 'low_quality' | 'empty_only' | 'all'
//   }
//
// Response includes total count so the client can report progress.
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../../_lib.js';

const EDITORIAL_PROMPT = `You are writing a short editorial bio for ContentLore, a scene publication that covers UK streaming culture.

Voice: confident, scene-literate, declarative. Written by someone who watches this stuff themselves. Think Letterboxd or The Face in its digital era — not Deloitte, not a trade press entry. Warm but not gushing. No first person. No emoji. No hashtags. No superlatives like "incredible" or "amazing". Use British English (specialising not specializing, colour not color).

Length: 1-2 sentences, 80-180 characters total.

Output rules:
- Return ONLY the bio text.
- No quotation marks around the output.
- No preamble like "Here is the bio" or "Bio:".
- No explanation after.
- If the creator's existing bio contains their own distinctive voice, lightly preserve it rather than sanding it off.

Example good outputs:
- "Twitch variety streamer from London, best known for long-form Just Chatting and late-night community raids."
- "Kick-based IRL broadcaster covering fishing, camping and slow travel across the UK."
- "South London streamer running one of the most-watched UK GTA RP characters on NoPixel."`;

// Heuristic: detect the templated "UK-based X streamer specialising in Y" pattern
// that's on ~90% of current bios. These are high-value rewrite targets.
const TEMPLATED_PATTERN = /(?:UK-based|UK based)\s+(?:Twitch|Kick|variety|streamer)\s+(?:streamer\s+)?(?:who\s+(?:is\s+)?|that\s+)?(?:specialising|specializing|known|focused|active)\s+(?:in|on|for)/i;
const COMMUNITY_ENGAGEMENT_PATTERN = /community\s+engagement|community-focused|building community|through conversational/i;

function isLowQuality(bio) {
  if (!bio || bio.length < 40) return true;
  if (TEMPLATED_PATTERN.test(bio)) return true;
  if (COMMUNITY_ENGAGEMENT_PATTERN.test(bio)) return true;
  // Very short bios = low quality
  if (bio.length < 60) return true;
  return false;
}

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try { body = await request.json(); } catch { /* fine */ }
  const offset = parseInt(body?.offset || 0, 10);
  const batch = Math.min(parseInt(body?.batch || 10, 10), 15);
  const mode = body?.mode || 'low_quality';
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return jsonResponse({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);
  }

  try {
    // Get overall total first
    const totalRes = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM creators WHERE role = 'creator'
    `).first();
    const totalCreators = totalRes?.n || 0;

    // Pull this batch. ORDER BY id for stable pagination across calls.
    const targetsRes = await env.DB.prepare(`
      SELECT c.id, c.display_name, c.bio, c.categories, cp.platform, cp.handle
      FROM creators c
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE c.role = 'creator'
      ORDER BY c.id ASC
      LIMIT ? OFFSET ?
    `).bind(batch, offset).all();

    const targets = targetsRes.results || [];

    if (targets.length === 0) {
      return jsonResponse({
        ok: true,
        done: true,
        processed: 0,
        enriched: 0,
        skipped: 0,
        offset,
        next_offset: offset,
        total_creators: totalCreators,
        message: 'No more creators to process',
      });
    }

    let enriched = 0;
    let skipped = 0;
    const errors = [];
    const errorCounts = {
      claude_api_error: 0,
      claude_empty_response: 0,
      bio_too_short: 0,
      profanity_blocked: 0,
      db_update_failed: 0,
      unknown_error: 0,
    };
    const samples = [];

    console.log(`[enrich-batch] starting offset=${offset} batch=${targets.length} mode=${mode}`);

    for (const t of targets) {
      // Mode filter
      if (mode === 'low_quality' && !isLowQuality(t.bio)) {
        skipped++;
        continue;
      }
      if (mode === 'empty_only' && (t.bio && t.bio.length >= 40)) {
        skipped++;
        continue;
      }
      // mode === 'all' processes everything

      try {
        const userPrompt = `Creator info:
Name: ${t.display_name}
Platform: ${t.platform || 'unknown'}
Handle: ${t.handle || t.id}
Categories: ${t.categories || 'not specified'}
Current bio (may be empty or templated): ${t.bio || '[empty]'}`;

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: EDITORIAL_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });

        if (!claudeRes.ok) {
          const errBody = await claudeRes.text();
          errorCounts.claude_api_error++;
          errors.push({ id: t.id, category: 'claude_api_error', status: claudeRes.status, body: errBody.substring(0, 200) });
          continue;
        }

        const claudeData = await claudeRes.json();
        const contentBlocks = Array.isArray(claudeData?.content) ? claudeData.content : [];
        const textBlock = contentBlocks.find(b => b?.type === 'text');
        const newBio = textBlock?.text?.trim() || '';

        if (!newBio) {
          errorCounts.claude_empty_response++;
          errors.push({ id: t.id, category: 'claude_empty_response', stop_reason: claudeData?.stop_reason });
          continue;
        }
        if (newBio.length < 30) {
          errorCounts.bio_too_short++;
          errors.push({ id: t.id, category: 'bio_too_short', bio_length: newBio.length });
          continue;
        }

        // Only block actual slurs
        const blocked = /\b(cunt|nigger|faggot|retard|tranny)\b/i;
        if (blocked.test(newBio)) {
          errorCounts.profanity_blocked++;
          errors.push({ id: t.id, category: 'profanity_blocked' });
          continue;
        }

        try {
          await env.DB
            .prepare(`UPDATE creators SET bio = ?, updated_at = unixepoch() WHERE id = ?`)
            .bind(newBio, t.id)
            .run();
        } catch (dbErr) {
          errorCounts.db_update_failed++;
          errors.push({ id: t.id, category: 'db_update_failed', error: String(dbErr?.message || dbErr) });
          continue;
        }

        enriched++;
        if (samples.length < 3) {
          samples.push({ id: t.id, display_name: t.display_name, new_bio: newBio });
        }
      } catch (e) {
        errorCounts.unknown_error++;
        errors.push({ id: t.id, category: 'unknown_error', error: String(e?.message || e) });
      }
    }

    console.log(`[enrich-batch] complete enriched=${enriched} skipped=${skipped} errors=${errors.length}`);

    return jsonResponse({
      ok: true,
      done: (offset + targets.length) >= totalCreators,
      processed: targets.length,
      enriched,
      skipped,
      errors: errors.length,
      error_counts: errorCounts,
      error_sample: errors.slice(0, 3),
      samples,
      offset,
      next_offset: offset + targets.length,
      total_creators: totalCreators,
      progress_pct: Math.round(((offset + targets.length) / totalCreators) * 100),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

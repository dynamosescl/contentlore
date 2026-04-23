// ================================================================
// functions/api/admin/creators/enrich-all.js
// POST /api/admin/creators/enrich-all
// Runs Claude Haiku over up to N creators with empty/short bios,
// rewriting them in editorial voice. UK English, no profanity.
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth, parseBoundedInt } from '../../../_lib.js';

const EDITORIAL_PROMPT = `You are writing a short editorial bio for ContentLore, a scene publication that covers UK streaming culture.

Voice: confident, scene-literate, declarative. Written by someone who watches this stuff themselves. Think Letterboxd or The Face in its digital era \u2014 not Deloitte, not a trade press entry. Warm but not gushing. No first person. No emoji. No hashtags. No superlatives like "incredible" or "amazing". Use British English (specialising not specializing, colour not color).

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

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* no body fine */
  }
  const max = parseBoundedInt(body?.max, 10, 1, 25);
  const onlyEmpty = body?.only_empty !== false; // default true
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return jsonResponse({
      ok: false,
      error: 'ANTHROPIC_API_KEY not configured',
    }, 500);
  }

  try {
    // Find targets
    let sql;
    if (onlyEmpty) {
      sql = `
        SELECT c.id, c.display_name, c.bio, c.categories, cp.platform, cp.handle
        FROM creators c
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE c.role = 'creator' 
          AND (c.bio IS NULL OR LENGTH(c.bio) < 40)
        ORDER BY c.updated_at ASC
        LIMIT ?
      `;
    } else {
      sql = `
        SELECT c.id, c.display_name, c.bio, c.categories, cp.platform, cp.handle
        FROM creators c
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE c.role = 'creator'
        ORDER BY c.updated_at ASC
        LIMIT ?
      `;
    }
    const targetsResult = await env.DB.prepare(sql).bind(max).all();
    const targets = targetsResult.results || [];

    if (targets.length === 0) {
      return jsonResponse({
        ok: true,
        processed: 0,
        enriched: 0,
        claude_rewrites: 0,
        message: 'No creators matched the criteria',
      });
    }

    let enriched = 0;
    let claudeRewrites = 0;
    const errors = [];
    const sample = [];
    const errorCounts = {
      claude_api_error: 0,
      claude_empty_response: 0,
      bio_too_short: 0,
      profanity_blocked: 0,
      db_update_failed: 0,
      unknown_error: 0,
    };

    console.log(`[enrich-all] starting batch of ${targets.length} creators`);

    for (const t of targets) {
      try {
        const userPrompt = `Creator info:
Name: ${t.display_name}
Platform: ${t.platform || 'unknown'}
Handle: ${t.handle || t.id}
Categories: ${t.categories || 'not specified'}
Current bio (may be empty or raw): ${t.bio || '[empty]'}`;

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
          console.log(`[enrich-all] claude api error for ${t.id}: ${claudeRes.status}`);
          errorCounts.claude_api_error++;
          errors.push({
            id: t.id,
            category: 'claude_api_error',
            claude_status: claudeRes.status,
            body: errBody.substring(0, 300),
          });
          continue;
        }

        const claudeData = await claudeRes.json();

        // Defensive: Claude can return content: [] on edge cases
        const contentBlocks = Array.isArray(claudeData?.content) ? claudeData.content : [];
        const textBlock = contentBlocks.find(b => b?.type === 'text');
        const newBio = textBlock?.text?.trim() || '';

        if (!newBio) {
          console.log(`[enrich-all] claude returned empty response for ${t.id}, stop_reason=${claudeData?.stop_reason}`);
          errorCounts.claude_empty_response++;
          errors.push({
            id: t.id,
            category: 'claude_empty_response',
            stop_reason: claudeData?.stop_reason || 'unknown',
          });
          continue;
        }

        if (newBio.length < 20) {
          console.log(`[enrich-all] bio too short for ${t.id}: ${newBio.length} chars`);
          errorCounts.bio_too_short++;
          errors.push({
            id: t.id,
            category: 'bio_too_short',
            bio_length: newBio.length,
            bio_preview: newBio,
          });
          continue;
        }

        // Profanity filter \u2014 only block genuine slurs and the worst language.
        // Mild words like "shit" appear legitimately in creator coverage.
        const blocked = /\b(cunt|nigger|faggot|retard|tranny)\b/i;
        if (blocked.test(newBio)) {
          console.log(`[enrich-all] profanity filter blocked bio for ${t.id}`);
          errorCounts.profanity_blocked++;
          errors.push({
            id: t.id,
            category: 'profanity_blocked',
            bio_preview: newBio.substring(0, 100),
          });
          continue;
        }

        try {
          await env.DB
            .prepare(`UPDATE creators SET bio = ?, updated_at = unixepoch() WHERE id = ?`)
            .bind(newBio, t.id)
            .run();
        } catch (dbErr) {
          console.log(`[enrich-all] db update failed for ${t.id}: ${dbErr?.message || dbErr}`);
          errorCounts.db_update_failed++;
          errors.push({
            id: t.id,
            category: 'db_update_failed',
            error: String(dbErr?.message || dbErr),
          });
          continue;
        }

        enriched++;
        claudeRewrites++;
        if (sample.length < 3) {
          sample.push({ id: t.id, bio: newBio.substring(0, 200) });
        }
      } catch (e) {
        console.log(`[enrich-all] unknown error for ${t.id}: ${e?.message || e}`);
        errorCounts.unknown_error++;
        errors.push({
          id: t.id,
          category: 'unknown_error',
          error: String(e?.message || e),
        });
      }
    }

    console.log(`[enrich-all] complete: enriched=${enriched}, errors=${errors.length}, breakdown=${JSON.stringify(errorCounts)}`);

    return jsonResponse({
      ok: true,
      processed: targets.length,
      enriched,
      claude_rewrites: claudeRewrites,
      error_counts: errorCounts,
      errors,
      sample,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/admin/creators/enrich-all.js
// POST /api/admin/creators/enrich-all
// Runs Claude Haiku over up to N creators with empty/short bios,
// rewriting them in editorial voice. UK English, no profanity.
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../../_lib.js';

const EDITORIAL_PROMPT = `You are writing a short editorial bio for a UK streaming-talent directory.

Voice: factual, warm, consulting-grade. Sounds like a Deloitte or Oliver Wyman trade-publication entry describing a talent. No first person. No emoji. No hashtags. No superlatives like "incredible" or "amazing". No profanity or crude language. Use British English spelling (specialising not specializing, colour not color).

Length: 1-2 sentences, 80-180 characters total.

Output rules:
- Return ONLY the bio text.
- No quotation marks around the output.
- No preamble like "Here is the bio" or "Bio:".
- No explanation after.

Example good outputs:
- "UK-based Twitch streamer known for Just Chatting content and community engagement."
- "UK variety streamer specialising in high-energy gaming content and community raids."
- "UK-based Kick broadcaster known for IRL outdoor streams spanning fishing, camping, and travel."`;

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* no body fine */
  }
  const max = Math.min(parseInt(body?.max || 10, 10), 25);
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
          errors.push({
            id: t.id,
            claude_status: claudeRes.status,
            body: errBody.substring(0, 300),
          });
          continue;
        }

        const claudeData = await claudeRes.json();
        const newBio = claudeData?.content?.[0]?.text?.trim();
        if (!newBio || newBio.length < 20) {
          errors.push({ id: t.id, reason: 'bio too short from Claude' });
          continue;
        }

        // Safety: filter profanity as a final guard
        const blocked = /\b(cunt|fuck|shit|twat|wanker)\b/i;
        if (blocked.test(newBio)) {
          errors.push({ id: t.id, reason: 'profanity filter triggered' });
          continue;
        }

        await env.DB
          .prepare(`UPDATE creators SET bio = ?, updated_at = unixepoch() WHERE id = ?`)
          .bind(newBio, t.id)
          .run();

        enriched++;
        claudeRewrites++;
        if (sample.length < 3) {
          sample.push({ id: t.id, bio: newBio.substring(0, 200) });
        }
      } catch (e) {
        errors.push({ id: t.id, error: String(e?.message || e) });
      }
    }

    return jsonResponse({
      ok: true,
      processed: targets.length,
      enriched,
      claude_rewrites: claudeRewrites,
      errors,
      sample,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

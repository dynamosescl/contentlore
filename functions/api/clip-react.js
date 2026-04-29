// ================================================================
// functions/api/clip-react.js
// POST /api/clip-react   { clip_id, emoji, undo?: boolean }
//
// Increments (or decrements when `undo` is true) the count for one
// clip + emoji combination. Per-device de-duplication is enforced by
// localStorage on the client (`cl:react:v1`); the server only enforces
// a per-IP rate limit and validates the emoji against the allowlist.
//
// Allowed emoji: 🔥 😂 😱 ❤️
// Rate limit:   30 reactions / IP / UTC day in KV
// ================================================================

import { jsonResponse } from '../_lib.js';

const ALLOWED_EMOJI = new Set(['🔥', '😂', '😱', '❤️']);
const DAILY_RL = 30;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid json' }, 400);
  }

  const clipId = String(body?.clip_id || '').trim();
  const emoji = String(body?.emoji || '').trim();
  const undo = body?.undo === true;

  if (!clipId || clipId.length > 200) {
    return jsonResponse({ ok: false, error: 'missing or invalid clip_id' }, 400);
  }
  if (!ALLOWED_EMOJI.has(emoji)) {
    return jsonResponse({ ok: false, error: 'unsupported emoji' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ymd = new Date().toISOString().slice(0, 10);
  const rlKey = `react:rl:${ip}:${ymd}`;

  try {
    const current = parseInt((await env.KV.get(rlKey)) || '0', 10);
    if (current >= DAILY_RL) {
      return jsonResponse({ ok: false, error: 'rate limited — try again tomorrow' }, 429);
    }
    await env.KV.put(rlKey, String(current + 1), { expirationTtl: 90_000 });
  } catch {
    // KV unavailable — allow through; rate limit is best-effort
  }

  try {
    if (undo) {
      // Decrement; floor at 0. We keep the row even at zero — easier accounting.
      await env.DB.prepare(
        `UPDATE clip_reactions
            SET count = MAX(count - 1, 0),
                updated_at = unixepoch()
          WHERE clip_id = ? AND emoji = ?`
      ).bind(clipId, emoji).run();
    } else {
      // INSERT new row at 1, or bump existing by 1.
      await env.DB.prepare(
        `INSERT INTO clip_reactions (clip_id, emoji, count, updated_at)
         VALUES (?, ?, 1, unixepoch())
         ON CONFLICT(clip_id, emoji) DO UPDATE
            SET count = count + 1,
                updated_at = unixepoch()`
      ).bind(clipId, emoji).run();
    }

    const row = await env.DB.prepare(
      `SELECT count FROM clip_reactions WHERE clip_id = ? AND emoji = ?`
    ).bind(clipId, emoji).first();

    return jsonResponse({
      ok: true,
      clip_id: clipId,
      emoji,
      count: row?.count ?? 0,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

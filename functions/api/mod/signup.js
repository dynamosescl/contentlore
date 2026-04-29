// ================================================================
// functions/api/mod/signup.js
// POST /api/mod/signup
//
// Public, KV-rate-limited (3 sign-ups / IP / UTC day) creator-mod
// signup. Validates the requested creators against the curated
// allowlist, generates a 32-char hex token, INSERTs a row in
// mod_accounts with status='pending'. The token is NOT returned to
// the signup caller — it's surfaced once when an admin approves the
// account in /mod/.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { generateToken } from '../../_mod-auth.js';
import { getHandlesSet } from '../../_curated.js';

const DAILY_RL = 3;

function sanitiseHandle(s) {
  if (!s) return null;
  const cleaned = String(s).trim().replace(/^https?:\/\/[^\/]+\//, '').replace(/^@/, '').split('/')[0].split('?')[0];
  if (!cleaned) return null;
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ymd = new Date().toISOString().slice(0, 10);
  const rlKey = `mod:signup:rl:${ip}:${ymd}`;

  try {
    const used = parseInt((await env.KV.get(rlKey)) || '0', 10);
    if (used >= DAILY_RL) {
      return jsonResponse({ ok: false, error: 'rate limited — try again tomorrow' }, 429);
    }
    await env.KV.put(rlKey, String(used + 1), { expirationTtl: 90_000 });
  } catch { /* best-effort */ }

  // Honeypot — we add a hidden field on the form. Anything filled is a bot.
  if (body.hp) return jsonResponse({ ok: true, queued: true });

  const display = String(body.display_name || '').trim();
  if (!display || display.length < 2 || display.length > 80) {
    return jsonResponse({ ok: false, error: 'display name 2-80 chars required' }, 400);
  }

  const twitch = sanitiseHandle(body.twitch_handle);
  const kick   = sanitiseHandle(body.kick_handle);
  if (!twitch && !kick) {
    return jsonResponse({ ok: false, error: 'at least one of twitch/kick handle is required' }, 400);
  }

  const message = String(body.message || '').slice(0, 800).trim() || null;

  // Validate creator handles against the curated allowlist.
  const requested = Array.isArray(body.creators_modded) ? body.creators_modded : [];
  if (!requested.length) {
    return jsonResponse({ ok: false, error: 'pick at least one creator you mod for' }, 400);
  }
  const handles = await getHandlesSet(env);
  const validated = [...new Set(requested.map(h => String(h).toLowerCase()))]
    .filter(h => handles.has(h));
  if (!validated.length) {
    return jsonResponse({ ok: false, error: 'none of the picked creators are tracked' }, 400);
  }
  if (validated.length > 10) {
    return jsonResponse({ ok: false, error: 'too many creators (max 10)' }, 400);
  }

  // Issue token + insert.
  const token = generateToken();
  try {
    await env.DB.prepare(
      `INSERT INTO mod_accounts (twitch_handle, kick_handle, display_name, creators_modded, message, token, xp, level, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'rookie', 'pending')`
    ).bind(twitch, kick, display, JSON.stringify(validated), message, token).run();

    return jsonResponse({
      ok: true,
      queued: true,
      message: 'Signup received. An admin will review shortly. You\'ll get your access token at approval.',
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'signup failed: ' + String(err?.message || err) }, 500);
  }
}

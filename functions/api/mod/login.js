// ================================================================
// functions/api/mod/login.js
// POST /api/mod/login
//
// Body: { token: "..." }
// Validates the token via the requireMod helper and returns a
// public-safe mod profile (token-stripped). Used by /moderators/login
// to validate before persisting the token in localStorage.
//
// Returns 401 if token is invalid, 403 if pending/suspended, 200 if
// verified.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, publicMod } from '../../_mod-auth.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const token = String(body?.token || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(token)) {
    return jsonResponse({ ok: false, error: 'invalid token format' }, 401);
  }

  const row = await env.DB.prepare(
    `SELECT * FROM mod_accounts WHERE token = ? LIMIT 1`
  ).bind(token).first();
  if (!row) {
    return jsonResponse({ ok: false, error: 'token not recognised' }, 401);
  }

  const mod = hydrate(row);
  if (mod.status === 'suspended') {
    return jsonResponse({ ok: false, error: 'account suspended' }, 403);
  }
  if (mod.status === 'pending') {
    return jsonResponse({ ok: false, error: 'account pending admin approval', status: 'pending' }, 403);
  }

  // Touch last_active.
  try {
    await env.DB.prepare(
      `UPDATE mod_accounts SET last_active = unixepoch() WHERE id = ?`
    ).bind(mod.id).run();
  } catch { /* swallow */ }

  return jsonResponse({ ok: true, mod: publicMod(mod) });
}

// ================================================================
// functions/api/admin/moderators.js
// GET /api/admin/moderators         — list mods (filter by ?status=)
// PUT /api/admin/moderators         — body { id, action }
//   action ∈ 'approve' | 'suspend' | 'reactivate' | 'rotate_token'
//
// Bearer-authed via env.ADMIN_TOKEN. Surfaces every mod row plus the
// token (admins need it to relay to the mod). Approve moves
// pending → verified. Suspend hides the account from all surfaces.
// rotate_token issues a new token — used if a mod's leaked theirs.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, generateToken } from '../../_mod-auth.js';

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/, '').trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, error: 'Unauthorised' }, 401);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  const where = status && ['pending', 'verified', 'suspended'].includes(status) ? `WHERE status = ?` : '';
  const stmt = where
    ? env.DB.prepare(`SELECT * FROM mod_accounts ${where} ORDER BY created_at DESC LIMIT 500`).bind(status)
    : env.DB.prepare(`SELECT * FROM mod_accounts ORDER BY created_at DESC LIMIT 500`);

  const res = await stmt.all();
  const rows = (res.results || []).map(r => {
    const m = hydrate(r);
    // Admin sees the token (they need to relay it to the mod). Don't
    // strip it like publicMod does for end-user views.
    return {
      ...m,
      message: r.message || null,
    };
  });

  // Quick counts so the panel can show 'pending: 3 / verified: 12'
  // without a second query.
  const counts = { pending: 0, verified: 0, suspended: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  return jsonResponse({ ok: true, count: rows.length, counts, mods: rows });
}

export async function onRequestPut({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const id = parseInt(body?.id, 10);
  const action = String(body?.action || '');
  if (!id) return jsonResponse({ ok: false, error: 'id required' }, 400);

  const row = await env.DB.prepare(`SELECT * FROM mod_accounts WHERE id = ?`).bind(id).first();
  if (!row) return jsonResponse({ ok: false, error: 'mod not found' }, 404);

  if (action === 'approve') {
    await env.DB.prepare(
      `UPDATE mod_accounts SET status = 'verified' WHERE id = ?`
    ).bind(id).run();
    return jsonResponse({ ok: true, id, status: 'verified', token: row.token });
  }
  if (action === 'suspend') {
    await env.DB.prepare(
      `UPDATE mod_accounts SET status = 'suspended' WHERE id = ?`
    ).bind(id).run();
    return jsonResponse({ ok: true, id, status: 'suspended' });
  }
  if (action === 'reactivate') {
    await env.DB.prepare(
      `UPDATE mod_accounts SET status = 'verified' WHERE id = ?`
    ).bind(id).run();
    return jsonResponse({ ok: true, id, status: 'verified' });
  }
  if (action === 'rotate_token') {
    const newToken = generateToken();
    await env.DB.prepare(
      `UPDATE mod_accounts SET token = ? WHERE id = ?`
    ).bind(newToken, id).run();
    return jsonResponse({ ok: true, id, token: newToken });
  }

  return jsonResponse({ ok: false, error: 'unknown action' }, 400);
}

// CORS preflight + alias POST → PUT for caller convenience.
export async function onRequestPost(ctx) {
  return onRequestPut(ctx);
}
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ================================================================
// functions/api/mod/push-subscribe.js
// POST /api/mod/push-subscribe
//
// Body:  { subscription: PushSubscriptionJSON }
// Auth:  Authorization: Bearer <mod-token>
//
// Variant of /api/push/subscribe that links the row to the
// authenticated mod_accounts.id. Filter handles auto-set to the mod's
// creators_modded so the scheduler can route mod-specific copy via
// the existing per-handle fanout.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod } from '../../_mod-auth.js';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return jsonResponse({ ok: false, error: 'invalid subscription' }, 400);
  }

  const filter = mod.creators_modded.length
    ? mod.creators_modded.join(',')
    : 'all';
  const uuid = `mod-${mod.id}`; // fixed per-mod uuid so duplicate subscribes still upsert
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 256);
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO push_subscriptions
        (user_uuid, endpoint, p256dh, auth, user_agent, filter_handles, mod_id, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_uuid      = excluded.user_uuid,
        p256dh         = excluded.p256dh,
        auth           = excluded.auth,
        user_agent     = excluded.user_agent,
        filter_handles = excluded.filter_handles,
        mod_id         = excluded.mod_id,
        last_seen_at   = excluded.last_seen_at
    `).bind(uuid, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent, filter, mod.id, now, now).run();
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }

  return jsonResponse({ ok: true, mod_id: mod.id, filter });
}

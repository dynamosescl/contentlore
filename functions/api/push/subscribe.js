// POST /api/push/subscribe
//
// Body: {
//   uuid:    string                       // client-side anon UUID
//   subscription: PushSubscriptionJSON    // from pushManager.subscribe()
//   filter_handles?: 'all' | string[]     // future per-creator filter
// }
//
// Idempotent: ON CONFLICT (endpoint) DO UPDATE refreshes the keys
// + last_seen_at so a re-subscribed device stays single-row.

import { jsonResponse } from '../../_lib.js';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const uuid = String(body?.uuid || '').slice(0, 64);
  const sub = body?.subscription;
  if (!uuid || !sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return jsonResponse({ ok: false, error: 'Missing uuid or subscription fields' }, 400);
  }

  const filter = Array.isArray(body.filter_handles)
    ? body.filter_handles.map(h => String(h).toLowerCase().trim()).filter(Boolean).join(',')
    : 'all';

  const userAgent = (request.headers.get('user-agent') || '').slice(0, 256);
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO push_subscriptions
        (user_uuid, endpoint, p256dh, auth, user_agent, filter_handles, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_uuid      = excluded.user_uuid,
        p256dh         = excluded.p256dh,
        auth           = excluded.auth,
        user_agent     = excluded.user_agent,
        filter_handles = excluded.filter_handles,
        last_seen_at   = excluded.last_seen_at
    `).bind(
      uuid,
      sub.endpoint,
      sub.keys.p256dh,
      sub.keys.auth,
      userAgent,
      filter || 'all',
      now, now
    ).run();
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }

  return jsonResponse({ ok: true }, 200, corsHeaders());
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

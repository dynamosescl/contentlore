// POST /api/push/unsubscribe
//
// Body: { endpoint: string }
//
// Anonymous — anyone with the endpoint URL can unsubscribe. That's
// the same access boundary the push service itself enforces (the
// endpoint is the secret token), so no auth is needed.

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
  const endpoint = String(body?.endpoint || '');
  if (!endpoint) return jsonResponse({ ok: false, error: 'Missing endpoint' }, 400);

  try {
    const res = await env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE endpoint = ?`
    ).bind(endpoint).run();
    return jsonResponse({ ok: true, deleted: res.meta?.changes || 0 }, 200, corsHeaders());
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

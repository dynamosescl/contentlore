// ================================================================
// functions/api/party/[id].js
// GET /api/party/{id}
//
// Returns the current state of a party: which creator they're
// watching, expiry, and the most recent ~50 chat messages.
// Optional ?since=<unix-seconds> returns only messages created
// after that timestamp — clients use it to poll deltas without
// re-fetching the full history every 3s.
//
// Read-only and unauthenticated. The id is the secret.
// ================================================================

import { jsonResponse } from '../../_lib.js';

const RECENT_LIMIT = 50;

export async function onRequestGet({ params, request, env }) {
  const id = String(params.id || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{6}$/.test(id)) {
    return jsonResponse({ ok: false, error: 'invalid party id' }, 400);
  }

  const party = await env.DB.prepare(
    'SELECT id, current_handle, current_platform, host_name, created_at, updated_at, expires_at FROM parties WHERE id = ?'
  ).bind(id).first();
  if (!party) return jsonResponse({ ok: false, error: 'party not found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (party.expires_at < now) {
    return jsonResponse({ ok: false, error: 'party expired', expired_at: party.expires_at }, 410);
  }

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? Math.max(0, parseInt(sinceParam, 10) || 0) : 0;

  let messages = [];
  if (since > 0) {
    const res = await env.DB.prepare(`
      SELECT id, username, message, created_at
      FROM party_messages
      WHERE party_id = ? AND created_at > ?
      ORDER BY created_at ASC
      LIMIT ?
    `).bind(id, since, RECENT_LIMIT).all();
    messages = res.results || [];
  } else {
    const res = await env.DB.prepare(`
      SELECT id, username, message, created_at
      FROM party_messages
      WHERE party_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(id, RECENT_LIMIT).all();
    messages = (res.results || []).reverse();
  }

  return jsonResponse({
    ok: true,
    id: party.id,
    current_handle: party.current_handle,
    current_platform: party.current_platform,
    host_name: party.host_name,
    created_at: party.created_at,
    updated_at: party.updated_at,
    expires_at: party.expires_at,
    server_time: now,
    messages,
  }, 200, {
    // Don't cache — chat polls would all see the same stale message list.
    'cache-control': 'no-store',
  });
}

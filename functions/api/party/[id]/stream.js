// ================================================================
// functions/api/party/[id]/stream.js
// PUT /api/party/{id}/stream
//
// Host-only mutation: change the creator the party is watching.
// Body: { handle, platform?, host_token }. The host_token is what
// /api/party/create returned — clients persist it in localStorage
// for the host's browser only.
//
// Validates handle against the curated 26 (same allowlist as
// create.js). On success, returns the new state so the caller
// doesn't need a follow-up GET.
// ================================================================

import { jsonResponse } from '../../../_lib.js';
import { getCuratedEntry } from '../../../_curated.js';

export async function onRequestPut({ params, request, env }) {
  const id = String(params.id || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{6}$/.test(id)) {
    return jsonResponse({ ok: false, error: 'invalid party id' }, 400);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.handle || '').toLowerCase().trim();
  const hostToken = String(body?.host_token || '').trim();
  const curated = await getCuratedEntry(env, handle);
  if (!curated) {
    return jsonResponse({ ok: false, error: 'handle must be one of the curated allowlist' }, 400);
  }
  if (!hostToken) {
    return jsonResponse({ ok: false, error: 'host_token required' }, 401);
  }

  const party = await env.DB.prepare(
    'SELECT host_token, expires_at FROM parties WHERE id = ?'
  ).bind(id).first();
  if (!party) return jsonResponse({ ok: false, error: 'party not found' }, 404);
  if (party.host_token !== hostToken) {
    return jsonResponse({ ok: false, error: 'host_token mismatch — not the host' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  if (party.expires_at < now) {
    return jsonResponse({ ok: false, error: 'party expired' }, 410);
  }

  const platform = ['twitch', 'kick'].includes(body?.platform)
    ? body.platform
    : (curated.platform || 'twitch');

  await env.DB.prepare(`
    UPDATE parties
    SET current_handle = ?, current_platform = ?, updated_at = ?
    WHERE id = ?
  `).bind(handle, platform, now, id).run();

  // System message: leaves a footprint in the chat so non-host
  // viewers can see the switch happened, without needing an
  // out-of-band notification channel.
  await env.DB.prepare(
    'INSERT INTO party_messages (party_id, username, message, created_at) VALUES (?, ?, ?, ?)'
  ).bind(id, '★ host', `Switched to ${handle} on ${platform}`, now).run();

  return jsonResponse({
    ok: true,
    id,
    current_handle: handle,
    current_platform: platform,
    updated_at: now,
  });
}

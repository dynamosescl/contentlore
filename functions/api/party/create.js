// ================================================================
// functions/api/party/create.js
// POST /api/party/create
//
// Creates a new Watch Party. Body: { handle, platform, host_name }.
// Returns: { ok, id, host_token }. The host_token is a 32-char secret
// the client persists in localStorage and presents on subsequent
// PUT /api/party/{id}/stream calls to prove host-ness — every other
// user just polls GET /api/party/{id}.
//
// Allowlist-validated: handle must be one of the curated 26 so the
// embed url is deterministic and we don't host arbitrary streams.
//
// Rate-limited per IP: 10 parties / IP / UTC day. Catches abuse
// without blocking real demand.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { getCuratedEntry } from '../../_curated.js';

const ALLOWED_PLATFORMS = new Set(['twitch', 'kick']);
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ambiguous chars (I, O, 0, 1) excluded
const ID_LEN = 6;
const HOST_TOKEN_LEN = 32;
const PARTY_TTL_SEC = 86400;
const RL_PER_DAY = 10;

function genId(len, alphabet) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function todayKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.handle || '').toLowerCase().trim();
  const hostName = String(body?.host_name || '').trim().slice(0, 32) || 'Host';
  const curated = await getCuratedEntry(env, handle);
  if (!curated) {
    return jsonResponse({ ok: false, error: 'handle must be one of the tracked streamers' }, 400);
  }
  const platform = ALLOWED_PLATFORMS.has(body?.platform)
    ? body.platform
    : (curated.platform || 'twitch');

  // Rate limit per IP (Cloudflare populates cf-connecting-ip on every request).
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const rlKey = `party:rl:${ip}:${todayKeyUTC()}`;
  const cur = Number((await env.KV.get(rlKey)) || '0');
  if (cur >= RL_PER_DAY) {
    return jsonResponse({ ok: false, error: 'rate limit: max ' + RL_PER_DAY + ' parties per day' }, 429);
  }

  // Generate a unique party id. Collisions on a 32-char alphabet at
  // length 6 are vanishingly rare (~1B combos) but a single retry
  // costs us nothing and keeps the contract honest.
  let id = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = genId(ID_LEN, ID_CHARS);
    const exists = await env.DB.prepare('SELECT 1 FROM parties WHERE id = ?').bind(candidate).first();
    if (!exists) { id = candidate; break; }
  }
  if (!id) return jsonResponse({ ok: false, error: 'could not allocate party id' }, 500);

  const hostToken = genId(HOST_TOKEN_LEN, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO parties (id, host_token, current_handle, current_platform, host_name, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, hostToken, handle, platform, hostName, now, now, now + PARTY_TTL_SEC).run();

  // Bump rate limit. 25h TTL so it survives mid-day rollover safely.
  await env.KV.put(rlKey, String(cur + 1), { expirationTtl: 90000 });

  return jsonResponse({
    ok: true,
    id,
    host_token: hostToken,
    handle,
    platform,
    expires_at: now + PARTY_TTL_SEC,
  });
}

// ================================================================
// functions/api/admin/curated.js
// /api/admin/curated — full CRUD over the curated_creators table.
// Bearer-authed against env.ADMIN_TOKEN.
//
//   GET    /api/admin/curated          — list all (active + inactive)
//   POST   /api/admin/curated          — body: {handle, display_name, primary_platform, socials}
//   PUT    /api/admin/curated          — body: {handle, ...partial fields}; updates an existing row
//   DELETE /api/admin/curated?handle=x — soft-delete (sets active=0); pass ?hard=1 to drop the row
//
// Every mutation calls invalidateCuratedCache() so subsequent reads
// from the helper see the new data on the next request without
// waiting for the 5-min TTL.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { getCuratedListAll, invalidateCuratedCache } from '../../_curated.js';

const HANDLE_RE = /^[a-z0-9_]{1,32}$/;
const PLATFORMS = new Set(['twitch', 'kick']);
const SOCIAL_KEYS = ['twitch', 'kick', 'tiktok', 'youtube', 'x', 'instagram', 'discord'];

function unauth() {
  return jsonResponse({ ok: false, error: 'Unauthorised' }, 401);
}
function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return false;
  return true;
}

function sanitiseSocials(input) {
  if (!input || typeof input !== 'object') {
    return Object.fromEntries(SOCIAL_KEYS.map(k => [k, null]));
  }
  const out = {};
  for (const k of SOCIAL_KEYS) {
    const v = input[k];
    if (v == null || v === '') { out[k] = null; continue; }
    const str = String(v).trim();
    if (!str) { out[k] = null; continue; }
    // Discord is allowed to be a full https:// invite URL; everything
    // else is a bare username (strip leading @ if present).
    out[k] = k === 'discord' ? str.slice(0, 200) : str.replace(/^@/, '').slice(0, 64);
  }
  return out;
}

function validateHandle(h) {
  return typeof h === 'string' && HANDLE_RE.test(h.toLowerCase());
}

export async function onRequestGet({ request, env }) {
  if (!authCheck(request, env)) return unauth();
  try {
    const list = await getCuratedListAll(env);
    return jsonResponse({ ok: true, count: list.length, creators: list });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!authCheck(request, env)) return unauth();
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.handle || '').toLowerCase().trim();
  const displayName = String(body?.display_name || '').trim();
  const primaryPlatform = String(body?.primary_platform || '').toLowerCase();
  const socials = sanitiseSocials(body?.socials);

  if (!validateHandle(handle))         return jsonResponse({ ok: false, error: 'handle must match [a-z0-9_]{1,32}' }, 400);
  if (!displayName || displayName.length > 64) return jsonResponse({ ok: false, error: 'display_name required (≤ 64 chars)' }, 400);
  if (!PLATFORMS.has(primaryPlatform)) return jsonResponse({ ok: false, error: 'primary_platform must be twitch or kick' }, 400);

  // Backfill the primary platform's social handle from `handle` if the
  // caller didn't supply it — keeps the seed data invariant.
  if (!socials[primaryPlatform]) socials[primaryPlatform] = handle;

  try {
    await env.DB.prepare(`
      INSERT INTO curated_creators (handle, display_name, primary_platform, socials, active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(handle) DO UPDATE SET
        display_name = excluded.display_name,
        primary_platform = excluded.primary_platform,
        socials = excluded.socials,
        active = 1
    `).bind(handle, displayName, primaryPlatform, JSON.stringify(socials)).run();
    invalidateCuratedCache();
    return jsonResponse({ ok: true, handle, display_name: displayName, primary_platform: primaryPlatform, socials, active: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  if (!authCheck(request, env)) return unauth();
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.handle || '').toLowerCase().trim();
  if (!validateHandle(handle)) return jsonResponse({ ok: false, error: 'handle required' }, 400);

  const existing = await env.DB.prepare(
    'SELECT handle, display_name, primary_platform, socials, active FROM curated_creators WHERE handle = ?'
  ).bind(handle).first();
  if (!existing) return jsonResponse({ ok: false, error: 'creator not found' }, 404);

  const next = {
    display_name: existing.display_name,
    primary_platform: existing.primary_platform,
    socials: existing.socials,
    active: existing.active,
  };
  if (body.display_name != null) {
    const dn = String(body.display_name).trim();
    if (!dn || dn.length > 64) return jsonResponse({ ok: false, error: 'display_name invalid' }, 400);
    next.display_name = dn;
  }
  if (body.primary_platform != null) {
    const pp = String(body.primary_platform).toLowerCase();
    if (!PLATFORMS.has(pp)) return jsonResponse({ ok: false, error: 'primary_platform must be twitch or kick' }, 400);
    next.primary_platform = pp;
  }
  if (body.socials != null) {
    next.socials = JSON.stringify(sanitiseSocials(body.socials));
  }
  if (body.active != null) {
    next.active = body.active ? 1 : 0;
  }

  try {
    await env.DB.prepare(`
      UPDATE curated_creators
      SET display_name = ?, primary_platform = ?, socials = ?, active = ?
      WHERE handle = ?
    `).bind(next.display_name, next.primary_platform, next.socials, next.active, handle).run();
    invalidateCuratedCache();
    return jsonResponse({ ok: true, handle, ...next, active: !!next.active });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!authCheck(request, env)) return unauth();
  const url = new URL(request.url);
  const handle = String(url.searchParams.get('handle') || '').toLowerCase().trim();
  const hard = url.searchParams.get('hard') === '1';
  if (!validateHandle(handle)) return jsonResponse({ ok: false, error: 'handle required (?handle=x)' }, 400);

  try {
    if (hard) {
      const r = await env.DB.prepare('DELETE FROM curated_creators WHERE handle = ?').bind(handle).run();
      invalidateCuratedCache();
      return jsonResponse({ ok: true, handle, hard_deleted: true, changes: r.meta?.changes ?? 0 });
    } else {
      const r = await env.DB.prepare('UPDATE curated_creators SET active = 0 WHERE handle = ?').bind(handle).run();
      invalidateCuratedCache();
      return jsonResponse({ ok: true, handle, soft_deleted: true, changes: r.meta?.changes ?? 0 });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

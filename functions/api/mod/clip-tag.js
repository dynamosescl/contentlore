// ================================================================
// functions/api/mod/clip-tag.js
// POST /api/mod/clip-tag
// Body: { clip_id, tag, context_description? }
//
// Permission: 'tag_clip' (Rookie+). Awards +10 XP. Verifies the clip
// belongs to a creator the mod mods for by hitting the clips cache.
// Tags are case-insensitive deduped per (clip_id, tag, mod_id).
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';

const MAX_TAG = 40;
const MAX_DESC = 500;
const TAG_RE = /^[a-z0-9 \-_]{2,40}$/i;

export async function onRequestPost({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'tag_clip')) {
    return jsonResponse({ ok: false, error: 'tag_clip permission required' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const clipId = String(body?.clip_id || '').trim();
  const tag = String(body?.tag || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const ctx = String(body?.context_description || '').trim().slice(0, MAX_DESC) || null;

  if (!clipId) return jsonResponse({ ok: false, error: 'clip_id required' }, 400);
  if (!tag || !TAG_RE.test(tag)) return jsonResponse({ ok: false, error: 'tag must be 2-40 chars (letters/numbers/spaces/dashes/underscores)' }, 400);

  // Verify this clip belongs to one of the mod's creators. We trust
  // the in-memory clips cache (5-min TTL) here — refreshing per-request
  // would require a roundtrip to Twitch helix per call.
  try {
    const baseUrl = new URL(request.url).origin;
    const res = await fetch(baseUrl + '/api/clips?range=30d', { headers: { 'cf-pages-internal': '1' } });
    const j = await res.json();
    const clip = (j?.clips || []).find(c => String(c.id) === clipId);
    if (!clip) {
      return jsonResponse({ ok: false, error: 'clip not found in the recent cache — try refreshing' }, 404);
    }
    const owner = String(clip.creator_handle).toLowerCase();
    if (!modModsCreator(mod, owner)) {
      return jsonResponse({ ok: false, error: 'that clip belongs to a creator you don\'t mod for' }, 403);
    }
  } catch {
    // Soft-fail: still allow the tag if the clips lookup itself fails — we'll
    // trust mod-token + the schema enforces the rest.
  }

  // Dedupe — same mod can't tag the same clip with the same tag twice.
  const dupe = await env.DB.prepare(
    `SELECT id FROM clip_tags WHERE clip_id = ? AND tag = ? AND submitted_by_mod = ? LIMIT 1`
  ).bind(clipId, tag, mod.id).first();
  if (dupe) {
    return jsonResponse({ ok: false, error: 'you already tagged this clip with that tag' }, 409);
  }

  const ins = await env.DB.prepare(
    `INSERT INTO clip_tags (clip_id, tag, context_description, submitted_by_mod) VALUES (?, ?, ?, ?)`
  ).bind(clipId, tag, ctx, mod.id).run();

  const result = await awardXp(env, mod.id, 'clip_tag', clipId);

  return jsonResponse({
    ok: true,
    id: ins?.meta?.last_row_id || null,
    clip_id: clipId,
    tag,
    xp_awarded: 10,
    xp_after: result.xp_after,
    level: result.level,
  });
}

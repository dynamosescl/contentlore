// ================================================================
// functions/api/mod/update-bio.js
// PUT /api/mod/update-bio
// Body: { creator_handle, bio }
//
// Permission: 'edit_bio' (Senior+). Awards +10 XP.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';
import { invalidateCuratedCache } from '../../_curated.js';

const MAX_BIO = 1200;

export async function onRequestPut({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'edit_bio')) {
    return jsonResponse({ ok: false, error: 'requires Senior level (700 XP)' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.creator_handle || '').toLowerCase();
  if (!handle) return jsonResponse({ ok: false, error: 'creator_handle required' }, 400);
  if (!modModsCreator(mod, handle)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that creator' }, 403);
  }

  const bio = String(body?.bio ?? '').trim().slice(0, MAX_BIO) || null;

  // Verify the creator exists.
  const exists = await env.DB.prepare(
    `SELECT 1 FROM curated_creators WHERE handle = ? AND active = 1`
  ).bind(handle).first();
  if (!exists) return jsonResponse({ ok: false, error: 'creator not found' }, 404);

  await env.DB.prepare(
    `UPDATE curated_creators SET bio = ? WHERE handle = ?`
  ).bind(bio, handle).run();
  invalidateCuratedCache();

  const result = await awardXp(env, mod.id, 'bio_edit', handle);

  return jsonResponse({
    ok: true,
    bio,
    xp_awarded: 10,
    xp_after: result.xp_after,
    level: result.level,
  });
}

export async function onRequestPost(ctx) { return onRequestPut(ctx); }

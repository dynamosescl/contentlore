// ================================================================
// functions/api/mod/update-socials.js
// PUT /api/mod/update-socials
// Body: { creator_handle, socials: { tiktok, youtube, x, instagram, discord } }
//
// Updates the editable subset of curated_creators.socials. The two
// "hard" handles (twitch, kick) are NOT writable here — those drive
// platform polling and need an admin to change. The mod can edit
// TikTok / YouTube / X / Instagram / Discord URL handles.
//
// Permission: 'edit_socials' (Trusted+). Awards +15 XP per call.
// Cache invalidation: invalidateCuratedCache() so the next public
// /api/uk-rp-live and /api/curated-list refreshes pick up the change.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';
import { getCuratedEntry, invalidateCuratedCache } from '../../_curated.js';

const EDITABLE = ['tiktok', 'youtube', 'x', 'instagram', 'discord'];

function sanitiseSocialValue(field, raw) {
  if (raw == null || raw === '') return null;
  let v = String(raw).trim();
  if (!v) return null;

  if (field === 'discord') {
    // Accept full discord.gg invite URLs; reject anything else.
    if (!/^https?:\/\/(www\.)?discord\.(gg|com)\//i.test(v) && !/^discord\.(gg|com)\//i.test(v)) {
      return null;
    }
    if (v.startsWith('discord.')) v = 'https://' + v;
    return v.slice(0, 200);
  }

  // For username-only fields: strip leading @, URL prefix, trailing slash + query.
  v = v.replace(/^@/, '').replace(/^https?:\/\/[^\/]+\//, '').split('/')[0].split('?')[0];
  if (!v) return null;
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(v)) return null;
  return v;
}

export async function onRequestPut({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'edit_socials')) {
    return jsonResponse({ ok: false, error: 'requires Trusted level (300 XP)' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.creator_handle || '').toLowerCase();
  if (!handle) return jsonResponse({ ok: false, error: 'creator_handle required' }, 400);
  if (!modModsCreator(mod, handle)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that creator' }, 403);
  }

  const entry = await getCuratedEntry(env, handle);
  if (!entry) return jsonResponse({ ok: false, error: 'creator not found' }, 404);

  // Merge: preserve existing twitch/kick (admin-only); overwrite editable fields.
  const incoming = body?.socials || {};
  const updated = { ...entry.socials };
  const changedFields = [];
  for (const f of EDITABLE) {
    if (!(f in incoming)) continue;
    const cleaned = sanitiseSocialValue(f, incoming[f]);
    if (cleaned !== updated[f]) {
      updated[f] = cleaned;
      changedFields.push(f);
    }
  }

  if (!changedFields.length) {
    return jsonResponse({ ok: true, no_changes: true, socials: updated });
  }

  await env.DB.prepare(
    `UPDATE curated_creators SET socials = ? WHERE handle = ?`
  ).bind(JSON.stringify(updated), handle).run();
  invalidateCuratedCache();

  // Award XP for the contribution. One contribution per call regardless
  // of how many fields changed in that call — keeps it cheap to spam.
  const result = await awardXp(env, mod.id, 'social_update', handle);

  return jsonResponse({
    ok: true,
    socials: updated,
    changed_fields: changedFields,
    xp_awarded: 15,
    xp_after: result.xp_after,
    level: result.level,
  });
}

export async function onRequestPost(ctx) { return onRequestPut(ctx); }

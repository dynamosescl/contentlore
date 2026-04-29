// ================================================================
// functions/_mod-auth.js
// Shared authentication + authorisation helpers for the mod system.
//
// Every /api/mod/* endpoint (except signup) calls requireMod() at the
// top to validate the Bearer token, look up the mod_accounts row, and
// enforce status === 'verified'. Permissions are level-gated via the
// PERMISSIONS map below; endpoints call hasPerm(mod, perm).
//
// Tokens are 32-char hex (16 random bytes from getRandomValues),
// generated server-side at signup, stored in mod_accounts.token,
// shown to the mod once at admin approval, and persisted on the mod's
// device in localStorage (`cl:mod:token`). A mod can rotate by asking
// an admin to suspend + re-approve (which generates a new token).
// ================================================================

import { jsonResponse } from './_lib.js';

// ---------- Levels ----------
// Thresholds (XP minimum for that level). Level recompute happens
// every time XP is awarded — see awardXp() below.
export const LEVELS = [
  { id: 'rookie',  label: 'Rookie',   min: 0    },
  { id: 'regular', label: 'Regular',  min: 100  },
  { id: 'trusted', label: 'Trusted',  min: 300  },
  { id: 'senior',  label: 'Senior',   min: 700  },
  { id: 'head',    label: 'Head Mod', min: 1500 },
];

export function levelForXp(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.min) cur = l;
  }
  return cur;
}

// Badge colours used everywhere (pwa.js badge component, profiles, etc.)
export const LEVEL_COLOURS = {
  rookie:  '#9aa6b2',
  regular: '#3acc88',
  trusted: '#5b9bff',
  senior:  '#b56fff',
  head:    '#f5c84a',
};

// ---------- Permissions ----------
// Each permission is a capability gate. Level → set of allowed perms.
// Check via hasPerm(mod, 'edit_socials'). Update CLAUDE.md if the
// matrix changes.
const PERM_BY_LEVEL = {
  rookie:  ['tag_clip', 'flag_moment', 'stream_notes'],
  regular: ['tag_clip', 'flag_moment', 'stream_notes', 'add_character'],
  trusted: ['tag_clip', 'flag_moment', 'stream_notes', 'add_character', 'edit_socials'],
  senior:  ['tag_clip', 'flag_moment', 'stream_notes', 'add_character', 'edit_socials', 'edit_bio'],
  head:    ['tag_clip', 'flag_moment', 'stream_notes', 'add_character', 'edit_socials', 'edit_bio'],
};

export function hasPerm(mod, perm) {
  if (!mod || mod.status !== 'verified') return false;
  return (PERM_BY_LEVEL[mod.level] || []).includes(perm);
}

// ---------- XP awards ----------
export const XP_FOR = {
  clip_tag:       10,
  character_add:  25,
  social_update:  15,
  stream_notes:   20, // per session — endpoint enforces "max 1/day/(mod, creator)"
  moment_flag:    5,
  bio_edit:       10,
};

// ---------- Helpers ----------
export function generateToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function parseCreatorsModded(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).toLowerCase()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(s => String(s).toLowerCase()).filter(Boolean);
  } catch { /* fall through */ }
  return [];
}

// Hydrate a mod_accounts row into a JS object the rest of the code
// can use without re-parsing JSON or recomputing the level.
export function hydrate(row) {
  if (!row) return null;
  const xp = Number(row.xp || 0);
  const level = levelForXp(xp).id;
  return {
    id: row.id,
    twitch_handle: row.twitch_handle || null,
    kick_handle: row.kick_handle || null,
    display_name: row.display_name,
    creators_modded: parseCreatorsModded(row.creators_modded),
    token: row.token,
    xp,
    level, // recompute every load — cheaper + always right
    status: row.status,
    mod_of_month: row.mod_of_month || null,
    created_at: Number(row.created_at || 0),
    last_active: Number(row.last_active || 0),
  };
}

// Public-safe view (drop the token).
export function publicMod(mod) {
  if (!mod) return null;
  const { token, ...rest } = mod;
  return rest;
}

// ---------- Auth middleware ----------
// Pull the Bearer token from the Authorization header. Returns null
// if missing or malformed.
export function tokenFromRequest(request) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+([a-f0-9]{16,64})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Used by endpoints. Returns either { mod } when authorised, or a
// Response (4xx) the caller should return verbatim. Touches
// last_active so the leaderboard knows who's recent.
export async function requireMod(request, env, { allowPending = false } = {}) {
  const token = tokenFromRequest(request);
  if (!token) {
    return { error: jsonResponse({ ok: false, error: 'missing token' }, 401) };
  }
  const row = await env.DB.prepare(
    `SELECT * FROM mod_accounts WHERE token = ? LIMIT 1`
  ).bind(token).first();
  if (!row) {
    return { error: jsonResponse({ ok: false, error: 'invalid token' }, 401) };
  }
  const mod = hydrate(row);
  if (mod.status === 'suspended') {
    return { error: jsonResponse({ ok: false, error: 'account suspended' }, 403) };
  }
  if (mod.status === 'pending' && !allowPending) {
    return { error: jsonResponse({ ok: false, error: 'account pending admin approval' }, 403) };
  }
  // Touch last_active. Best-effort — failures shouldn't block the request.
  try {
    await env.DB.prepare(
      `UPDATE mod_accounts SET last_active = unixepoch() WHERE id = ?`
    ).bind(mod.id).run();
  } catch { /* swallow */ }
  return { mod };
}

// ---------- Per-creator authorisation ----------
// "Is this mod modding for this creator?" — matched on the lowercased
// curated handle. creators_modded is the canonical source.
export function modModsCreator(mod, creatorHandle) {
  if (!mod || !creatorHandle) return false;
  const h = String(creatorHandle).toLowerCase();
  return mod.creators_modded.includes(h);
}

// ---------- XP awarding ----------
// Insert one mod_contributions row + bump mod_accounts.xp + recompute
// the level. Idempotency is the caller's responsibility (e.g. the
// stream-notes endpoint enforces max 1 notes contribution per day per
// (mod, creator)).
export async function awardXp(env, modId, type, targetId) {
  const xp = XP_FOR[type];
  if (!xp) throw new Error('unknown contribution type: ' + type);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mod_contributions (mod_id, type, target_id, xp_earned)
       VALUES (?, ?, ?, ?)`
    ).bind(modId, type, targetId || null, xp),
    env.DB.prepare(
      `UPDATE mod_accounts SET xp = xp + ? WHERE id = ?`
    ).bind(xp, modId),
  ]);

  // Re-fetch and recompute level. If it changed, persist the new label.
  const row = await env.DB.prepare(
    `SELECT xp, level FROM mod_accounts WHERE id = ?`
  ).bind(modId).first();
  if (!row) return { xp_after: xp, level: 'rookie' };

  const newLevel = levelForXp(Number(row.xp)).id;
  if (newLevel !== row.level) {
    await env.DB.prepare(
      `UPDATE mod_accounts SET level = ? WHERE id = ?`
    ).bind(newLevel, modId).run();
  }
  return { xp_after: Number(row.xp), level: newLevel };
}

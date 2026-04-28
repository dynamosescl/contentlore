// ================================================================
// functions/_curated.js
// Single source of truth for the curated allowlist. Reads from
// `curated_creators` D1 table with a 5-minute module-level cache.
//
// All Pages Functions that need the curated handles import from here
// instead of carrying their own hardcoded copy.
//
// Shape returned by getCuratedList(env):
//   [{
//     handle:           'tyrone',         // lowercase, primary key
//     display_name:     'Tyrone',
//     name:             'Tyrone',         // alias of display_name (legacy callers)
//     primary_platform: 'twitch',
//     platform:         'twitch',         // alias (legacy callers)
//     socials: { twitch, kick, tiktok, youtube, x, instagram, discord },
//     added_at:         '2026-04-30 ...',
//     active:           true,
//   }, ...]
//
// The cache is per-isolate. Cloudflare's Pages Functions runtime
// reuses isolates for warm requests, so the typical request hits the
// in-memory copy. Cold isolates re-fetch from D1 (~1-2ms). After a
// successful seed migration, the FALLBACK array below is dead code —
// it only fires if the table is missing or empty (e.g. brand-new env
// before the migration has run).
// ================================================================

const TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheAt = 0;

// Hardcoded safety net — used only if the D1 query returns 0 rows.
// In production this should be unreachable; the seed migration
// (013_curated_creators.sql) populates the table on first deploy.
const FALLBACK = [
  { handle: 'tyrone',           name: 'Tyrone',           platform: 'twitch', socials: { twitch: 'tyrone',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lbmm',             name: 'LBMM',             platform: 'twitch', socials: { twitch: 'lbmm',             kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'reeclare',         name: 'Reeclare',         platform: 'twitch', socials: { twitch: 'reeclare',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'stoker',           name: 'Stoker',           platform: 'twitch', socials: { twitch: 'stoker',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'samham',           name: 'SamHam',           platform: 'twitch', socials: { twitch: 'samham',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'deggyuk',          name: 'DeggyUK',          platform: 'twitch', socials: { twitch: 'deggyuk',          kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'megsmary',         name: 'MegsMary',         platform: 'twitch', socials: { twitch: 'megsmary',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'tazzthegeeza',     name: 'TaZzTheGeeza',     platform: 'twitch', socials: { twitch: 'tazzthegeeza',     kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'wheelydev',        name: 'WheelyDev',        platform: 'twitch', socials: { twitch: 'wheelydev',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'rexality',         name: 'RexaliTy',         platform: 'twitch', socials: { twitch: 'rexality',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'steeel',           name: 'Steeel',           platform: 'twitch', socials: { twitch: 'steeel',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'justj0hnnyhd',     name: 'JustJ0hnnyHD',     platform: 'twitch', socials: { twitch: 'justj0hnnyhd',     kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'cherish_remedy',   name: 'Cherish_Remedy',   platform: 'twitch', socials: { twitch: 'cherish_remedy',   kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lorddorro',        name: 'LordDorro',        platform: 'twitch', socials: { twitch: 'lorddorro',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'jck0__',           name: 'JCK0__',           platform: 'twitch', socials: { twitch: 'jck0__',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'absthename',       name: 'ABsTheName',       platform: 'twitch', socials: { twitch: 'absthename',       kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'essellz',          name: 'Essellz',          platform: 'twitch', socials: { twitch: 'essellz',          kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lewthescot',       name: 'LewTheScot',       platform: 'twitch', socials: { twitch: 'lewthescot',       kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'angels365',        name: 'Angels365',        platform: 'twitch', socials: { twitch: 'angels365',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'fantasiasfantasy', name: 'FantasiasFantasy', platform: 'twitch', socials: { twitch: 'fantasiasfantasy', kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'kavsual',          name: 'Kavsual',          platform: 'kick',   socials: { twitch: null,               kick: 'kavsual',     tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'shammers',         name: 'Shammers',         platform: 'kick',   socials: { twitch: null,               kick: 'shammers',    tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'bags',             name: 'Bags',             platform: 'kick',   socials: { twitch: 'bags',             kick: 'bags',        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'dynamoses',        name: 'Dynamoses',        platform: 'kick',   socials: { twitch: 'dynamoses',        kick: 'dynamoses',   tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'dcampion',         name: 'DCampion',         platform: 'kick',   socials: { twitch: null,               kick: 'dcampion',    tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'elliewaller',      name: 'EllieWaller',      platform: 'kick',   socials: { twitch: null,               kick: 'elliewaller', tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
];

/**
 * Returns the active curated allowlist. Cached per-isolate for 5 min.
 * Pass { force: true } to skip the cache (used by admin mutations
 * after a write so the next request sees fresh data).
 */
export async function getCuratedList(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cacheAt) < TTL_MS) return _cache;

  let rows = [];
  try {
    const res = await env.DB.prepare(`
      SELECT handle, display_name, primary_platform, socials, added_at, active
      FROM curated_creators
      WHERE active = 1
      ORDER BY added_at ASC, handle ASC
    `).all();
    rows = res.results || [];
  } catch {
    rows = [];
  }

  let list;
  if (rows.length === 0) {
    // Should never hit in production once the seed migration has run.
    list = FALLBACK.map(normaliseFallback);
  } else {
    list = rows.map(normaliseRow);
  }
  _cache = list;
  _cacheAt = now;
  return list;
}

/**
 * Returns the FULL list (active + inactive) — used by the mod panel.
 * Bypasses the cache so freshly-toggled rows are visible immediately.
 */
export async function getCuratedListAll(env) {
  const res = await env.DB.prepare(`
    SELECT handle, display_name, primary_platform, socials, added_at, active
    FROM curated_creators
    ORDER BY added_at ASC, handle ASC
  `).all();
  return (res.results || []).map(normaliseRow);
}

/**
 * Returns a Set of lowercase handles for membership checks.
 */
export async function getHandlesSet(env) {
  const list = await getCuratedList(env);
  return new Set(list.map(c => c.handle));
}

/**
 * Returns the entry for one handle (or null). Case-insensitive.
 */
export async function getCuratedEntry(env, handle) {
  const list = await getCuratedList(env);
  const h = String(handle || '').toLowerCase();
  return list.find(c => c.handle === h) || null;
}

/**
 * Drop the in-memory cache. Call after any admin mutation so the next
 * request hits D1 directly. Subsequent requests within 5 min will
 * still use the new cached value.
 */
export function invalidateCuratedCache() {
  _cache = null;
  _cacheAt = 0;
}

// ----------------------------------------------------------------
// Internals
// ----------------------------------------------------------------

function normaliseRow(r) {
  return {
    handle: String(r.handle).toLowerCase(),
    display_name: r.display_name,
    name: r.display_name,
    primary_platform: r.primary_platform,
    platform: r.primary_platform,
    socials: parseSocials(r.socials),
    added_at: r.added_at || null,
    active: r.active === 1 || r.active === true,
  };
}

function normaliseFallback(entry) {
  return {
    handle: entry.handle,
    display_name: entry.name,
    name: entry.name,
    primary_platform: entry.platform,
    platform: entry.platform,
    socials: mergeSocials(emptySocials(), entry.socials || {}),
    added_at: null,
    active: true,
  };
}

function parseSocials(raw) {
  if (!raw) return emptySocials();
  if (typeof raw === 'object') return mergeSocials(emptySocials(), raw);
  try { return mergeSocials(emptySocials(), JSON.parse(raw)); }
  catch { return emptySocials(); }
}

function emptySocials() {
  return { twitch: null, kick: null, tiktok: null, youtube: null, x: null, instagram: null, discord: null };
}

function mergeSocials(base, overlay) {
  return {
    twitch:    overlay?.twitch    ?? base.twitch    ?? null,
    kick:      overlay?.kick      ?? base.kick      ?? null,
    tiktok:    overlay?.tiktok    ?? base.tiktok    ?? null,
    youtube:   overlay?.youtube   ?? base.youtube   ?? null,
    x:         overlay?.x         ?? base.x         ?? null,
    instagram: overlay?.instagram ?? base.instagram ?? null,
    discord:   overlay?.discord   ?? base.discord   ?? null,
  };
}

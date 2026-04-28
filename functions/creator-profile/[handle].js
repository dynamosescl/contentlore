// ================================================================
// functions/creator-profile/[handle].js
// GET /creator-profile/{handle}
//
// Server-rendered HTML profile page for one of the curated 26.
// Off-allowlist handles return a branded 404. Data sources:
//   - Live state: sub-request to /api/uk-rp-live  (Cache-API hit at edge)
//   - Clips:      KV `clips:30d:cache`  (warmed by /api/clips)
//   - History:    D1 `stream_sessions`  (joined via creator_platforms.handle)
//   - Server affinity: keyword-match over recent stream titles
//
// /api/uk-rp-live moved off KV to Cache API in commit 7bf7940 — we
// now reach it via a same-origin sub-request, which the Cloudflare
// edge cache short-circuits when warm.
// ================================================================

// Mirrors the ALLOWLIST in functions/api/uk-rp-live.js — keep `socials` in
// sync between the two files. dynamoses + bags are the two confirmed
// dual-platform creators (Twitch + Kick); everyone else gets the primary
// handle in `socials.{primary}` and null for the rest.
const ALLOWLIST = [
  { handle: 'tyrone',           platform: 'twitch', name: 'Tyrone',           socials: { twitch: 'tyrone',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lbmm',             platform: 'twitch', name: 'LBMM',             socials: { twitch: 'lbmm',             kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'reeclare',         platform: 'twitch', name: 'Reeclare',         socials: { twitch: 'reeclare',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'stoker',           platform: 'twitch', name: 'Stoker',           socials: { twitch: 'stoker',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'samham',           platform: 'twitch', name: 'SamHam',           socials: { twitch: 'samham',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'deggyuk',          platform: 'twitch', name: 'DeggyUK',          socials: { twitch: 'deggyuk',          kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'megsmary',         platform: 'twitch', name: 'MegsMary',         socials: { twitch: 'megsmary',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'tazzthegeeza',     platform: 'twitch', name: 'TaZzTheGeeza',     socials: { twitch: 'tazzthegeeza',     kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'wheelydev',        platform: 'twitch', name: 'WheelyDev',        socials: { twitch: 'wheelydev',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'rexality',         platform: 'twitch', name: 'RexaliTy',         socials: { twitch: 'rexality',         kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'steeel',           platform: 'twitch', name: 'Steeel',           socials: { twitch: 'steeel',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'justj0hnnyhd',     platform: 'twitch', name: 'JustJ0hnnyHD',     socials: { twitch: 'justj0hnnyhd',     kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'cherish_remedy',   platform: 'twitch', name: 'Cherish_Remedy',   socials: { twitch: 'cherish_remedy',   kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lorddorro',        platform: 'twitch', name: 'LordDorro',        socials: { twitch: 'lorddorro',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'jck0__',           platform: 'twitch', name: 'JCK0__',           socials: { twitch: 'jck0__',           kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'absthename',       platform: 'twitch', name: 'ABsTheName',       socials: { twitch: 'absthename',       kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'essellz',          platform: 'twitch', name: 'Essellz',          socials: { twitch: 'essellz',          kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'lewthescot',       platform: 'twitch', name: 'LewTheScot',       socials: { twitch: 'lewthescot',       kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'angels365',        platform: 'twitch', name: 'Angels365',        socials: { twitch: 'angels365',        kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'fantasiasfantasy', platform: 'twitch', name: 'FantasiasFantasy', socials: { twitch: 'fantasiasfantasy', kick: null,        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'kavsual',          platform: 'kick',   name: 'Kavsual',          socials: { twitch: null,               kick: 'kavsual',     tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'shammers',         platform: 'kick',   name: 'Shammers',         socials: { twitch: null,               kick: 'shammers',    tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  // Confirmed multi-platform via D1 migration 010.
  { handle: 'bags',             platform: 'kick',   name: 'Bags',             socials: { twitch: 'bags',             kick: 'bags',        tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'dynamoses',        platform: 'kick',   name: 'Dynamoses',        socials: { twitch: 'dynamoses',        kick: 'dynamoses',   tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'dcampion',         platform: 'kick',   name: 'DCampion',         socials: { twitch: null,               kick: 'dcampion',    tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
  { handle: 'elliewaller',      platform: 'kick',   name: 'EllieWaller',      socials: { twitch: null,               kick: 'elliewaller', tiktok: null, youtube: null, x: null, instagram: null, discord: null } },
];

// Subset of SERVERS data needed for affinity detection. Kept in sync with
// the SERVERS array in /gta-rp/servers/index.html — when that grows, mirror
// the additions here. (Eventually move to a shared module.)
const SERVERS = [
  { id: 'unique',      name: 'Unique RP',      keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         name: 'TNG RP',         keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       name: 'Orbit RP',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     name: 'New Era RP',     keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     name: 'Prodigy RP',     keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         name: 'D10 RP',         keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   name: 'Unmatched RP',   keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'verarp',      name: 'VeraRP',         keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        name: 'The Endz',       keywords: ['the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      name: "Let's RP",       keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     name: 'Drill UK RP',    keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life RP',keywords: ['british life', 'britishlife'] },
];

// Match longest keyword first so "newera rp" beats "newera"/"new era".
const SERVERS_BY_KEYWORD_LENGTH = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);

function detectServer(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const s of SERVERS_BY_KEYWORD_LENGTH) {
    for (const kw of s.keywords) if (t.includes(kw)) return s;
  }
  return null;
}

export async function onRequestGet({ params, env, request }) {
  const rawHandle = String(params.handle || '').toLowerCase();
  const entry = ALLOWLIST.find(c => c.handle === rawHandle);

  if (!entry) return notFoundPage(rawHandle);

  // Pull the live state, clips cache, and D1 history in parallel.
  const [liveCache, clipsCache, dbProfile, sessionRows, monthRanks] = await Promise.all([
    getLiveCache(env, request),
    getClipsCache(env, request),
    lookupDbCreator(env, entry.handle),
    querySessions(env, entry.handle).catch(() => null),
    queryMonthRanks(env).catch(() => []),
  ]);

  const liveEntry = (liveCache?.live || []).find(c => c.handle === entry.handle) || null;
  const clips = (clipsCache?.clips || []).filter(c => c.creator_handle === entry.handle).slice(0, 6);
  const stats = aggregateStats(sessionRows || []);
  const affinity = aggregateServerAffinity(sessionRows || []);
  const reportCard = buildReportCard(entry.handle, sessionRows || [], monthRanks);

  const display = liveEntry?.display_name || dbProfile?.display_name || entry.name;
  const avatar = liveEntry?.avatar_url || dbProfile?.avatar_url || null;
  // Prefer the canonical allowlist socials (they're the source of truth)
  // and merge over anything the live API returned in case future fields
  // get added to the live shape first.
  const socials = mergeSocials(entry.socials, liveEntry?.socials);

  return new Response(renderProfile({
    handle: entry.handle, name: display, platform: entry.platform,
    avatar, liveEntry, clips, stats, affinity, socials, reportCard,
  }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60',
    },
  });
}

// ================================================================
// Data
// ================================================================

// Sub-request /api/uk-rp-live for fresh live state. The endpoint is on
// the same origin and uses Cache API internally (commit 7bf7940), so a
// warm edge cache short-circuits this in ~1ms; cold path costs one
// platform API round-trip which we'd be paying anyway.
async function getLiveCache(env, request) {
  try {
    const url = new URL('/api/uk-rp-live', request.url);
    const res = await fetch(url.toString(), { headers: { 'cf-pages-internal': '1' } });
    if (res.ok) {
      const json = await res.json();
      if (json?.ok) return json;
    }
  } catch { /* swallow — profile still renders without live state */ }
  return null;
}

// Clip cache lookup with cold-start fallback. Preference order:
//   1. clips:30d:cache  — preferred; widest window, freshest 5-min KV value
//   2. sub-request to /api/clips?range=30d — warms the 30d KV for next time
//   3. clips:7d:cache  — last resort; populated by every Clip Wall hit
async function getClipsCache(env, request) {
  let cache = await env.KV.get('clips:30d:cache', 'json').catch(() => null);
  if (cache) return cache;

  // Sub-request the API endpoint — the function and the API live on the same
  // origin, so this hits cache.cloudflare → the worker → KV write-through.
  try {
    const url = new URL('/api/clips?range=30d', request.url);
    const res = await fetch(url.toString(), { headers: { 'cf-pages-internal': '1' } });
    if (res.ok) {
      const json = await res.json();
      if (json?.ok) return json;
    }
  } catch { /* swallow — we'll try the 7d cache next */ }

  cache = await env.KV.get('clips:7d:cache', 'json').catch(() => null);
  return cache;
}

async function lookupDbCreator(env, handle) {
  try {
    const row = await env.DB.prepare(`
      SELECT c.id, c.display_name, c.avatar_url
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id
      WHERE cp.handle = ? AND cp.is_primary = 1
      LIMIT 1
    `).bind(handle).first();
    return row || null;
  } catch {
    return null;
  }
}

async function querySessions(env, handle) {
  // 90-day window — long enough for meaningful averages, short enough that
  // dropped/inactive servers don't skew affinity.
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  try {
    const res = await env.DB.prepare(`
      SELECT ss.started_at, ss.ended_at, ss.duration_mins,
             ss.peak_viewers, ss.avg_viewers, ss.final_title,
             ss.primary_category, ss.is_ongoing
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id
      WHERE cp.handle = ? AND ss.started_at >= ?
      ORDER BY ss.started_at DESC
      LIMIT 200
    `).bind(handle, since).all();
    return res.results || [];
  } catch {
    return [];
  }
}

// Hours-per-creator across the curated 26 for the current calendar month.
// Used to compute the report-card rank without loading all 26 profiles.
// One query, returns at most 26 rows.
async function queryMonthRanks(env) {
  const start = monthStartUnix();
  const res = await env.DB.prepare(`
    SELECT cp.handle,
           SUM(ss.duration_mins) AS mins
    FROM stream_sessions ss
    INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
    WHERE ss.started_at >= ?
    GROUP BY ss.creator_id
  `).bind(start).all();
  return (res.results || []).map(r => ({
    handle: String(r.handle).toLowerCase(),
    mins: Number(r.mins || 0),
  })).sort((a, b) => b.mins - a.mins);
}

// Slice the session list down to the current calendar month and roll up
// the metrics the report card surfaces. Rank is derived by looking up
// this creator's position in the precomputed monthRanks list.
function buildReportCard(handle, sessions, monthRanks) {
  const start = monthStartUnix();
  const monthSessions = sessions.filter(s => Number(s.started_at || 0) >= start);
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (!monthSessions.length) {
    return { hasData: false, monthLabel };
  }
  const totalMins = monthSessions.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const peak = monthSessions.reduce((m, r) => Math.max(m, r.peak_viewers || 0), 0);
  const weighted = monthSessions.reduce((s, r) => s + (r.avg_viewers || 0) * (r.duration_mins || 0), 0);
  const avg = totalMins > 0 ? Math.round(weighted / totalMins) : 0;

  // Most-played server in this month's sessions.
  const serverCounts = new Map();
  for (const s of monthSessions) {
    const sv = detectServer(s.final_title);
    if (!sv) continue;
    serverCounts.set(sv.id, { name: sv.name, n: (serverCounts.get(sv.id)?.n || 0) + 1 });
  }
  const topServer = [...serverCounts.values()].sort((a, b) => b.n - a.n)[0] || null;

  // Daily hours sparkline — one bar per day from month-start to today.
  const today = new Date();
  const daysInMonth = today.getUTCDate();
  const dailyMins = new Array(daysInMonth).fill(0);
  for (const s of monthSessions) {
    const d = new Date(Number(s.started_at) * 1000);
    if (d.getUTCMonth() !== today.getUTCMonth() || d.getUTCFullYear() !== today.getUTCFullYear()) continue;
    const idx = d.getUTCDate() - 1;
    if (idx >= 0 && idx < daysInMonth) {
      dailyMins[idx] += (s.duration_mins || 0);
    }
  }

  // Rank: find this creator's index in the precomputed monthRanks list.
  let rank = null;
  if (Array.isArray(monthRanks) && monthRanks.length) {
    const idx = monthRanks.findIndex(r => r.handle === handle);
    if (idx !== -1) rank = idx + 1;
  }

  return {
    hasData: true,
    monthLabel,
    sessions: monthSessions.length,
    hours: Math.round(totalMins / 60),
    minutes: totalMins,
    avgViewers: avg,
    peakViewers: peak,
    topServer: topServer?.name || null,
    dailyMins,
    rank,
    rankOf: monthRanks?.length || 26,
  };
}

function monthStartUnix() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

function aggregateStats(sessions) {
  if (!sessions.length) {
    return { count: 0, hours: 0, avgViewers: 0, peakViewers: 0, lastStreamAt: null, hasData: false };
  }
  const totalMins = sessions.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const peak = sessions.reduce((m, r) => Math.max(m, r.peak_viewers || 0), 0);
  // Weighted average across sessions (each session's avg_viewers weighted by its duration).
  const weighted = sessions.reduce((s, r) => s + (r.avg_viewers || 0) * (r.duration_mins || 0), 0);
  const avg = totalMins > 0 ? Math.round(weighted / totalMins) : 0;
  const lastStreamAt = sessions[0].started_at;
  return {
    count: sessions.length,
    hours: Math.round(totalMins / 60),
    avgViewers: avg,
    peakViewers: peak,
    lastStreamAt,
    hasData: true,
  };
}

function aggregateServerAffinity(sessions) {
  const counts = new Map();
  // Only the most recent 30 sessions feed affinity — current allegiance > stale history.
  for (const s of sessions.slice(0, 30)) {
    const server = detectServer(s.final_title);
    if (!server) continue;
    counts.set(server.id, { ...server, n: (counts.get(server.id)?.n || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

// ================================================================
// Render
// ================================================================

// Resolve socials: take entry as the source of truth; let any non-null
// values from the live API override (in case the live response gets
// richer in the future). Always returns the full 7-key shape.
function mergeSocials(entrySocials, liveSocials) {
  const e = entrySocials || {};
  const l = liveSocials || {};
  return {
    twitch:    l.twitch    || e.twitch    || null,
    kick:      l.kick      || e.kick      || null,
    tiktok:    l.tiktok    || e.tiktok    || null,
    youtube:   l.youtube   || e.youtube   || null,
    x:         l.x         || e.x         || null,
    instagram: l.instagram || e.instagram || null,
    discord:   l.discord   || e.discord   || null,
  };
}

// Inline SVG glyphs for each platform — kept here so creator-profile
// stays self-contained (no extra request for icon sprites). Each is
// 18×18 in a viewBox and inherits currentColor.
function platformIcon(key) {
  switch (key) {
    case 'twitch':    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4.265 3 3 6.733V19.7h4.466V22h2.532l2.265-2.3h3.598L22 14.6V3H4.265zm15.736 10.667-2.733 2.733h-4.466l-2.265 2.267v-2.267H6.732V4.6h13.269v9.067zM17.733 7.333v4.4h-1.6v-4.4h1.6zm-4.4 0v4.4h-1.6v-4.4h1.6z"/></svg>';
    case 'kick':      return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 2h6v6h2V6h2V4h2V2h6v6h-2v2h-2v2h-2v2h2v2h2v2h2v6h-6v-2h-2v-2h-2v-2H8v6H2V2z"/></svg>';
    case 'youtube':   return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
    case 'tiktok':    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.42a8.3 8.3 0 0 0 4.85 1.55V6.69h-1.92z"/></svg>';
    case 'x':         return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>';
    case 'instagram': return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.81.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.81-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.81-.25-2.23-.41a3.71 3.71 0 0 1-1.38-.9 3.71 3.71 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.81.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0-2.16C8.74 0 8.33.01 7.05.07 5.78.13 4.9.32 4.14.61c-.79.31-1.46.72-2.13 1.39C1.34 2.67.93 3.34.62 4.13.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.55 2.91.31.79.72 1.46 1.39 2.13.67.67 1.34 1.08 2.13 1.39.76.29 1.64.49 2.91.55C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.55.79-.31 1.46-.72 2.13-1.39.67-.67 1.08-1.34 1.39-2.13.29-.76.49-1.64.55-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.55-2.91-.31-.79-.72-1.46-1.39-2.13A5.88 5.88 0 0 0 19.86.61c-.76-.29-1.64-.49-2.91-.55C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>';
    case 'discord':   return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.075.075 0 0 0-.079.038c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.65 12.65 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
    default: return '';
  }
}

// Build the PLATFORMS link list from a socials object. Each non-null
// handle becomes a branded button. Order is fixed so the page is
// stable regardless of which platforms a creator has.
function buildPlatformLinks(socials) {
  if (!socials) return [];
  const handle = (h) => String(h).replace(/^@/, '').trim();
  const out = [];
  if (socials.twitch)    out.push({ key: 'twitch',    label: 'Twitch',    url: `https://twitch.tv/${encodeURIComponent(handle(socials.twitch))}`,                       sub: '@' + handle(socials.twitch) });
  if (socials.kick)      out.push({ key: 'kick',      label: 'Kick',      url: `https://kick.com/${encodeURIComponent(handle(socials.kick))}`,                          sub: '@' + handle(socials.kick) });
  if (socials.youtube)   out.push({ key: 'youtube',   label: 'YouTube',   url: socials.youtube.startsWith('http') ? socials.youtube : `https://youtube.com/@${encodeURIComponent(handle(socials.youtube))}`, sub: '@' + handle(socials.youtube) });
  if (socials.tiktok)    out.push({ key: 'tiktok',    label: 'TikTok',    url: `https://tiktok.com/@${encodeURIComponent(handle(socials.tiktok))}`,                      sub: '@' + handle(socials.tiktok) });
  if (socials.x)         out.push({ key: 'x',         label: 'X',         url: `https://x.com/${encodeURIComponent(handle(socials.x))}`,                                 sub: '@' + handle(socials.x) });
  if (socials.instagram) out.push({ key: 'instagram', label: 'Instagram', url: `https://instagram.com/${encodeURIComponent(handle(socials.instagram))}`,                 sub: '@' + handle(socials.instagram) });
  if (socials.discord)   out.push({ key: 'discord',   label: 'Discord',   url: socials.discord.startsWith('http') ? socials.discord : `https://discord.gg/${encodeURIComponent(handle(socials.discord))}`,  sub: 'Server' });
  return out;
}

function renderProfile({ handle, name, platform, avatar, liveEntry, clips, stats, affinity, socials, reportCard }) {
  const platUrl = platform === 'kick' ? `https://kick.com/${handle}` : `https://twitch.tv/${handle}`;
  const platLabel = platform === 'kick' ? 'Kick' : 'Twitch';
  const isLive = !!liveEntry?.is_live;
  const liveBanner = isLive ? renderLiveBanner(handle, platform, liveEntry) : '';

  const platformLinks = buildPlatformLinks(socials);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0d1f1f">
<script src="/pwa.js" defer></script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(name)} — UK GTA RP | ContentLore</title>
<meta name="description" content="${esc(name)} — UK GTA RP creator on ${platLabel}. Live status, recent clips, stream stats and server affinity.">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="ContentLore">
<meta property="og:title" content="${esc(name)} — UK GTA RP · ContentLore">
<meta property="og:description" content="${esc(name)} on ${platLabel} — live status, recent clips, monthly report card, server affinity.">
<meta property="og:image" content="https://contentlore.com/api/shoutout-card/${esc(handle)}">
<meta property="og:url" content="https://contentlore.com/creator-profile/${esc(handle)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(name)} — UK GTA RP · ContentLore">
<meta name="twitter:description" content="${esc(name)} on ${platLabel} — live status, recent clips, monthly report card, server affinity.">
<meta name="twitter:image" content="https://contentlore.com/api/shoutout-card/${esc(handle)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:oklch(0.09 0.04 295);--fg:oklch(0.97 0.02 320);
  --card:oklch(0.13 0.05 295);--card2:oklch(0.18 0.06 295);
  --ink-dim:oklch(0.78 0.05 320);--ink-faint:oklch(0.55 0.06 295);
  --signal:oklch(0.82 0.20 195);--signal-dim:oklch(0.65 0.18 195);--signal-cyan:oklch(0.85 0.18 200);
  --border:oklch(0.28 0.08 295);--live:oklch(0.82 0.20 195);
  --twitch:oklch(0.65 0.25 295);--kick:oklch(0.82 0.22 145);
  --tiktok:oklch(0.78 0.20 350);--youtube:oklch(0.68 0.27 25);
  --font-d:'Bebas Neue',Impact,sans-serif;--font-m:'JetBrains Mono',monospace;--font-b:'Inter',system-ui,sans-serif;
  --cut:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);
}
html{background:var(--bg);color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--font-b);-webkit-font-smoothing:antialiased;position:relative;min-height:100vh}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:1;background-image:repeating-linear-gradient(0deg,oklch(0.82 0.20 195/.04) 0 1px,transparent 1px 3px);mix-blend-mode:screen}
body>*{position:relative;z-index:3}

.nav{height:48px;background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;position:sticky;top:0;z-index:100}
.nav-brand{font-family:var(--font-d);font-size:22px;letter-spacing:2px;margin-right:24px;text-decoration:none;color:var(--fg);display:flex;align-items:center;gap:6px}
.nav-links{display:flex}
.nav-link{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);text-decoration:none;padding:14px;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nav-link:hover{color:var(--ink-dim)}
@media(max-width:700px){.nav-links{overflow-x:auto}}

.mx{max-width:1200px;margin:0 auto;padding:24px}
.back{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-m);font-size:13px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);text-decoration:none;margin-bottom:18px;transition:color .15s}
.back:hover{color:var(--signal)}

/* HERO */
.hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:32px 28px;margin-bottom:18px}
@media(max-width:600px){.hero{grid-template-columns:1fr;text-align:center}}
.hero-av{width:160px;height:160px;border-radius:50%;border:2px solid var(--signal);background:var(--card2);object-fit:cover;display:block;box-shadow:0 0 32px oklch(0.82 0.20 195/.3)}
@media(max-width:600px){.hero-av{margin:0 auto}}
.hero-av-ph{width:160px;height:160px;border-radius:50%;border:2px solid var(--border);background:var(--card2);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:64px;color:var(--ink-faint)}
.hero-info .h-kicker{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:3px;color:var(--signal);margin-bottom:8px}
.hero-info h1{font-family:var(--font-d);font-size:clamp(48px,8vw,84px);line-height:.95;letter-spacing:2px;margin-bottom:14px;word-break:break-word}
.hero-actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:600px){.hero-actions{justify-content:center}}
.btn{font-family:var(--font-d);font-size:15px;letter-spacing:2px;padding:11px 22px;text-decoration:none;clip-path:var(--cut);transition:all .2s;display:inline-block}
.btn-primary{background:var(--signal);color:var(--bg)}
.btn-primary:hover{box-shadow:0 0 22px oklch(0.82 0.20 195/.5);transform:translateY(-1px)}
.btn-ghost{background:var(--card2);border:1px solid var(--border);color:var(--fg)}
.btn-ghost:hover{border-color:var(--signal);color:var(--signal)}

/* LIVE BANNER */
.live-bar{display:flex;align-items:center;gap:12px;background:oklch(0.82 0.20 195/.12);border:1px solid var(--signal);clip-path:var(--cut);padding:14px 18px;margin-bottom:18px}
.live-bar .dot{width:10px;height:10px;border-radius:50%;background:var(--signal);animation:lp 2s infinite}
@keyframes lp{0%,100%{box-shadow:0 0 0 0 oklch(0.82 0.20 195/.8)}70%{box-shadow:0 0 0 10px oklch(0.82 0.20 195/0)}}
.live-bar .l-kicker{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--signal);font-weight:600}
.live-bar .l-title{font-family:var(--font-b);font-size:15px;color:var(--fg);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.live-bar .l-meta{font-family:var(--font-m);font-size:13px;color:var(--ink-dim);white-space:nowrap;display:flex;gap:10px}
.live-bar .l-meta .views{color:var(--signal);font-weight:600}
@media(max-width:700px){.live-bar{flex-wrap:wrap}.live-bar .l-title{order:3;flex-basis:100%}}
.embed-wrap{aspect-ratio:16/9;background:#000;border:1px solid var(--border);clip-path:var(--cut);overflow:hidden;margin-bottom:18px;position:relative}
.embed-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:none}

/* PLATFORMS — branded buttons rendering every non-null social */
:root{
  --x-col:oklch(0.97 0.02 320);
  --instagram-col:oklch(0.78 0.20 350);
  --discord-col:oklch(0.65 0.22 280);
}
.platforms{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
@media(max-width:600px){.platforms{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}}
.pbtn{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--card);
  border:1px solid var(--border);color:var(--fg);text-decoration:none;clip-path:var(--cut);
  transition:all .15s;position:relative;overflow:hidden}
.pbtn::before{content:'';position:absolute;inset:0;opacity:0;background:currentColor;transition:opacity .2s;pointer-events:none}
.pbtn:hover{transform:translateY(-2px);border-color:currentColor;box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 14px currentColor}
.pbtn:hover::before{opacity:.06}
.pbtn-icon{flex:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  border-radius:6px;background:oklch(0.18 0.06 295);color:currentColor;border:1px solid currentColor;
  box-shadow:0 0 8px currentColor}
.pbtn-text{display:flex;flex-direction:column;min-width:0;line-height:1}
.pbtn-label{font-family:var(--font-d);font-size:18px;letter-spacing:1.5px;color:var(--fg);
  margin-bottom:4px}
.pbtn-sub{font-family:var(--font-m);font-size:11px;letter-spacing:1px;color:currentColor;
  text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}
.pbtn-twitch{color:var(--twitch)}
.pbtn-kick{color:var(--kick)}
.pbtn-youtube{color:var(--youtube)}
.pbtn-tiktok{color:var(--tiktok)}
.pbtn-x{color:var(--x-col)}
.pbtn-instagram{color:var(--instagram-col)}
.pbtn-discord{color:var(--discord-col)}

/* SECTIONS */
.section{margin-top:32px}
.sec-h{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px}
.sec-h h2{font-family:var(--font-d);font-size:28px;letter-spacing:1px;color:var(--fg)}
.sec-h .sub{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint)}

/* STATS PANEL */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:18px}
.stat .v{font-family:var(--font-d);font-size:34px;letter-spacing:1px;line-height:1;color:var(--signal)}
.stat .l{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);margin-top:6px}
.stat .extra{font-family:var(--font-m);font-size:11px;color:var(--ink-dim);margin-top:6px}
.empty-block{background:var(--card);border:1px dashed var(--border);clip-path:var(--cut);padding:28px;text-align:center;font-family:var(--font-m);font-size:14px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:2px}

/* AFFINITY CHIPS */
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:9px 14px;background:var(--card);border:1px solid var(--border);color:var(--ink-dim);display:inline-flex;align-items:center;gap:8px;transition:all .15s}
.chip:hover{border-color:var(--signal);color:var(--fg)}
.chip .n{font-family:var(--font-d);font-size:15px;color:var(--signal);letter-spacing:0}

/* CLIPS GRID */
.clips-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:850px){.clips-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.clips-grid{grid-template-columns:1fr}}
.clip{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);overflow:hidden;text-decoration:none;color:inherit;transition:all .2s;display:block}
.clip:hover{border-color:var(--signal);transform:translateY(-2px)}
.clip-thumb{aspect-ratio:16/9;background:var(--card2);position:relative;overflow:hidden}
.clip-thumb img{width:100%;height:100%;object-fit:cover}
.clip-vw{position:absolute;top:6px;right:6px;font-family:var(--font-m);font-size:11px;font-weight:600;padding:2px 7px;background:oklch(0.09 0.04 295/.85);color:var(--signal);border:1px solid oklch(0.82 0.20 195/.4)}
.clip-body{padding:12px 14px}
.clip-title{font-size:14px;line-height:1.5;color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
.clip-when{font-family:var(--font-m);font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;margin-top:6px}

/* MONTHLY REPORT CARD */
.report-card{background:linear-gradient(135deg,var(--card),oklch(0.18 0.06 295));border:1px solid var(--border);clip-path:var(--cut);padding:24px;position:relative;overflow:hidden}
.report-card::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at top right,oklch(0.82 0.20 195/.10),transparent 60%);pointer-events:none}
.rc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;position:relative}
.rc-title{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.rc-month{font-family:var(--font-d);font-size:30px;letter-spacing:1px;color:var(--fg)}
.rc-tag{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--signal);padding:3px 8px;background:oklch(0.82 0.20 195/.12);border:1px solid oklch(0.82 0.20 195/.4)}
.rc-share{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:1.5px;padding:8px 14px;background:var(--card2);border:1px solid var(--border);color:var(--ink-dim);cursor:pointer;transition:all .15s}
.rc-share:hover{border-color:var(--signal);color:var(--signal)}
.rc-share.copied{border-color:var(--signal);color:var(--signal);background:oklch(0.82 0.20 195/.1)}
.rc-rank{display:flex;align-items:center;gap:14px;background:var(--card2);border:1px solid var(--border);padding:14px 18px;clip-path:var(--cut);margin-bottom:18px;position:relative}
.rc-rank-badge{font-family:var(--font-d);font-size:48px;line-height:1;color:var(--signal);text-shadow:0 0 12px oklch(0.82 0.20 195/.5);min-width:90px}
.rc-rank-badge .of{font-size:18px;color:var(--ink-faint)}
.rc-rank-text{font-family:var(--font-m);font-size:13px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:2px}
.rc-rank-text strong{color:var(--fg);font-weight:600}
.rc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px}
@media(max-width:700px){.rc-stats{grid-template-columns:repeat(2,1fr)}}
.rc-stat{background:var(--card2);border:1px solid var(--border);padding:14px;clip-path:var(--cut)}
.rc-stat .v{font-family:var(--font-d);font-size:30px;letter-spacing:1px;line-height:1;color:var(--signal-cyan)}
.rc-stat .l{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);margin-top:6px}
.rc-stat .e{font-family:var(--font-m);font-size:11px;color:var(--ink-dim);margin-top:4px}
.rc-spark-wrap{background:var(--card2);border:1px solid var(--border);padding:14px 18px;clip-path:var(--cut);position:relative}
.rc-spark-h{display:flex;justify-content:space-between;font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);margin-bottom:10px}
.rc-spark-h strong{color:var(--signal-cyan);font-weight:600}
.rc-spark{display:flex;align-items:flex-end;gap:2px;height:60px}
.rc-spark-bar{flex:1;background:oklch(0.82 0.20 195/.4);min-height:2px;transition:background .2s}
.rc-spark-bar.today{background:var(--signal);box-shadow:0 0 8px var(--signal)}
.rc-spark-bar.zero{background:oklch(0.18 0.06 295/.6)}

.footer{border-top:1px solid var(--border);padding:24px;margin-top:40px;text-align:center;font-family:var(--font-m);font-size:13px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint)}

::selection{background:var(--signal);color:var(--bg)}
</style>
</head>
<body>

<nav class="nav">
  <a href="/gta-rp/" class="nav-brand"><img src="/logo.png" alt="ContentLore" style="height:40px;filter:brightness(1.1)" loading="eager"></a>
  <div class="nav-links">
    <a href="/gta-rp/" class="nav-link">Live</a>
    <a href="/gta-rp/now/" class="nav-link">Now</a>
    <a href="/gta-rp/multi/" class="nav-link">Multi-View</a>
    <a href="/gta-rp/clips/" class="nav-link">Clips</a>
    <a href="/gta-rp/timeline/" class="nav-link">Timeline</a>
    <a href="/gta-rp/streaks/" class="nav-link">Streaks</a>
    <a href="/gta-rp/servers/" class="nav-link">Servers</a>
  </div>
</nav>

<div class="mx">
  <a href="/gta-rp/" class="back">← Back to roster</a>

  <div class="hero">
    ${avatar
      ? `<img class="hero-av" src="${esc(avatar)}" alt="${esc(name)}">`
      : `<div class="hero-av-ph">${esc((name || '?').charAt(0))}</div>`}
    <div class="hero-info">
      <div class="h-kicker">UK GTA RP · ${platLabel}</div>
      <h1>${esc(name)}</h1>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${esc(platUrl)}" target="_blank" rel="noopener">Follow on ${platLabel} ↗</a>
        ${isLive ? `<a class="btn btn-ghost" href="#live">Watch now ↓</a>` : ''}
        <span data-cl-notify="${esc(handle)}" style="display:inline-block;vertical-align:middle"></span>
      </div>
    </div>
  </div>

  ${liveBanner}

  <div class="section">
    <div class="sec-h"><h2>Platforms</h2><span class="sub">${platformLinks.length} verified · click to open</span></div>
    <div class="platforms">
      ${platformLinks.map(p => `
        <a class="pbtn pbtn-${p.key}" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="${p.label} — ${esc(p.sub)}">
          <span class="pbtn-icon">${platformIcon(p.key)}</span>
          <span class="pbtn-text">
            <span class="pbtn-label">${p.label}</span>
            <span class="pbtn-sub">${esc(p.sub)} ↗</span>
          </span>
        </a>`).join('')}
    </div>
  </div>

  ${renderReportCard(handle, name, reportCard)}

  <div class="section">
    <div class="sec-h"><h2>Stats</h2><span class="sub">Last 90 days</span></div>
    ${stats.hasData ? renderStats(stats) : `<div class="empty-block">No session history recorded yet for this creator. Stats will populate as the scheduler observes streams over time.</div>`}
  </div>

  ${affinity.length ? `
  <div class="section">
    <div class="sec-h"><h2>Server Affinity</h2><span class="sub">Most recent 30 sessions</span></div>
    <div class="chips">
      ${affinity.map(a => `<span class="chip">${esc(a.name)} <span class="n">${a.n}</span></span>`).join('')}
    </div>
  </div>` : ''}

  <div class="section">
    <div class="sec-h"><h2>Recent Clips</h2><a class="sub" href="/gta-rp/clips/" style="color:var(--signal);text-decoration:none">All clips →</a></div>
    ${clips.length ? `
      <div class="clips-grid">
        ${clips.map(renderClipCard).join('')}
      </div>` : `<div class="empty-block">${platform === 'kick' ? "Kick doesn't expose a clips API yet — we'll surface clips here as soon as they ship one." : 'No clips in the last 30 days.'}</div>`}
  </div>
</div>

<div class="footer">ContentLore · UK GTA RP · Creator Profile</div>

<script>
// Lightweight live-status refresh every 60s — only updates the banner, not the whole page.
async function refreshLive() {
  try {
    const r = await fetch('/api/uk-rp-live');
    const d = await r.json();
    if (!d.ok) return;
    const me = (d.live || []).find(c => c.handle === '${esc(handle)}');
    const bar = document.getElementById('live-bar');
    if (me && me.is_live) {
      const wasLive = !!bar;
      // If we weren't live before and now are, hard-reload to pull the embed.
      if (!wasLive) location.reload();
      else {
        document.getElementById('lb-views').textContent = formatBig(me.viewers || 0) + ' watching';
        document.getElementById('lb-uptime').textContent = formatUptime(me.uptime_mins);
        document.getElementById('lb-title').textContent = me.stream_title || '';
      }
    } else if (bar) {
      // Went offline — strip the embed banner.
      bar.remove();
      const wrap = document.getElementById('embed-wrap');
      if (wrap) wrap.remove();
    }
  } catch (e) { /* ignore */ }
}
function formatBig(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'k';return String(n)}
function formatUptime(m){if(!m)return '0m';const h=Math.floor(m/60),r=m%60;return h>0?h+'h '+r+'m':r+'m'}
setInterval(refreshLive, 60000);
</script>
</body>
</html>`;
}

function renderLiveBanner(handle, platform, e) {
  const embedUrl = platform === 'kick'
    ? `https://player.kick.com/${encodeURIComponent(handle)}`
    : `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=contentlore.com&autoplay=true&muted=true`;
  return `
    <div class="live-bar" id="live-bar">
      <div class="dot"></div>
      <span class="l-kicker">Live</span>
      <span class="l-title" id="lb-title">${esc(e.stream_title || '')}</span>
      <span class="l-meta">
        <span class="views" id="lb-views">${formatBig(e.viewers || 0)} watching</span>
        <span id="lb-uptime">${formatUptime(e.uptime_mins)}</span>
        ${e.game_name ? `<span>· ${esc(e.game_name)}</span>` : ''}
      </span>
    </div>
    <div class="embed-wrap" id="embed-wrap"><iframe src="${embedUrl}" allow="autoplay; fullscreen" allowfullscreen></iframe></div>
    <a id="live" style="position:absolute;visibility:hidden"></a>
  `;
}

function renderReportCard(handle, name, rc) {
  if (!rc) return '';
  if (!rc.hasData) {
    return `
      <div class="section" id="report-card">
        <div class="sec-h"><h2>Monthly Report Card</h2><span class="sub">${esc(rc.monthLabel)}</span></div>
        <div class="empty-block">No activity recorded for ${esc(name)} this month yet. Check back once they next stream.</div>
      </div>
    `;
  }

  const maxMins = Math.max(1, ...rc.dailyMins);
  const todayIdx = new Date().getUTCDate() - 1;
  const sparkBars = rc.dailyMins.map((m, i) => {
    const pct = Math.max(0, Math.round((m / maxMins) * 100));
    const cls = m === 0 ? 'zero' : (i === todayIdx ? 'today' : '');
    const title = `Day ${i + 1}: ${(m / 60).toFixed(1)}h`;
    return `<div class="rc-spark-bar ${cls}" style="height:${Math.max(6, pct)}%" title="${title}"></div>`;
  }).join('');

  const rankEmoji =
    rc.rank == null ? '📊' :
    rc.rank === 1 ? '🥇' :
    rc.rank === 2 ? '🥈' :
    rc.rank === 3 ? '🥉' :
    rc.rank <= 10 ? '⭐' : '📈';

  return `
    <div class="section" id="report-card">
      <div class="sec-h">
        <h2>Monthly Report Card</h2>
        <span style="display:flex;gap:8px">
          <a class="rc-share" href="/api/shoutout-card/${esc(handle)}" target="_blank" rel="noopener" style="text-decoration:none">📸 Shoutout card ↗</a>
          <button class="rc-share" type="button" id="rc-share-btn">Share this report</button>
        </span>
      </div>
      <div class="report-card">
        <div class="rc-head">
          <div class="rc-title">
            <div class="rc-month">${esc(rc.monthLabel)}</div>
            <span class="rc-tag">${rankEmoji} ${rc.rank != null ? `Rank #${rc.rank} of ${rc.rankOf}` : 'Unranked'}</span>
          </div>
        </div>

        <div class="rc-rank">
          <div class="rc-rank-badge">${rc.rank != null ? `#${rc.rank}` : '—'}<span class="of"> / ${rc.rankOf}</span></div>
          <div class="rc-rank-text">
            <strong>${esc(name)}</strong> sits at <strong>${rc.rank != null ? `rank ${rc.rank}` : '—'}</strong> on the curated 26 hours leaderboard for ${esc(rc.monthLabel)}.
          </div>
        </div>

        <div class="rc-stats">
          <div class="rc-stat"><div class="v">${rc.hours}</div><div class="l">Hours streamed</div><div class="e">${rc.sessions} session${rc.sessions === 1 ? '' : 's'}</div></div>
          <div class="rc-stat"><div class="v">${formatBig(rc.avgViewers)}</div><div class="l">Avg viewers</div><div class="e">across all sessions</div></div>
          <div class="rc-stat"><div class="v">${formatBig(rc.peakViewers)}</div><div class="l">Peak viewers</div><div class="e">single best stream</div></div>
          <div class="rc-stat"><div class="v" style="font-size:22px;color:var(--signal)">${rc.topServer ? esc(rc.topServer) : '—'}</div><div class="l">Most-played server</div><div class="e">by session count</div></div>
        </div>

        <div class="rc-spark-wrap">
          <div class="rc-spark-h"><span>Daily hours · ${esc(rc.monthLabel)}</span><strong>peak ${(maxMins / 60).toFixed(1)}h</strong></div>
          <div class="rc-spark">${sparkBars}</div>
        </div>
      </div>
    </div>
    <script>
      (function(){
        var btn = document.getElementById('rc-share-btn');
        if (!btn) return;
        btn.addEventListener('click', async function(){
          var url = location.origin + location.pathname + '#report-card';
          try { await navigator.clipboard.writeText(url); }
          catch (e) {
            var ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
          }
          var orig = btn.textContent;
          btn.textContent = 'Copied ✓';
          btn.classList.add('copied');
          setTimeout(function(){ btn.textContent = orig; btn.classList.remove('copied'); }, 1600);
        });
      })();
    </script>
  `;
}

function renderStats(s) {
  const lastStream = s.lastStreamAt ? timeAgo(s.lastStreamAt) : '—';
  return `
    <div class="stats">
      <div class="stat"><div class="v">${s.count}</div><div class="l">Sessions</div></div>
      <div class="stat"><div class="v">${s.hours}</div><div class="l">Hours streamed</div></div>
      <div class="stat"><div class="v">${formatBig(s.avgViewers)}</div><div class="l">Avg viewers</div><div class="extra">across all sessions</div></div>
      <div class="stat"><div class="v">${formatBig(s.peakViewers)}</div><div class="l">Peak viewers</div><div class="extra">last seen ${lastStream}</div></div>
    </div>
  `;
}

function renderClipCard(c) {
  return `
    <a class="clip" href="${esc(c.url)}" target="_blank" rel="noopener">
      <div class="clip-thumb">
        ${c.thumbnail_url ? `<img src="${esc(c.thumbnail_url)}" alt="" loading="lazy">` : ''}
        <span class="clip-vw">${formatBig(c.view_count)}</span>
      </div>
      <div class="clip-body">
        <div class="clip-title">${esc(c.title || 'Untitled clip')}</div>
        <div class="clip-when">${timeAgoIso(c.created_at)}</div>
      </div>
    </a>
  `;
}

function notFoundPage(handle) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found · ContentLore</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>body{background:oklch(0.09 0.04 295);color:oklch(0.97 0.02 320);font-family:'JetBrains Mono',monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-family:'Bebas Neue';font-size:96px;letter-spacing:4px;color:oklch(0.82 0.20 195);margin-bottom:8px}p{font-size:14px;text-transform:uppercase;letter-spacing:2px;color:oklch(0.55 0.06 295);margin-bottom:24px}a{color:oklch(0.82 0.20 195);text-decoration:none;font-size:13px;text-transform:uppercase;letter-spacing:2px;border:1px solid oklch(0.82 0.20 195);padding:11px 22px}a:hover{background:oklch(0.82 0.20 195);color:oklch(0.09 0.04 295)}</style>
</head><body><h1>404</h1><p>"${esc(handle)}" isn't on the curated UK GTA RP roster.</p><a href="/gta-rp/">← Back to roster</a></body></html>`;
  return new Response(body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ================================================================
// Helpers
// ================================================================

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBig(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function formatUptime(m) {
  if (!m) return '0m';
  const h = Math.floor(m / 60), r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}
function timeAgo(unixSec) {
  const diff = Math.max(0, Date.now() / 1000 - unixSec);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function timeAgoIso(iso) {
  if (!iso) return '';
  return timeAgo(Math.floor(new Date(iso).getTime() / 1000));
}

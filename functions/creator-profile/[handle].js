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

// Allowlist now lives in D1 — fetched per-request via getCuratedEntry.
import { getCuratedEntry } from '../_curated.js';

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
  { id: '9kings',      name: '9 Kings RP',     keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
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
  const entry = await getCuratedEntry(env, rawHandle);

  if (!entry) return notFoundPage(rawHandle);

  // Pull the live state, clips cache, and D1 history in parallel.
  const [liveCache, clipsCache, dbProfile, sessionRows, monthRanks, weekRanks, connections] = await Promise.all([
    getLiveCache(env, request),
    getClipsCache(env, request),
    lookupDbCreator(env, entry.handle),
    querySessions(env, entry.handle).catch(() => null),
    queryMonthRanks(env).catch(() => []),
    queryWeekRanks(env).catch(() => []),
    queryConnections(env, entry.handle).catch(() => []),
  ]);

  const liveEntry = (liveCache?.live || []).find(c => c.handle === entry.handle) || null;
  const clips = (clipsCache?.clips || []).filter(c => c.creator_handle === entry.handle).slice(0, 6);
  const stats = aggregateStats(sessionRows || []);
  const affinity = aggregateServerAffinity(sessionRows || []);
  const reportCard = buildReportCard(entry.handle, sessionRows || [], monthRanks);
  const dashboard = buildWeeklyDashboard(entry.handle, sessionRows || [], weekRanks);

  const display = liveEntry?.display_name || dbProfile?.display_name || entry.name;
  const avatar = liveEntry?.avatar_url || dbProfile?.avatar_url || null;
  // Prefer the canonical allowlist socials (they're the source of truth)
  // and merge over anything the live API returned in case future fields
  // get added to the live shape first.
  const socials = mergeSocials(entry.socials, liveEntry?.socials);

  return new Response(renderProfile({
    handle: entry.handle, name: display, platform: entry.platform,
    avatar, liveEntry, clips, stats, affinity, socials, reportCard, dashboard, connections,
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

// Hours-per-creator across the curated allowlist for the last 7 days.
// Used to compute the weekly dashboard rank.
async function queryWeekRanks(env) {
  const start = Math.floor(Date.now() / 1000) - 7 * 86400;
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

// "Often plays with" — pairs of curated creators whose stream sessions overlap
// in time over the last 90 days. Strongest signal we have without parsing
// stream titles for shared characters / servers (server detection is JS-side).
//
// SQL strategy: self-join stream_sessions against itself, constrained to A's
// sessions on one side and any other curated creator on the other. Time
// overlap = MIN(end_a, end_b) - MAX(start_a, start_b), clamped at zero.
// is_primary=1 on the other side disambiguates dual-platform creators
// (dynamoses, bags) so each peer reports once with their canonical handle.
async function queryConnections(env, handle) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 90 * 86400;
  try {
    const res = await env.DB.prepare(`
      SELECT cp_other.handle AS handle,
             c.display_name AS display_name,
             c.avatar_url AS avatar_url,
             SUM(MAX(0,
               MIN(IFNULL(ss_a.ended_at, ?), IFNULL(ss_other.ended_at, ?))
               - MAX(ss_a.started_at, ss_other.started_at)
             )) AS overlap_secs,
             COUNT(*) AS overlap_sessions,
             MAX(MIN(IFNULL(ss_a.ended_at, ?), IFNULL(ss_other.ended_at, ?))) AS last_overlap_at
        FROM stream_sessions ss_a
        INNER JOIN creator_platforms cp_a
                ON cp_a.creator_id = ss_a.creator_id AND cp_a.handle = ?
        INNER JOIN stream_sessions ss_other
                ON ss_other.creator_id != ss_a.creator_id
               AND ss_other.started_at < IFNULL(ss_a.ended_at, ?)
               AND IFNULL(ss_other.ended_at, ?) > ss_a.started_at
        INNER JOIN creator_platforms cp_other
                ON cp_other.creator_id = ss_other.creator_id AND cp_other.is_primary = 1
        INNER JOIN curated_creators cc
                ON cc.handle = cp_other.handle AND cc.active = 1
        LEFT JOIN creators c
                ON c.id = ss_other.creator_id
       WHERE ss_a.started_at >= ?
       GROUP BY cp_other.handle, c.display_name, c.avatar_url
       HAVING overlap_secs > 0
       ORDER BY overlap_secs DESC
       LIMIT 6
    `).bind(now, now, now, now, handle, now, now, since).all();
    return (res.results || []).map(r => ({
      handle: String(r.handle).toLowerCase(),
      display_name: r.display_name || r.handle,
      avatar_url: r.avatar_url || null,
      overlap_secs: Number(r.overlap_secs || 0),
      overlap_sessions: Number(r.overlap_sessions || 0),
      last_overlap_at: Number(r.last_overlap_at || 0),
    }));
  } catch {
    return [];
  }
}

// Build the weekly dashboard payload. Pulls last-7d metrics from the
// existing sessions array (so no extra D1 query needed for the
// per-creator slice — only the rank query above is global).
function buildWeeklyDashboard(handle, sessions, weekRanks) {
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 86400;
  const week = sessions.filter(s => Number(s.started_at || 0) >= weekAgo);
  if (!week.length) {
    return { hasData: false };
  }

  const totalMins = week.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const peak      = week.reduce((m, r) => Math.max(m, r.peak_viewers || 0), 0);
  const weighted  = week.reduce((s, r) => s + (r.avg_viewers || 0) * (r.duration_mins || 0), 0);
  const avg       = totalMins > 0 ? Math.round(weighted / totalMins) : 0;

  // Server split — minutes per server (top 5).
  const serverMins = new Map();
  for (const s of week) {
    const sv = detectServer(s.final_title);
    if (!sv) continue;
    serverMins.set(sv.id, { name: sv.name, mins: (serverMins.get(sv.id)?.mins || 0) + (s.duration_mins || 0) });
  }
  const serverSplit = [...serverMins.values()].sort((a, b) => b.mins - a.mins).slice(0, 5);
  const serverTotal = serverSplit.reduce((s, x) => s + x.mins, 0) || 1;

  // Schedule heatmap — 7 days × 24 hours, in UK time. Counts minutes
  // bucketed into the hour the session started in (cheap and good
  // enough to show a "they stream at" pattern). Use the full sessions
  // array (90 days), not just this week, so the pattern is meaningful
  // even for streamers who took the week off.
  const schedule = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const s of sessions) {
    const t = Number(s.started_at || 0);
    if (!t) continue;
    const d = new Date(t * 1000);
    // Convert UTC to a UK-local hour-of-day. Approximation: BST adds
    // 1h between Mar–Oct. Computing the exact zone offset on every
    // call is overkill; UK time is UTC+0/UTC+1.
    const m = d.getUTCMonth();
    const offset = (m >= 2 && m <= 9) ? 1 : 0; // March–October ≈ BST
    const ukDate = new Date(t * 1000 + offset * 3600_000);
    const dow = (ukDate.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const hod = ukDate.getUTCHours();
    schedule[dow][hod] += (s.duration_mins || 0);
  }
  const scheduleMax = Math.max(1, ...schedule.flat());

  // Rank in the last-7d hours leaderboard.
  let rank = null;
  if (Array.isArray(weekRanks) && weekRanks.length) {
    const idx = weekRanks.findIndex(r => r.handle === handle);
    if (idx !== -1) rank = idx + 1;
  }

  // ----- Schedule pattern insights -----
  // Top-3 days of the week by total minutes streamed (90-day window, same as
  // the heatmap data above). Top hour-of-day across all sessions.
  const dowTotals = schedule.map(row => row.reduce((s, m) => s + m, 0));
  const dowRanked = dowTotals
    .map((mins, i) => ({ i, mins }))
    .filter(d => d.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const dowNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const topDays = dowRanked.slice(0, 3).map(d => dowNames[d.i]);

  const hodTotals = new Array(24).fill(0);
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) hodTotals[h] += schedule[d][h];
  const peakHour = hodTotals.reduce((best, v, i, arr) => v > arr[best] ? i : best, 0);

  // "Likely live now / soon" — bucket the current UK day-of-week and the
  // next 3 hour-of-day cells, return total historical minutes there. If
  // the bucket is in the top quartile of all 168 (7×24) cells, surface
  // a prediction badge.
  const now = Date.now();
  const m = new Date(now).getUTCMonth();
  const offset = (m >= 2 && m <= 9) ? 1 : 0;
  const ukNow = new Date(now + offset * 3600_000);
  const todayDow = (ukNow.getUTCDay() + 6) % 7;
  const ukHour = ukNow.getUTCHours();
  const cellsAhead = [0, 1, 2].map(off => schedule[todayDow][(ukHour + off) % 24]);
  const aheadMins = cellsAhead.reduce((s, x) => s + x, 0);
  const allCells = schedule.flat().filter(v => v > 0).sort((a, b) => b - a);
  const topQuartileCutoff = allCells.length ? allCells[Math.floor(allCells.length * 0.25)] || 0 : 0;
  const likelyLiveSoon = aheadMins > 0 && cellsAhead.some(v => v >= topQuartileCutoff);

  // Next predicted slot — the future cell (within the next 24h) with the
  // most historical minutes. Returned as a label like "Tomorrow 8pm" or
  // "Tonight 10pm".
  let nextSlot = null;
  let nextSlotMins = 0;
  for (let off = 0; off < 24; off++) {
    const dow = (todayDow + Math.floor((ukHour + off) / 24)) % 7;
    const h = (ukHour + off) % 24;
    const mins = schedule[dow][h];
    if (mins > nextSlotMins) {
      nextSlotMins = mins;
      const isToday = off === 0 || (ukHour + off < 24);
      const ampm = h >= 12 ? 'pm' : 'am';
      const hr = h % 12 === 0 ? 12 : h % 12;
      nextSlot = {
        label: `${isToday ? 'Today' : 'Tomorrow'} ${hr}${ampm}`,
        mins,
      };
    }
  }

  return {
    hasData: true,
    sessions: week.length,
    hours: Math.round(totalMins / 60 * 10) / 10,
    avgViewers: avg,
    peakViewers: peak,
    serverSplit,        // [{name, mins}, ...]
    serverTotalMins: serverTotal,
    schedule,           // 7×24 minutes
    scheduleMax,
    rank,
    rankOf: weekRanks?.length || 0,
    todayDow,
    pattern: {
      topDays,
      peakHour,
      likelyLiveSoon,
      nextSlot,
    },
  };
}

// Slice the session list down to the current calendar month and roll up
// the metrics the report card surfaces. Rank is derived by looking up
// this creator's position in the precomputed monthRanks list.
function buildReportCard(handle, sessions, monthRanks) {
  const start = monthStartUnix();
  const monthSessions = sessions.filter(s => Number(s.started_at || 0) >= start);
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });
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

function renderProfile({ handle, name, platform, avatar, liveEntry, clips, stats, affinity, socials, reportCard, dashboard, connections }) {
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

/* OFTEN PLAYS WITH */
.peers{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.peer{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);clip-path:var(--cut);text-decoration:none;color:inherit;transition:all .15s}
.peer:hover{border-color:var(--signal);transform:translateY(-2px);box-shadow:0 6px 18px oklch(0.82 0.20 195/.15)}
.peer-av{width:44px;height:44px;border-radius:50%;background:var(--card2);object-fit:cover;flex-shrink:0;border:1px solid var(--border)}
.peer-av-ph{width:44px;height:44px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:18px;color:var(--ink-faint);flex-shrink:0;border:1px solid var(--border)}
.peer-info{display:flex;flex-direction:column;min-width:0;flex:1}
.peer-name{font-family:var(--font-d);font-size:18px;letter-spacing:1px;line-height:1;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.peer-meta{font-family:var(--font-m);font-size:11px;letter-spacing:1px;color:var(--ink-faint);text-transform:uppercase;margin-top:4px;display:flex;gap:6px;align-items:baseline}
.peer-meta .h{color:var(--signal-cyan);font-weight:600}

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

/* THIS WEEK DASHBOARD */
.dashboard{margin-top:32px}
.dh-grid{display:grid;grid-template-columns:1.4fr 1fr;grid-template-rows:auto auto;gap:14px}
.dh-stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
@media(max-width:900px){.dh-grid{grid-template-columns:1fr}.dh-stats{grid-template-columns:repeat(2,1fr)}}
.dh-stat{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:16px 18px}
.dh-stat .v{font-family:var(--font-d);font-size:30px;letter-spacing:1px;line-height:1;color:var(--signal)}
.dh-stat .l{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);margin-top:6px}
.dh-rank{background:var(--card);border:1px solid var(--signal);clip-path:var(--cut);padding:16px 18px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:var(--signal-cyan)}
.dh-rank{font-family:var(--font-d);font-size:36px;line-height:1}
.dh-rank-of{font-size:16px;color:var(--ink-faint);margin-left:4px}
.dh-rank-l{font-family:var(--font-m);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-faint);margin-top:4px}

.dh-clip,.dh-srv,.dh-heat{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:16px}
.dh-card-h{font-family:var(--font-d);font-size:18px;letter-spacing:1.5px;color:var(--signal-cyan);margin-bottom:12px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dh-card-sub{font-family:var(--font-m);font-size:11px;letter-spacing:1.5px;color:var(--ink-faint);text-transform:uppercase}

.dh-clip-body{position:relative}
.dh-clip-iframe{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden}
.dh-clip-iframe iframe{width:100%;height:100%;border:0;display:block}
.dh-clip-meta{display:flex;justify-content:space-between;gap:12px;margin-top:10px;font-family:var(--font-m);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-faint)}
.dh-clip-meta a{color:var(--signal-cyan);text-decoration:none;flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
.dh-clip-meta a:hover{color:var(--signal)}
.dh-clip-skel,.dh-empty{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:var(--ink-faint);font-family:var(--font-m);font-size:12px;letter-spacing:2px;text-transform:uppercase;background:var(--card2)}

.dh-srv-body{display:flex;flex-direction:column;gap:8px}
.dh-srv-row{display:grid;grid-template-columns:130px 1fr 40px;gap:10px;align-items:center;font-family:var(--font-m);font-size:12px}
.dh-srv-label{color:var(--fg);font-size:13px;font-weight:500}
.dh-srv-mins{color:var(--ink-faint);font-weight:400;margin-left:4px}
.dh-srv-bar{height:8px;background:var(--card2);overflow:hidden;border-radius:1px}
.dh-srv-fill{height:100%;background:linear-gradient(90deg,var(--signal-cyan),var(--signal));transition:width .3s}
.dh-srv-pct{color:var(--signal);font-weight:600;text-align:right}
@media(max-width:520px){.dh-srv-row{grid-template-columns:100px 1fr 36px}}

.dh-heat-grid{display:flex;flex-direction:column;gap:2px;font-family:var(--font-m)}
.dh-heat-row,.dh-heat-headerrow{display:grid;grid-template-columns:50px repeat(24,1fr);gap:2px;align-items:center}
.dh-heat-row.is-today{background:oklch(0.82 0.20 195/.07);border-radius:3px}
.dh-heat-row.is-today .dh-heat-dow{color:var(--signal);font-weight:600}
.dh-heat-dow{font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;text-align:right;padding-right:6px;display:flex;justify-content:flex-end;align-items:baseline;gap:4px}
.dh-today-tag{font-size:9px;letter-spacing:1px;color:var(--signal);font-weight:600}
.dh-heat-h{font-size:11px;color:var(--ink-faint);text-align:center}
.dh-heat-cell{aspect-ratio:1/1;background:oklch(0.18 0.06 295/.4);border-radius:2px}
.dh-heat-cell.l1{background:oklch(0.30 0.10 195/.55)}
.dh-heat-cell.l2{background:oklch(0.45 0.16 195/.65)}
.dh-heat-cell.l3{background:oklch(0.60 0.20 195/.80)}
.dh-heat-cell.l4{background:var(--signal);box-shadow:0 0 4px oklch(0.82 0.20 195/.5)}

/* Schedule pattern strip */
.dh-pattern{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-family:var(--font-m)}
.dh-pat-pill{display:inline-flex;align-items:center;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding:6px 12px;border:1px solid var(--border);color:var(--ink-faint);background:var(--card2);border-radius:2px}
.dh-pat-pill.on{border-color:var(--signal);color:var(--signal);background:oklch(0.82 0.20 195/.12);box-shadow:0 0 14px oklch(0.82 0.20 195/.18)}
.dh-pat-cell{display:inline-flex;flex-direction:column;font-family:var(--font-m);padding:6px 12px;background:var(--card2);border:1px solid var(--border);border-radius:2px;line-height:1.2}
.dh-pat-cell .lbl{font-size:9px;letter-spacing:1.5px;color:var(--ink-faint);text-transform:uppercase}
.dh-pat-cell .val{font-size:13px;color:var(--fg);margin-top:2px;font-weight:500}
.dh-heat-legend{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:10px;font-family:var(--font-m);font-size:11px;color:var(--ink-faint);letter-spacing:1px;text-transform:uppercase}
.dh-heat-legend .dh-heat-cell{width:14px;height:14px;aspect-ratio:auto}
.dh-link-btn{font-family:var(--font-m);font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:7px 12px;background:transparent;border:1px solid var(--signal-cyan);color:var(--signal-cyan);cursor:pointer;transition:all .15s}
.dh-link-btn:hover{background:var(--signal-cyan);color:var(--bg)}

/* WIDGET-CODE MODAL */
.wm-back{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:1500;display:none;align-items:center;justify-content:center;padding:20px}
.wm-back.open{display:flex}
.wm{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);width:min(540px,100%);padding:24px;color:var(--fg)}
.wm-h{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}
.wm-h h3{font-family:var(--font-d);font-size:26px;letter-spacing:1px}
.wm-close{background:transparent;border:1px solid var(--border);color:var(--ink-faint);width:32px;height:32px;font-size:20px;cursor:pointer;line-height:1}
.wm-close:hover{border-color:var(--signal);color:var(--fg)}
.wm-desc{font-size:13px;color:var(--ink-dim);line-height:1.5;margin-bottom:16px}
.wm-preview{background:var(--card2);border:1px solid var(--border);padding:16px;display:flex;justify-content:center;margin-bottom:16px}
.wm-label{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);display:block;margin-bottom:6px}
.wm-code{background:var(--card2);border:1px solid var(--border);padding:10px 12px;font-family:var(--font-m);font-size:12px;color:var(--signal-cyan);overflow-x:auto;white-space:pre-wrap;word-break:break-all;line-height:1.5}
.wm-row{display:flex;gap:10px;margin-top:18px;justify-content:flex-end}
.wm-btn{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:2px;padding:10px 18px;border:1px solid var(--border);background:var(--card2);color:var(--ink-dim);cursor:pointer;text-decoration:none;transition:all .15s}
.wm-btn:hover{border-color:var(--signal);color:var(--fg)}
.wm-btn.wm-primary{background:var(--signal);border-color:var(--signal);color:var(--bg);font-weight:600}
.wm-btn.wm-primary:hover{box-shadow:0 0 16px oklch(0.82 0.20 195/.5)}

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
    <a href="/gta-rp/party/" class="nav-link">Party</a>
    <a href="/gta-rp/clips/" class="nav-link">Clips</a>
    <a href="/gta-rp/timeline/" class="nav-link">Timeline</a>
    <a href="/gta-rp/analytics/" class="nav-link">Analytics</a>
    <a href="/gta-rp/health/" class="nav-link">Health</a>
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

  ${renderDashboard(handle, name, dashboard)}

  ${renderReportCard(handle, name, reportCard)}

  <div class="section">
    <div class="sec-h"><h2>Stats</h2><span class="sub">Last 90 days</span></div>
    ${stats.hasData ? renderStats(stats) : `<div class="empty-block">No stream history yet for this streamer. Stats fill in as they go live.</div>`}
  </div>

  ${affinity.length ? `
  <div class="section">
    <div class="sec-h"><h2>Server Affinity</h2><span class="sub">Most recent 30 sessions</span></div>
    <div class="chips">
      ${affinity.map(a => `<span class="chip">${esc(a.name)} <span class="n">${a.n}</span></span>`).join('')}
    </div>
  </div>` : ''}

  ${(connections && connections.length) ? `
  <div class="section">
    <div class="sec-h"><h2>Often Plays With</h2><span class="sub">Sessions overlapping in the last 90 days</span></div>
    <div class="peers">
      ${connections.map(p => renderPeerCard(p)).join('')}
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

<!-- Widget code modal -->
<div id="widget-modal" class="wm-back" role="dialog" aria-modal="true" aria-label="Embed code">
  <div class="wm">
    <div class="wm-h">
      <h3>Your ContentLore widget</h3>
      <button class="wm-close" id="wm-close" type="button" aria-label="Close">×</button>
    </div>
    <p class="wm-desc">Drop this iframe on your linktree, website or Discord. It updates itself every 60 seconds with live status, viewers, and platform links.</p>
    <div class="wm-preview"><iframe src="/api/widget/${esc(handle)}" width="300" height="100" frameborder="0" scrolling="no" style="border:0;display:block;margin:0 auto"></iframe></div>
    <label class="wm-label">Embed code</label>
    <pre class="wm-code" id="wm-code"></pre>
    <div class="wm-row">
      <button class="wm-btn wm-primary" id="wm-copy" type="button">Copy embed code</button>
      <a class="wm-btn" href="/api/widget/${esc(handle)}" target="_blank" rel="noopener">Open widget ↗</a>
    </div>
  </div>
</div>

<div class="footer">ContentLore · UK GTA RP · Creator Profile</div>

<script>
// Widget modal: build + copy the embed code.
(function () {
  var origin = location.origin;
  var widgetUrl = origin + '/api/widget/${esc(handle)}';
  var snippet = '<iframe src="' + widgetUrl + '" width="300" height="100" frameborder="0" scrolling="no"></iframe>';
  var btn = document.getElementById('widget-btn');
  var modal = document.getElementById('widget-modal');
  var code = document.getElementById('wm-code');
  if (code) code.textContent = snippet;
  function open() { modal.classList.add('open'); }
  function close() { modal.classList.remove('open'); }
  if (btn) btn.addEventListener('click', open);
  document.getElementById('wm-close')?.addEventListener('click', close);
  modal?.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  document.getElementById('wm-copy')?.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(snippet);
      this.textContent = 'Copied ✓';
      setTimeout(() => { this.textContent = 'Copy embed code'; }, 1600);
    } catch {
      var ta = document.createElement('textarea');
      ta.value = snippet; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
      this.textContent = 'Copied ✓';
      setTimeout(() => { this.textContent = 'Copy embed code'; }, 1600);
    }
  });
})();

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
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="rc-share" href="/wrapped/${esc(handle)}" style="text-decoration:none">✨ View Wrapped</a>
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
            <strong>${esc(name)}</strong> sits at <strong>${rc.rank != null ? `rank ${rc.rank}` : '—'}</strong> on the monthly hours leaderboard for ${esc(rc.monthLabel)}.
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

// ----------------------------------------------------------------
// "This Week" dashboard — the most prominent section on the profile.
// Shows weekly metrics, server split bars, schedule heatmap, and a
// slot for the best clip of the week (filled client-side).
// ----------------------------------------------------------------
function renderDashboard(handle, name, dash) {
  if (!dash || !dash.hasData) {
    return `
      <div class="section dashboard">
        <div class="sec-h"><h2>This Week</h2><span class="sub">Last 7 days</span></div>
        <div class="empty-block">No streams in the last seven days. The dashboard will fill in once ${esc(name)} next goes live.</div>
      </div>`;
  }

  // Server split bars.
  const splitHtml = dash.serverSplit.map(s => {
    const pct = Math.round((s.mins / dash.serverTotalMins) * 100);
    return `<div class="dh-srv-row">
      <div class="dh-srv-label">${esc(s.name)} <span class="dh-srv-mins">${formatHm(s.mins)}</span></div>
      <div class="dh-srv-bar"><div class="dh-srv-fill" style="width:${pct}%"></div></div>
      <div class="dh-srv-pct">${pct}%</div>
    </div>`;
  }).join('') || '<div class="empty-block">No tracked-server activity this week.</div>';

  // Schedule heatmap — 7 rows × 24 cells. Five intensity tiers based
  // on minutes streamed in that hour-bucket relative to the creator's
  // own week-of-data max. Today's row gets a `today` class so the
  // viewer can compare current hour against the streamer's pattern.
  const dows = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hod = ['00','','','','04','','','','08','','','','12','','','','16','','','','20','','',''];
  const heatRows = dash.schedule.map((row, i) => {
    const todayCls = (dash.todayDow === i) ? ' is-today' : '';
    return `<div class="dh-heat-row${todayCls}">
      <div class="dh-heat-dow">${dows[i]}${todayCls ? ' <span class="dh-today-tag">today</span>' : ''}</div>
      ${row.map((mins, h) => {
        const t = mins / dash.scheduleMax;
        const cls = mins === 0 ? '' : t > 0.75 ? 'l4' : t > 0.5 ? 'l3' : t > 0.25 ? 'l2' : 'l1';
        return `<div class="dh-heat-cell ${cls}" title="${dows[i]} ${String(h).padStart(2,'0')}:00 — ${formatHm(mins)}"></div>`;
      }).join('')}
    </div>`;
  }).join('');
  const hodLabels = hod.map(h => `<div class="dh-heat-h">${h}</div>`).join('');

  // Schedule pattern strip — sits above the heatmap. Surfaces the
  // "what's normal for this streamer" signal in plain English so a
  // viewer can predict whether tonight is likely to be a stream night.
  const p = dash.pattern || {};
  const peakAmpm = p.peakHour != null ? (p.peakHour >= 12 ? 'pm' : 'am') : '';
  const peakHr = p.peakHour != null ? (p.peakHour % 12 === 0 ? 12 : p.peakHour % 12) : '';
  const patternStrip = `<div class="dh-pattern">
    ${p.likelyLiveSoon ? `<span class="dh-pat-pill on">✦ Likely streaming next 3h</span>` : `<span class="dh-pat-pill">Outside usual window</span>`}
    ${p.topDays?.length ? `<span class="dh-pat-cell"><span class="lbl">Most active days</span><span class="val">${esc(p.topDays.join(' · '))}</span></span>` : ''}
    ${p.peakHour != null ? `<span class="dh-pat-cell"><span class="lbl">Typical start</span><span class="val">${peakHr}${peakAmpm} UK</span></span>` : ''}
    ${p.nextSlot ? `<span class="dh-pat-cell"><span class="lbl">Next likely slot</span><span class="val">${esc(p.nextSlot.label)}</span></span>` : ''}
  </div>`;

  const rankBlock = dash.rank
    ? `<div class="dh-rank">#${dash.rank}<span class="dh-rank-of">/ ${dash.rankOf}</span><div class="dh-rank-l">Weekly rank</div></div>`
    : '';

  return `
    <div class="section dashboard" id="weekly-dashboard">
      <div class="sec-h">
        <h2>This Week</h2>
        <div style="display:flex;gap:14px;align-items:center">
          <button id="widget-btn" class="dh-link-btn" type="button">Get widget code</button>
          <a class="sub" href="/api/shoutout-card/${esc(handle)}" target="_blank" style="color:var(--signal);text-decoration:none">Share your stats →</a>
        </div>
      </div>

      <div class="dh-grid">
        <div class="dh-stats">
          <div class="dh-stat"><div class="v">${dash.hours}</div><div class="l">Hours</div></div>
          <div class="dh-stat"><div class="v">${formatBig(dash.avgViewers)}</div><div class="l">Avg viewers</div></div>
          <div class="dh-stat"><div class="v">${formatBig(dash.peakViewers)}</div><div class="l">Peak</div></div>
          <div class="dh-stat"><div class="v">${dash.sessions}</div><div class="l">Sessions</div></div>
          ${rankBlock}
        </div>

        <div class="dh-clip" id="dh-best-clip" data-handle="${esc(handle)}">
          <div class="dh-card-h">Best Clip · Last 7 Days</div>
          <div class="dh-clip-body"><div class="dh-clip-skel">Loading…</div></div>
        </div>

        <div class="dh-srv">
          <div class="dh-card-h">Server Split</div>
          <div class="dh-srv-body">${splitHtml}</div>
        </div>

        <div class="dh-heat">
          <div class="dh-card-h">Schedule Pattern <span class="dh-card-sub">UK time · last 90 days</span></div>
          ${patternStrip}
          <div class="dh-heat-grid">
            <div class="dh-heat-headerrow">
              <div class="dh-heat-dow"></div>
              ${hodLabels}
            </div>
            ${heatRows}
          </div>
          <div class="dh-heat-legend">
            <span>Quieter</span>
            <span class="dh-heat-cell l1"></span>
            <span class="dh-heat-cell l2"></span>
            <span class="dh-heat-cell l3"></span>
            <span class="dh-heat-cell l4"></span>
            <span>Busier</span>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function(){
        var host = document.getElementById('dh-best-clip');
        if (!host) return;
        var handle = host.getAttribute('data-handle');
        fetch('/api/clips?range=7d').then(function(r){ return r.json(); }).then(function(d){
          if (!d || !d.ok) throw new Error('no clips');
          var mine = (d.clips || []).filter(function(c){ return c.creator_handle === handle; });
          mine.sort(function(a,b){ return (b.view_count||0) - (a.view_count||0); });
          var top = mine[0];
          var body = host.querySelector('.dh-clip-body');
          if (!top || !top.embed_url) {
            body.innerHTML = '<div class="dh-empty">No clips this week — they\\'ll show as Twitch indexes new ones.</div>';
            return;
          }
          var safeTitle = (top.title || '').replace(/[<>]/g, '');
          body.innerHTML = '<div class="dh-clip-iframe"><iframe src="' + top.embed_url + '" allow="autoplay; fullscreen" allowfullscreen></iframe></div>' +
            '<div class="dh-clip-meta"><a href="' + top.url + '" target="_blank" rel="noopener">' + safeTitle + ' ↗</a><span>' + (top.view_count || 0) + ' views</span></div>';
        }).catch(function(){
          host.querySelector('.dh-clip-body').innerHTML = '<div class="dh-empty">Could not load clips.</div>';
        });
      })();
    </script>
  `;
}

function formatHm(mins) {
  mins = Math.round(mins || 0);
  if (mins === 0) return '0m';
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
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

function renderPeerCard(p) {
  const av = p.avatar_url
    ? `<img class="peer-av" src="${esc(p.avatar_url)}" alt="${esc(p.display_name)}" loading="lazy">`
    : `<div class="peer-av-ph">${esc((p.display_name || p.handle || '?').charAt(0).toUpperCase())}</div>`;
  const hours = p.overlap_secs >= 3600
    ? Math.round(p.overlap_secs / 3600) + 'h shared'
    : Math.max(1, Math.round(p.overlap_secs / 60)) + 'm shared';
  const sessionsLabel = p.overlap_sessions === 1 ? '1 session' : `${p.overlap_sessions} sessions`;
  return `<a class="peer" href="/creator-profile/${esc(p.handle)}">
    ${av}
    <div class="peer-info">
      <div class="peer-name">${esc(p.display_name)}</div>
      <div class="peer-meta"><span class="h">${hours}</span><span>·</span><span>${sessionsLabel}</span></div>
    </div>
  </a>`;
}

function notFoundPage(handle) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found · ContentLore</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>body{background:oklch(0.09 0.04 295);color:oklch(0.97 0.02 320);font-family:'JetBrains Mono',monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-family:'Bebas Neue';font-size:96px;letter-spacing:4px;color:oklch(0.82 0.20 195);margin-bottom:8px}p{font-size:14px;text-transform:uppercase;letter-spacing:2px;color:oklch(0.55 0.06 295);margin-bottom:24px}a{color:oklch(0.82 0.20 195);text-decoration:none;font-size:13px;text-transform:uppercase;letter-spacing:2px;border:1px solid oklch(0.82 0.20 195);padding:11px 22px}a:hover{background:oklch(0.82 0.20 195);color:oklch(0.09 0.04 295)}</style>
</head><body><h1>404</h1><p>"${esc(handle)}" isn't on the UK GTA RP streamer roster.</p><a href="/gta-rp/">← Back to roster</a></body></html>`;
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

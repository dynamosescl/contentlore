// ================================================================
// functions/api/digest.js
// GET /api/digest
//
// Computes the "This Week in UK GTA RP" report card from D1:
//   - total hours streamed across the curated 26 (last 7d)
//   - peak viewership moment (creator + ts + viewers)
//   - most active server by viewer-hours
//   - new creators discovered in the last 7d (pending_creators)
//   - top 5 clips of the week (delegates to /api/clips?range=7d)
//
// 10-min Cache API hit. Re-aggregates fresh after that. The window
// is rolling — "last 7 days" not "calendar week" — so the report
// stays current regardless of when the page is loaded.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

// ALLOWED_HANDLES sourced from D1 via getHandlesSet(env) at request time.

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
  { id: 'drilluk',     name: 'Drill UK',       keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life',   keywords: ['british life', 'britishlife'] },
  { id: '9kings',      name: '9 Kings RP',     keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
];
const SERVERS_SORTED = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.id;
  return null;
}
const SERVER_NAME_BY_ID = Object.fromEntries(SERVERS.map(s => [s.id, s.name]));

const CACHE_TTL = 600;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/digest/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const ALLOWED_HANDLES = await getHandlesSet(env);
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;

    // --- 1) Sessions, with detected server ---
    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name,
             ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.duration_mins, ss.peak_viewers,
             ss.avg_viewers, ss.primary_category
      FROM stream_sessions ss
      INNER JOIN creators c ON c.id = ss.creator_id
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE ss.started_at >= ?
    `).bind(sevenDaysAgo).all();

    const sessions = (sessRes.results || []).filter(r =>
      ALLOWED_HANDLES.has(String(r.handle).toLowerCase())
    );

    let totalMins = 0;
    const serverHours = new Map();
    const liveCreators = new Set();
    for (const r of sessions) {
      liveCreators.add(String(r.handle).toLowerCase());
      const end = r.is_ongoing ? now : (r.ended_at || r.started_at);
      const mins = Math.max(0, Math.round((end - r.started_at) / 60));
      totalMins += mins;
      const sid = detectServer(r.final_title);
      if (!sid) continue;
      const peak = Number(r.peak_viewers || 0);
      const cur = serverHours.get(sid) || { mins: 0, viewer_hours: 0 };
      cur.mins += mins;
      cur.viewer_hours += (mins / 60) * peak;
      serverHours.set(sid, cur);
    }

    let mostActiveServer = null;
    for (const [sid, agg] of serverHours) {
      if (!mostActiveServer || agg.viewer_hours > mostActiveServer.viewer_hours) {
        mostActiveServer = { id: sid, name: SERVER_NAME_BY_ID[sid] || sid, ...agg };
      }
    }

    // --- 2) Peak viewership moment from snapshots ---
    const peakRes = await env.DB.prepare(`
      SELECT s.captured_at, s.viewers, s.stream_title, s.platform,
             c.display_name, cp.handle
      FROM snapshots s
      INNER JOIN creators c ON c.id = s.creator_id
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
        AND s.is_live = 1
      ORDER BY s.viewers DESC
      LIMIT 30
    `).bind(sevenDaysAgo).all();

    const peakRow = (peakRes.results || []).find(r =>
      ALLOWED_HANDLES.has(String(r.handle).toLowerCase())
    );
    const peakMoment = peakRow ? {
      handle: String(peakRow.handle).toLowerCase(),
      display_name: peakRow.display_name,
      platform: peakRow.platform,
      viewers: Number(peakRow.viewers || 0),
      ts: Number(peakRow.captured_at),
      title: peakRow.stream_title,
    } : null;

    // --- 3) New creators in pending_creators (last 7d) ---
    const newRes = await env.DB.prepare(`
      SELECT name, platform, discovered_title, discovered_viewers,
             detected_server, first_seen, status
      FROM pending_creators
      WHERE first_seen >= datetime('now', '-7 days')
      ORDER BY discovery_count DESC, first_seen DESC
      LIMIT 20
    `).all();
    const newCreators = (newRes.results || []).map(r => ({
      name: r.name,
      platform: r.platform,
      title: r.discovered_title,
      viewers: Number(r.discovered_viewers || 0),
      server: r.detected_server,
      first_seen: r.first_seen,
      status: r.status,
    }));

    // --- 4) Top 5 clips of the week (delegate to /api/clips?range=7d) ---
    let topClips = [];
    try {
      const url = new URL(request.url);
      const clipsUrl = new URL('/api/clips', url.origin);
      clipsUrl.searchParams.set('range', '7d');
      const clipsRes = await fetch(clipsUrl.toString(), { cf: { cacheTtl: 300 } });
      if (clipsRes.ok) {
        const cd = await clipsRes.json();
        topClips = (cd?.clips || []).slice(0, 5).map(c => ({
          id: c.id,
          title: c.title,
          creator_handle: c.creator_handle,
          creator_name: c.creator_name,
          view_count: c.view_count,
          duration: c.duration,
          thumbnail_url: c.thumbnail_url,
          embed_url: c.embed_url,
          url: c.url,
          created_at: c.created_at,
          game_name: c.game_name,
        }));
      }
    } catch { /* clips are best-effort */ }

    // --- 5) Top creators by total hours ---
    const creatorAccum = new Map();
    for (const r of sessions) {
      const h = String(r.handle).toLowerCase();
      const end = r.is_ongoing ? now : (r.ended_at || r.started_at);
      const mins = Math.max(0, Math.round((end - r.started_at) / 60));
      const cur = creatorAccum.get(h) || { handle: h, display_name: r.display_name, mins: 0, peak: 0 };
      cur.mins += mins;
      cur.peak = Math.max(cur.peak, Number(r.peak_viewers || 0));
      creatorAccum.set(h, cur);
    }
    const topCreators = [...creatorAccum.values()]
      .sort((a, b) => b.mins - a.mins)
      .slice(0, 5)
      .map(c => ({ handle: c.handle, display_name: c.display_name, hours: Math.round(c.mins / 60), peak: c.peak }));

    const payload = {
      ok: true,
      window: { start: sevenDaysAgo, end: now },
      generated_at: new Date().toISOString(),
      stats: {
        total_hours: Math.round(totalMins / 60),
        unique_creators_live: liveCreators.size,
        sessions_count: sessions.length,
        most_active_server: mostActiveServer
          ? { id: mostActiveServer.id, name: mostActiveServer.name, viewer_hours: Math.round(mostActiveServer.viewer_hours), hours: Math.round(mostActiveServer.mins / 60) }
          : null,
      },
      peak_moment: peakMoment,
      new_creators: newCreators,
      top_clips: topClips,
      top_creators: topCreators,
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, s-maxage=${CACHE_TTL}`,
      },
    });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/spotlight.js
// GET /api/spotlight
//
// Picks one creator each UTC day as the "Daily Spotlight". The
// algorithm rewards consistency (most sessions in the last 7 days)
// while boosting the underdogs (lowest avg viewers among the top
// consistent set). Falls back to alphabetical rotation by day-of-
// year mod 26 if no session data exists yet.
//
// Cache key includes the UTC date, so the response naturally rolls
// over at 00:00 UTC. Cached for 24h via Cache API.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const CACHE_TTL = 86400;

function todayKeyUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayOfYearUTC() {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

function profileUrl(c) {
  return c.platform === 'kick'
    ? `https://kick.com/${c.handle}`
    : `https://twitch.tv/${c.handle}`;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const dateKey = todayKeyUTC();
  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/spotlight/${dateKey}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    // The spotlight rotation alphabetises the curated list at request
    // time, so the same handle index produces a stable daily pick even
    // if creators are added/removed (the index would shift mid-rotation,
    // which is fine — it's a daily UI surface, not a SLA).
    const curated = await getCuratedList(env);
    const ALLOWLIST = [...curated].sort((a, b) => a.handle.localeCompare(b.handle));
    const ALLOWED_HANDLES = new Set(curated.map(c => c.handle));

    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;

    // Sessions per creator over the trailing 7 days. We want consistency
    // (count of sessions) AND avg viewers to score the underdogs.
    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name, cp.platform, c.bio, c.avatar_url,
             COUNT(*) AS sessions,
             AVG(ss.peak_viewers) AS avg_viewers,
             SUM(ss.duration_mins) AS total_mins,
             MAX(ss.started_at) AS last_started_at
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      INNER JOIN creators c ON c.id = ss.creator_id
      WHERE ss.started_at >= ?
      GROUP BY ss.creator_id
    `).bind(sevenDaysAgo).all();

    const candidates = (sessRes.results || [])
      .filter(r => ALLOWED_HANDLES.has(String(r.handle).toLowerCase()))
      .map(r => ({
        handle: String(r.handle).toLowerCase(),
        display_name: r.display_name,
        platform: r.platform,
        bio: r.bio || null,
        avatar_url: r.avatar_url || null,
        sessions: Number(r.sessions || 0),
        avg_viewers: Math.round(Number(r.avg_viewers || 0)),
        total_mins: Number(r.total_mins || 0),
        last_started_at: Number(r.last_started_at || 0),
      }));

    let pick = null;
    let reason = '';

    if (candidates.length >= 2) {
      // Filter to the most-consistent half (sessions >= median sessions),
      // then pick the one with the LOWEST avg_viewers among them. That
      // surfaces an underdog who's been putting in the work.
      const sortedBySessions = [...candidates].sort((a, b) => b.sessions - a.sessions);
      const medianSessions = sortedBySessions[Math.floor(sortedBySessions.length / 2)].sessions;
      const consistent = sortedBySessions.filter(c => c.sessions >= Math.max(2, medianSessions));
      const pool = consistent.length ? consistent : sortedBySessions.slice(0, Math.max(3, Math.ceil(sortedBySessions.length / 2)));
      pool.sort((a, b) => {
        if (a.avg_viewers !== b.avg_viewers) return a.avg_viewers - b.avg_viewers;
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        return a.handle.localeCompare(b.handle);
      });
      // Stable per-day pick: index by day-of-year mod pool size, so the
      // exact spotlight shifts day to day even if the underlying pool is
      // identical. Keeps the algorithm honest without thrashing.
      const idx = dayOfYearUTC() % pool.length;
      pick = pool[idx];
      reason = `${pick.sessions} sessions this week · ${pick.avg_viewers} avg viewers — putting in the work`;
    }

    if (!pick) {
      // Fallback: alphabetical rotation through the 26 by day-of-year.
      const idx = dayOfYearUTC() % ALLOWLIST.length;
      const c = ALLOWLIST[idx];
      pick = {
        handle: c.handle,
        display_name: c.name,
        platform: c.platform,
        bio: null,
        avatar_url: null,
        sessions: 0,
        avg_viewers: 0,
        total_mins: 0,
        last_started_at: 0,
      };
      reason = "Today's pick from the curated 26 — no session data yet";
    }

    // Backfill avatar/bio from the creators table if the session-driven
    // pick had nulls (rare but possible for kick creators).
    if (!pick.avatar_url || !pick.bio) {
      const creatorRow = await env.DB.prepare(`
        SELECT c.bio, c.avatar_url
        FROM creators c
        INNER JOIN creator_platforms cp ON cp.creator_id = c.id
        WHERE LOWER(cp.handle) = ?
        LIMIT 1
      `).bind(pick.handle).first().catch(() => null);
      if (creatorRow) {
        pick.bio = pick.bio || creatorRow.bio || null;
        pick.avatar_url = pick.avatar_url || creatorRow.avatar_url || null;
      }
    }

    // Best recent clip — single thumbnail for the spotlight card. We
    // pull from the same /api/clips Function so the same Twitch helix
    // call is shared (warmed cache → free).
    let topClip = null;
    if (pick.platform === 'twitch') {
      try {
        const clipsRes = await fetch(new URL('/api/clips?range=30d', request.url).toString());
        const clipsJson = await clipsRes.json();
        const all = Array.isArray(clipsJson?.clips) ? clipsJson.clips : [];
        topClip = all.find(cl => String(cl.broadcaster_login || '').toLowerCase() === pick.handle) || null;
      } catch { /* best-effort */ }
    }

    const payload = {
      ok: true,
      date: dateKey,
      pick: {
        handle: pick.handle,
        display_name: pick.display_name,
        platform: pick.platform,
        bio: pick.bio,
        avatar_url: pick.avatar_url,
        profile_url: `/creator-profile/${pick.handle}`,
        watch_url: profileUrl(pick),
        sessions: pick.sessions,
        avg_viewers: pick.avg_viewers,
        total_hours: Math.round(pick.total_mins / 60),
      },
      reason,
      top_clip: topClip ? {
        url: topClip.url,
        title: topClip.title,
        thumbnail_url: topClip.thumbnail_url,
        view_count: topClip.view_count,
      } : null,
      fetched_at: new Date().toISOString(),
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

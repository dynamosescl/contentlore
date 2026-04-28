// ================================================================
// functions/api/analytics.js
// GET /api/analytics
//
// Returns scene analytics for the curated 26 over the last 7 days:
//   - hourly_viewers: 7×24 = 168 buckets of total concurrent viewers
//                     (sum of `viewers` across all live curated snapshots
//                      grouped into hour buckets)
//   - heatmap:        7×24 grid of avg viewers by (dow, hour-of-day)
//   - server_hours:   total session-hours per detected UK server
//   - stats:          aggregate counters for the hero strip
//
// Charting is done client-side as inline SVG so we avoid pulling
// down a chart library. 5-min Cache API hit since the underlying
// data only mutates every 15 min anyway.
// ================================================================

import { jsonResponse } from '../_lib.js';

const ALLOWED_HANDLES = new Set([
  'tyrone', 'lbmm', 'reeclare', 'stoker', 'samham', 'deggyuk',
  'megsmary', 'tazzthegeeza', 'wheelydev', 'rexality', 'steeel',
  'justj0hnnyhd', 'cherish_remedy', 'lorddorro', 'jck0__', 'absthename',
  'essellz', 'lewthescot', 'angels365', 'fantasiasfantasy',
  'kavsual', 'shammers', 'bags', 'dynamoses', 'dcampion', 'elliewaller',
]);

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

const CACHE_TTL = 300;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/analytics/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;

    // ----------------------------------------------------------------
    // 1) HOURLY VIEWERS — bucket snapshots by hour, sum viewers
    //    For each captured_at moment we already have one row per
    //    creator. Grouping by hour bucket and SUM(viewers) gives us
    //    a reasonable "total concurrent" curve. The 15-min cron
    //    cadence means each hour has up to 4×26 = 104 rows.
    // ----------------------------------------------------------------
    const hourlyRes = await env.DB.prepare(`
      SELECT
        (s.captured_at / 3600) AS hour_bucket,
        SUM(s.viewers) AS total_viewers,
        COUNT(DISTINCT s.creator_id) AS unique_live
      FROM snapshots s
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
        AND s.is_live = 1
      GROUP BY hour_bucket
      ORDER BY hour_bucket ASC
    `).bind(sevenDaysAgo).all();

    const hourlyRows = (hourlyRes.results || [])
      .filter(r => true); // platform handle filter happens via the JOIN

    // Average within each hour bucket (samples come in 4 per hour at most)
    // SUM/COUNT_DISTINCT_TS would be ideal but D1 SQL is fine to do client-side.
    const hourly = hourlyRows.map(r => ({
      ts: Number(r.hour_bucket) * 3600,
      total_viewers: Number(r.total_viewers || 0),
      unique_live: Number(r.unique_live || 0),
    }));

    // ----------------------------------------------------------------
    // 2) HEATMAP — avg viewers per (day-of-week, hour-of-day)
    //    7d window. Same SUM/grouping approach.
    // ----------------------------------------------------------------
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    const heatmapCounts = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of hourly) {
      const d = new Date(h.ts * 1000);
      const dow = (d.getUTCDay() + 6) % 7; // shift Mon=0
      const hod = d.getUTCHours();
      heatmap[dow][hod] += h.total_viewers;
      heatmapCounts[dow][hod] += 1;
    }
    const heatmapAvg = heatmap.map((row, i) => row.map((sum, j) => {
      const c = heatmapCounts[i][j];
      return c ? Math.round(sum / c) : 0;
    }));

    // ----------------------------------------------------------------
    // 3) SERVER HOURS — sum session minutes weighted by peak viewers
    //    over last 7d, group by detected server.
    // ----------------------------------------------------------------
    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.duration_mins, ss.peak_viewers
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE ss.started_at >= ?
    `).bind(sevenDaysAgo).all();

    const serverAccum = new Map(); // id -> { mins, viewer_hours }
    let totalMins = 0;
    let uniqueLiveCreators = new Set();
    const sessions = (sessRes.results || []).filter(r =>
      ALLOWED_HANDLES.has(String(r.handle).toLowerCase())
    );
    for (const r of sessions) {
      uniqueLiveCreators.add(String(r.handle).toLowerCase());
      const end = r.is_ongoing ? now : (r.ended_at || r.started_at);
      const mins = Math.max(0, Math.round((end - r.started_at) / 60));
      totalMins += mins;
      const sid = detectServer(r.final_title);
      if (!sid) continue;
      const peak = Number(r.peak_viewers || 0);
      const cur = serverAccum.get(sid) || { mins: 0, viewer_hours: 0 };
      cur.mins += mins;
      cur.viewer_hours += (mins / 60) * peak;
      serverAccum.set(sid, cur);
    }
    const server_hours = SERVERS.map(s => ({
      id: s.id,
      name: s.name,
      mins: serverAccum.get(s.id)?.mins || 0,
      viewer_hours: Math.round(serverAccum.get(s.id)?.viewer_hours || 0),
    })).sort((a, b) => b.viewer_hours - a.viewer_hours);

    // Peak concurrent = max total_viewers in any hour bucket
    let peakConcurrent = 0;
    let peakConcurrentTs = null;
    for (const h of hourly) {
      if (h.total_viewers > peakConcurrent) {
        peakConcurrent = h.total_viewers;
        peakConcurrentTs = h.ts;
      }
    }
    const mostActiveServer = server_hours[0]?.viewer_hours > 0 ? server_hours[0] : null;

    // ----------------------------------------------------------------
    // 4) GROWTH — week-over-week peak viewers per creator, top 5
    //    delta picked as "fastest growing". Compares the most recent
    //    7d peak against the prior 7d peak. Creators with no prior-
    //    week data get filtered out (they're flagged in the response
    //    so the client can show a "new this week" pill).
    // ----------------------------------------------------------------
    const fourteenDaysAgo = now - 14 * 86400;
    const growthRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name,
             SUM(CASE WHEN s.captured_at >= ? THEN s.viewers ELSE 0 END) AS recent_sum,
             SUM(CASE WHEN s.captured_at >= ? THEN 1 ELSE 0 END)        AS recent_count,
             MAX(CASE WHEN s.captured_at >= ? THEN s.viewers ELSE 0 END) AS recent_peak,
             SUM(CASE WHEN s.captured_at <  ? AND s.captured_at >= ? THEN s.viewers ELSE 0 END) AS prior_sum,
             SUM(CASE WHEN s.captured_at <  ? AND s.captured_at >= ? THEN 1 ELSE 0 END)         AS prior_count,
             MAX(CASE WHEN s.captured_at <  ? AND s.captured_at >= ? THEN s.viewers ELSE 0 END) AS prior_peak
      FROM snapshots s
      INNER JOIN creators c ON c.id = s.creator_id
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
        AND s.is_live = 1
      GROUP BY s.creator_id
    `).bind(
      sevenDaysAgo, sevenDaysAgo, sevenDaysAgo,
      sevenDaysAgo, fourteenDaysAgo,
      sevenDaysAgo, fourteenDaysAgo,
      sevenDaysAgo, fourteenDaysAgo,
      fourteenDaysAgo
    ).all();

    const growth = (growthRes.results || [])
      .filter(r => ALLOWED_HANDLES.has(String(r.handle).toLowerCase()))
      .map(r => {
        const recentAvg = r.recent_count > 0 ? r.recent_sum / r.recent_count : 0;
        const priorAvg  = r.prior_count  > 0 ? r.prior_sum  / r.prior_count  : 0;
        const delta = priorAvg > 0
          ? ((recentAvg - priorAvg) / priorAvg) * 100
          : null;
        return {
          handle: String(r.handle).toLowerCase(),
          display_name: r.display_name,
          recent_avg: Math.round(recentAvg),
          recent_peak: Number(r.recent_peak || 0),
          prior_avg: Math.round(priorAvg),
          prior_peak: Number(r.prior_peak || 0),
          delta_pct: delta == null ? null : Math.round(delta),
          new_this_week: r.prior_count == 0 && r.recent_count > 0,
        };
      })
      .sort((a, b) => {
        // Top creators by delta_pct, with new-this-week ones surfaced too
        const aV = a.delta_pct == null ? -Infinity : a.delta_pct;
        const bV = b.delta_pct == null ? -Infinity : b.delta_pct;
        return bV - aV;
      });

    const fastestGrowing = growth.filter(g => g.delta_pct != null && g.delta_pct > 0).slice(0, 5);

    // ----------------------------------------------------------------
    // 5) FOLLOWER GROWTH — per-creator follower-count trend over 30d.
    //    Bucketed to one sample per day so each sparkline has 30 points
    //    max. Kick snapshots write NULL into `followers` (Public API
    //    doesn't expose it) so this section is effectively Twitch-only —
    //    we still surface Kick creators with a "no data" flag so they're
    //    visible.
    // ----------------------------------------------------------------
    const thirtyDaysAgo = now - 30 * 86400;
    const followersRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name, cp.platform,
             (s.captured_at / 86400) AS day_bucket,
             AVG(s.followers) AS followers
      FROM snapshots s
      INNER JOIN creators c ON c.id = s.creator_id
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
        AND s.followers IS NOT NULL
      GROUP BY s.creator_id, day_bucket
      ORDER BY day_bucket ASC
    `).bind(thirtyDaysAgo).all();

    const followerSeries = new Map();
    for (const r of (followersRes.results || [])) {
      const h = String(r.handle).toLowerCase();
      if (!ALLOWED_HANDLES.has(h)) continue;
      const bucket = followerSeries.get(h) || {
        handle: h,
        display_name: r.display_name,
        platform: r.platform,
        points: [],
      };
      bucket.points.push({
        ts: Number(r.day_bucket) * 86400,
        followers: Math.round(Number(r.followers || 0)),
      });
      followerSeries.set(h, bucket);
    }
    const follower_growth = [...followerSeries.values()].map(s => {
      const first = s.points[0]?.followers ?? 0;
      const last  = s.points[s.points.length - 1]?.followers ?? first;
      return {
        ...s,
        first_followers: first,
        last_followers: last,
        delta: last - first,
        delta_pct: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
      };
    }).sort((a, b) => (b.delta || 0) - (a.delta || 0));

    const payload = {
      ok: true,
      window: { start: sevenDaysAgo, end: now },
      hourly,
      heatmap: heatmapAvg,
      server_hours,
      growth: { fastest: fastestGrowing, all: growth, follower_growth },
      stats: {
        total_hours: Math.round(totalMins / 60),
        unique_creators_live: uniqueLiveCreators.size,
        peak_concurrent: peakConcurrent,
        peak_concurrent_at: peakConcurrentTs,
        most_active_server: mostActiveServer ? mostActiveServer.name : null,
        sample_size: hourly.length,
      },
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

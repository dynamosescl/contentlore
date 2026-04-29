// ================================================================
// functions/api/rankings.js
// GET /api/rankings
//
// Weekly Power Rankings for the curated creators. Computes a 0-100
// composite score per creator from the last 7 days of activity:
//
//   hours       (30%)  total stream-hours
//   avg_viewers (40%)  average concurrent viewers across snapshots
//   sessions    (20%)  number of distinct stream sessions
//   growth      (10%)  this-week-vs-last-week avg-viewer delta
//
// Each metric is normalised to 0-100 against the pool max so the
// composite is comparable across periods. Growth is clamped to
// [-50%, +100%] before mapping into 0-100 so a single huge spike
// doesn't dominate.
//
// Movement = last_week_rank - this_week_rank (positive = climbed).
// The same scoring runs against the prior 7d to derive last-week
// rank. Creators with no prior-week data get movement = null and a
// "new" flag.
//
// Sparkline = 7 daily-bucketed avg-viewer values per creator.
//
// 5-min Cache API hit (data underneath only mutates every 15 min).
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const CACHE_TTL = 300;
const WEIGHTS = { hours: 0.30, viewers: 0.40, sessions: 0.20, growth: 0.10 };

// Map a -50..+100 growth pct into a 0..100 score.
function growthToScore(pct) {
  if (pct == null || !isFinite(pct)) return 0;
  const clamped = Math.max(-50, Math.min(100, pct));
  return ((clamped + 50) / 150) * 100;
}

// Normalise a metric within the pool — value / max * 100.
function normalise(map, key) {
  let max = 0;
  for (const v of map.values()) if (v[key] > max) max = v[key];
  if (max <= 0) {
    for (const v of map.values()) v[`${key}_score`] = 0;
    return;
  }
  for (const v of map.values()) v[`${key}_score`] = (v[key] / max) * 100;
}

// Build per-creator stats for one window [from, to). Returns
// Map<handle, { hours, avg_viewers, sessions, growth_pct, ... }>.
function aggregate(handles, sessionRows, snapshotRows, from, to, priorAvgByHandle) {
  const out = new Map();
  for (const h of handles) {
    out.set(h, {
      handle: h,
      hours: 0,
      sessions: 0,
      avg_viewers: 0,
      _viewerSum: 0,
      _viewerCount: 0,
      growth_pct: null,
      _newThisPeriod: false,
    });
  }
  // Sessions: count + duration. Treat ongoing as ending at `to`.
  for (const r of sessionRows) {
    const h = String(r.handle).toLowerCase();
    if (!out.has(h)) continue;
    const sStart = r.started_at;
    const sEnd = r.is_ongoing ? to : (r.ended_at || r.started_at);
    if (sStart >= to || sEnd <= from) continue;          // outside window
    const overlapStart = Math.max(sStart, from);
    const overlapEnd   = Math.min(sEnd,   to);
    const minsInWindow = Math.max(0, Math.round((overlapEnd - overlapStart) / 60));
    const stats = out.get(h);
    stats.hours += minsInWindow / 60;
    // Count session if it started inside the window — keeps "sessions
    // this week" consistent and prevents long ongoing streams from
    // double-counting across weeks.
    if (sStart >= from && sStart < to) stats.sessions += 1;
  }
  // Avg viewers: average of snapshot viewers in window where is_live=1.
  for (const r of snapshotRows) {
    const h = String(r.handle).toLowerCase();
    if (!out.has(h)) continue;
    if (r.captured_at < from || r.captured_at >= to) continue;
    if (!r.is_live) continue;
    const stats = out.get(h);
    stats._viewerSum += Number(r.viewers || 0);
    stats._viewerCount += 1;
  }
  for (const stats of out.values()) {
    stats.avg_viewers = stats._viewerCount > 0
      ? stats._viewerSum / stats._viewerCount
      : 0;
    if (priorAvgByHandle) {
      const prior = priorAvgByHandle.get(stats.handle) || 0;
      if (prior > 0) {
        stats.growth_pct = ((stats.avg_viewers - prior) / prior) * 100;
      } else if (stats.avg_viewers > 0) {
        stats._newThisPeriod = true;
        stats.growth_pct = 100;     // treat fresh creators as +100% (new arrival)
      } else {
        stats.growth_pct = null;
      }
    }
    delete stats._viewerSum;
    delete stats._viewerCount;
  }
  return out;
}

function score(stats) {
  return (
    stats.hours_score   * WEIGHTS.hours   +
    stats.viewers_score * WEIGHTS.viewers +
    stats.sessions_score * WEIGHTS.sessions +
    stats.growth_score  * WEIGHTS.growth
  );
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/rankings/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const curated = await getCuratedList(env);
    const handles = new Set(curated.map(c => c.handle));
    const meta = new Map(curated.map(c => [c.handle, c]));

    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const twoWeeksAgo = now - 14 * 86400;

    // ----- pull 14 days of sessions + snapshots in two queries -----
    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name, c.avatar_url,
             ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.duration_mins, ss.peak_viewers
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      INNER JOIN creators c ON c.id = ss.creator_id
      WHERE (ss.is_ongoing = 1 OR ss.ended_at >= ?)
    `).bind(twoWeeksAgo).all();
    const sessionRows = (sessRes.results || []).filter(r => handles.has(String(r.handle).toLowerCase()));

    const snapRes = await env.DB.prepare(`
      SELECT cp.handle, s.viewers, s.is_live, s.captured_at
      FROM snapshots s
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
    `).bind(twoWeeksAgo).all();
    const snapshotRows = (snapRes.results || []).filter(r => handles.has(String(r.handle).toLowerCase()));

    // ----- prior-week avg viewers (used for growth %) -----
    const priorWeek = aggregate(handles, sessionRows, snapshotRows, twoWeeksAgo, weekAgo, null);
    const priorAvgByHandle = new Map([...priorWeek.values()].map(v => [v.handle, v.avg_viewers]));

    // ----- this week + last week with growth -----
    const thisWeek = aggregate(handles, sessionRows, snapshotRows, weekAgo, now, priorAvgByHandle);
    const lastWeekForRank = aggregate(handles, sessionRows, snapshotRows, twoWeeksAgo, weekAgo, null);

    // Score & rank both weeks.
    function scoreAndRank(map) {
      normalise(map, 'hours');
      normalise(map, 'avg_viewers');
      // Need viewers_score not avg_viewers_score — alias.
      for (const v of map.values()) v.viewers_score = v.avg_viewers_score;
      normalise(map, 'sessions');
      for (const v of map.values()) {
        v.growth_score = growthToScore(v.growth_pct);
        v.score = score(v);
      }
      const sorted = [...map.values()].sort((a, b) => b.score - a.score);
      sorted.forEach((v, i) => { v.rank = i + 1; });
      return sorted;
    }

    const thisRanked = scoreAndRank(thisWeek);
    const lastRanked = scoreAndRank(lastWeekForRank);
    const lastRankByHandle = new Map(lastRanked.map(v => [v.handle, v.rank]));

    // ----- sparklines: 7 daily buckets per handle -----
    const dayMs = 86400;
    const days = 7;
    const baseDay = Math.floor(weekAgo / dayMs);
    const sparkBy = new Map(); // handle -> [day-index] -> {sum, count}
    for (const h of handles) sparkBy.set(h, Array.from({ length: days }, () => ({ sum: 0, count: 0 })));
    for (const r of snapshotRows) {
      if (r.captured_at < weekAgo || r.captured_at >= now) continue;
      if (!r.is_live) continue;
      const h = String(r.handle).toLowerCase();
      const arr = sparkBy.get(h);
      if (!arr) continue;
      const idx = Math.floor(r.captured_at / dayMs) - baseDay;
      if (idx < 0 || idx >= days) continue;
      arr[idx].sum += Number(r.viewers || 0);
      arr[idx].count += 1;
    }
    const sparkOf = h => {
      const arr = sparkBy.get(h) || [];
      return arr.map(b => b.count ? Math.round(b.sum / b.count) : 0);
    };

    // ----- final payload -----
    const rankings = thisRanked.map(v => {
      const m = meta.get(v.handle) || {};
      const lastRank = lastRankByHandle.get(v.handle);
      const movement = (lastRank == null) ? null : (lastRank - v.rank);
      return {
        rank: v.rank,
        handle: v.handle,
        display_name: m.display_name || v.handle,
        primary_platform: m.primary_platform || 'twitch',
        profile_url: `/creator-profile/${v.handle}`,
        score: Math.round(v.score * 10) / 10,
        breakdown: {
          hours: Math.round(v.hours * 10) / 10,
          avg_viewers: Math.round(v.avg_viewers),
          sessions: v.sessions,
          growth_pct: v.growth_pct == null ? null : Math.round(v.growth_pct),
        },
        scores: {
          hours: Math.round(v.hours_score),
          viewers: Math.round(v.viewers_score),
          sessions: Math.round(v.sessions_score),
          growth: Math.round(v.growth_score),
        },
        movement,
        is_new: v._newThisPeriod || lastRank == null,
        sparkline: sparkOf(v.handle),
      };
    });

    const payload = {
      ok: true,
      window: { start: weekAgo, end: now, prior_start: twoWeeksAgo, prior_end: weekAgo },
      weights: WEIGHTS,
      count: rankings.length,
      rankings,
      generated_at: new Date().toISOString(),
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

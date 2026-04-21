// ================================================================
// functions/api/rankings.js
// GET /api/rankings?metric=peak&window=7d&limit=20
//
// Returns top UK creators by a chosen metric. Powers /rankings pages.
//
// metric: peak | avg | hours | growth_followers
// window: 1d | 7d | 30d | all
// ================================================================

import { jsonResponse } from '../_lib.js';

const ALLOWED_METRICS = new Set(['peak', 'avg', 'hours', 'growth_followers']);
const WINDOW_SECONDS = {
  '1d': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  'all': 10 * 365 * 86400,
};

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const metric = url.searchParams.get('metric') || 'peak';
  const window = url.searchParams.get('window') || '7d';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 50);

  if (!ALLOWED_METRICS.has(metric)) {
    return jsonResponse({ ok: false, error: 'invalid metric' }, 400);
  }
  if (!WINDOW_SECONDS[window]) {
    return jsonResponse({ ok: false, error: 'invalid window' }, 400);
  }

  const cacheKey = `rankings:${metric}:${window}:${limit}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached && cached.ts && (Date.now() - cached.ts) < 600000) {
    return jsonResponse({ ok: true, ...cached.data, cached: true });
  }

  try {
    const since = Math.floor(Date.now() / 1000) - WINDOW_SECONDS[window];
    let rows = [];

    if (metric === 'peak' || metric === 'avg' || metric === 'hours') {
      const metricExpr = {
        peak: 'MAX(ss.peak_viewers)',
        avg: 'ROUND(AVG(NULLIF(ss.avg_viewers, 0)))',
        hours: 'ROUND(SUM(ss.duration_mins) / 60.0, 1)',
      }[metric];

      const sql = `
        SELECT 
          c.id, c.display_name, c.avatar_url,
          cp.platform, cp.handle,
          ${metricExpr} AS value,
          COUNT(ss.id) AS sessions_count,
          SUM(ss.duration_mins) AS total_mins
        FROM stream_sessions ss
        INNER JOIN creators c ON c.id = ss.creator_id
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE ss.started_at > ?
          AND c.role = 'creator'
        GROUP BY c.id
        HAVING value > 0
        ORDER BY value DESC
        LIMIT ?
      `;
      const res = await env.DB.prepare(sql).bind(since, limit).all();
      rows = res.results || [];
    }

    if (metric === 'growth_followers') {
      // Uses the existing momentum approach — follower delta across the window
      const sql = `
        WITH firsts AS (
          SELECT creator_id, followers, 
                 ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY captured_at ASC) AS rn
          FROM snapshots
          WHERE captured_at > ? AND followers IS NOT NULL
        ),
        lasts AS (
          SELECT creator_id, followers,
                 ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY captured_at DESC) AS rn
          FROM snapshots
          WHERE captured_at > ? AND followers IS NOT NULL
        )
        SELECT 
          c.id, c.display_name, c.avatar_url,
          cp.platform, cp.handle,
          (lasts.followers - firsts.followers) AS value,
          lasts.followers AS current_followers
        FROM firsts
        INNER JOIN lasts ON lasts.creator_id = firsts.creator_id AND lasts.rn = 1
        INNER JOIN creators c ON c.id = firsts.creator_id
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE firsts.rn = 1
          AND c.role = 'creator'
          AND (lasts.followers - firsts.followers) > 0
        ORDER BY value DESC
        LIMIT ?
      `;
      const res = await env.DB.prepare(sql).bind(since, since, limit).all();
      rows = res.results || [];
    }

    const result = {
      metric,
      window,
      generated_at: Math.floor(Date.now() / 1000),
      rankings: rows.map((r, i) => ({
        rank: i + 1,
        creator_id: r.id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        platform: r.platform,
        handle: r.handle,
        value: r.value,
        sessions_count: r.sessions_count,
        total_mins: r.total_mins,
        current_followers: r.current_followers,
        profile_url: `/creator/${r.id}`,
      })),
    };

    await env.KV.put(cacheKey, JSON.stringify({ data: result, ts: Date.now() }), {
      expirationTtl: 900,
    });

    return jsonResponse({ ok: true, ...result, cached: false });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

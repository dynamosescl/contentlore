// ================================================================
// functions/api/creator-stats/[slug].js
// GET /api/creator-stats/:slug
// 
// Returns aggregated statistics for a creator across 7-day and 30-day
// windows, plus recent stream sessions and category breakdown.
//
// Cached in KV for 5 minutes per creator.
// ================================================================

import { jsonResponse } from '../../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return jsonResponse({ ok: false, error: 'slug required' }, 400);

  const cacheKey = `stats:creator:${slug}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached && cached.ts && (Date.now() - cached.ts) < 300000) {
    return jsonResponse({ ok: true, ...cached.data, cached: true });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const window7d = now - (7 * 86400);
    const window30d = now - (30 * 86400);

    // Live state: is there an ongoing session?
    const ongoing = await env.DB.prepare(`
      SELECT started_at, peak_viewers, avg_viewers, duration_mins, 
             primary_category, final_title, platform
      FROM stream_sessions
      WHERE creator_id = ? AND is_ongoing = 1
      ORDER BY started_at DESC
      LIMIT 1
    `).bind(slug).first();

    // 7-day stats
    const stats7d = await aggregateWindow(env, slug, window7d);
    const stats30d = await aggregateWindow(env, slug, window30d);
    const statsAll = await aggregateWindow(env, slug, 0);

    // Top 10 sessions by peak viewers in last 30 days
    const topSessionsRes = await env.DB.prepare(`
      SELECT started_at, ended_at, duration_mins, peak_viewers, avg_viewers,
             primary_category, final_title, first_title, platform, is_ongoing
      FROM stream_sessions
      WHERE creator_id = ? AND started_at > ?
      ORDER BY peak_viewers DESC
      LIMIT 10
    `).bind(slug, window30d).all();

    // Recent 20 sessions chronological for history / timeline
    const recentSessionsRes = await env.DB.prepare(`
      SELECT started_at, ended_at, duration_mins, peak_viewers, avg_viewers,
             primary_category, final_title, platform, is_ongoing
      FROM stream_sessions
      WHERE creator_id = ?
      ORDER BY started_at DESC
      LIMIT 20
    `).bind(slug).all();

    // Category breakdown (last 30d)
    const categoryRes = await env.DB.prepare(`
      SELECT primary_category AS category,
             COUNT(*) AS session_count,
             SUM(duration_mins) AS total_mins,
             AVG(peak_viewers) AS avg_peak
      FROM stream_sessions
      WHERE creator_id = ?
        AND started_at > ?
        AND primary_category IS NOT NULL
      GROUP BY primary_category
      ORDER BY total_mins DESC
      LIMIT 8
    `).bind(slug, window30d).all();

    // Day-by-day activity (last 30d) — for timeline viz
    const dailyRes = await env.DB.prepare(`
      SELECT 
        CAST(strftime('%s', DATE(started_at, 'unixepoch')) AS INTEGER) AS day_ts,
        COUNT(*) AS sessions,
        SUM(duration_mins) AS minutes,
        MAX(peak_viewers) AS peak
      FROM stream_sessions
      WHERE creator_id = ?
        AND started_at > ?
      GROUP BY day_ts
      ORDER BY day_ts ASC
    `).bind(slug, window30d).all();

    const result = {
      creator_id: slug,
      generated_at: now,
      is_live: !!ongoing,
      current_session: ongoing || null,
      stats: {
        '7d': stats7d,
        '30d': stats30d,
        'all_time': statsAll,
      },
      top_sessions: topSessionsRes.results || [],
      recent_sessions: recentSessionsRes.results || [],
      categories: categoryRes.results || [],
      daily_activity: dailyRes.results || [],
    };

    await env.KV.put(cacheKey, JSON.stringify({ data: result, ts: Date.now() }), {
      expirationTtl: 600,
    });

    return jsonResponse({ ok: true, ...result, cached: false });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

async function aggregateWindow(env, creatorId, sinceTs) {
  const row = await env.DB.prepare(`
    SELECT 
      COUNT(*) AS sessions_count,
      COALESCE(SUM(duration_mins), 0) AS total_mins,
      COALESCE(MAX(peak_viewers), 0) AS peak_viewers,
      COALESCE(ROUND(AVG(NULLIF(avg_viewers, 0))), 0) AS avg_viewers,
      COALESCE(SUM(peak_viewers * duration_mins), 0) AS weighted_peak
    FROM stream_sessions
    WHERE creator_id = ?
      AND started_at > ?
  `).bind(creatorId, sinceTs).first();

  return {
    sessions_count: row?.sessions_count || 0,
    hours_streamed: Math.round(((row?.total_mins || 0) / 60) * 10) / 10,
    peak_viewers: row?.peak_viewers || 0,
    avg_viewers: row?.avg_viewers || 0,
    hours_watched: Math.round(((row?.weighted_peak || 0) / 60) * 10) / 10, // peak × hours, approx
  };
}

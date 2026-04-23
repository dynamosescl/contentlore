// ================================================================
// functions/api/momentum.js
// GET /api/momentum
// Top creators by 7-day follower velocity (Rising signal).
// This is the feed for Scene Pulse on the homepage.
// ================================================================

import { jsonResponse, parseBoundedInt } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const limit = parseBoundedInt(url.searchParams.get('limit'), 10, 1, 50);
  const window = parseBoundedInt(url.searchParams.get('days'), 7, 1, 30);

  try {
    const windowStart = Math.floor(Date.now() / 1000) - window * 86400;

    // For each creator, find their earliest and latest follower count in the window
    // across all platforms. Sum deltas to get total velocity.
    const sql = `
      WITH windowed AS (
        SELECT 
          s.creator_id,
          s.platform,
          s.followers,
          s.captured_at,
          ROW_NUMBER() OVER (PARTITION BY s.creator_id, s.platform ORDER BY s.captured_at ASC) AS rn_first,
          ROW_NUMBER() OVER (PARTITION BY s.creator_id, s.platform ORDER BY s.captured_at DESC) AS rn_last
        FROM snapshots s
        WHERE s.captured_at > ? AND s.followers IS NOT NULL
      ),
      firsts AS (SELECT creator_id, platform, followers AS start_f FROM windowed WHERE rn_first = 1),
      lasts AS (SELECT creator_id, platform, followers AS end_f FROM windowed WHERE rn_last = 1),
      deltas AS (
        SELECT 
          f.creator_id,
          f.platform,
          f.start_f,
          l.end_f,
          (l.end_f - f.start_f) AS delta
        FROM firsts f
        JOIN lasts l ON l.creator_id = f.creator_id AND l.platform = f.platform
      ),
      totals AS (
        SELECT 
          creator_id,
          SUM(delta) AS total_delta,
          MAX(end_f) AS current_followers
        FROM deltas
        GROUP BY creator_id
        HAVING total_delta > 0
      )
      SELECT 
        t.creator_id,
        t.total_delta,
        t.current_followers,
        c.display_name,
        c.categories,
        c.avatar_url,
        c.accent_colour,
        cp.platform AS primary_platform,
        cp.handle AS primary_handle
      FROM totals t
      JOIN creators c ON c.id = t.creator_id
      LEFT JOIN creator_platforms cp ON cp.creator_id = t.creator_id AND cp.is_primary = 1
      WHERE c.role = 'creator'
      ORDER BY t.total_delta DESC
      LIMIT ?
    `;

    const result = await env.DB.prepare(sql).bind(windowStart, limit).all();
    const movers = (result.results || []).map((r) => ({
      id: r.creator_id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      accent_colour: r.accent_colour,
      categories: r.categories ? r.categories.split(',').map((s) => s.trim()) : [],
      primary_platform: r.primary_platform,
      primary_handle: r.primary_handle,
      follower_delta: r.total_delta,
      current_followers: r.current_followers,
      profile_url: `/creator/${r.creator_id}`,
    }));

    return jsonResponse({
      ok: true,
      window_days: window,
      count: movers.length,
      movers,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

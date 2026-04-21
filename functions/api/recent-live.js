// ================================================================
// functions/api/recent-live.js
// GET /api/recent-live
// Returns the top streams that were live in the last 24 hours,
// ranked by peak viewers. Powers the "Recent" fallback on The Desk
// when nobody is currently live.
//
// Each row represents a distinct creator — we take the single highest-
// viewer snapshot from each creator's last 24 hours.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // KV cache first
    const cached = await env.KV.get('recent-live:24h', 'json');
    if (cached && cached.ts && (Date.now() - cached.ts) < 300000) {
      return jsonResponse({
        ok: true,
        recent: cached.recent,
        count: cached.recent.length,
        cached: true,
      });
    }

    const cutoff = Math.floor(Date.now() / 1000) - 86400;

    // For each creator, pick their single highest-viewer snapshot in the last 24h
    const sql = `
      WITH creator_peak AS (
        SELECT 
          s.creator_id,
          s.platform,
          s.viewers,
          s.stream_title,
          s.stream_category,
          s.captured_at,
          ROW_NUMBER() OVER (PARTITION BY s.creator_id ORDER BY s.viewers DESC) AS rn
        FROM snapshots s
        WHERE s.captured_at > ?
          AND s.viewers > 0
          AND s.stream_title IS NOT NULL
      )
      SELECT
        c.id,
        c.display_name,
        c.avatar_url,
        cp.platform AS primary_platform,
        cp.handle AS primary_handle,
        p.viewers AS peak_viewers,
        p.stream_title,
        p.stream_category,
        p.captured_at AS peak_at
      FROM creator_peak p
      INNER JOIN creators c ON c.id = p.creator_id
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE p.rn = 1
        AND c.role = 'creator'
      ORDER BY p.viewers DESC
      LIMIT 12
    `;

    const result = await env.DB.prepare(sql).bind(cutoff).all();
    const rows = result.results || [];
    const now = Math.floor(Date.now() / 1000);

    const recent = rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      platform: r.primary_platform,
      handle: r.primary_handle,
      peak_viewers: r.peak_viewers || 0,
      stream_title: r.stream_title || null,
      game_name: r.stream_category || null,
      hours_ago: Math.max(0, Math.round((now - r.peak_at) / 3600)),
      profile_url: `/creator/${r.id}`,
    }));

    // Cache for 5 minutes
    await env.KV.put(
      'recent-live:24h',
      JSON.stringify({ recent, ts: Date.now() }),
      { expirationTtl: 600 }
    );

    return jsonResponse({
      ok: true,
      recent,
      count: recent.length,
      cached: false,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

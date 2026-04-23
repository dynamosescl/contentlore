// ================================================================
// functions/api/live-now.js  (Phase 2 rewrite)
// GET /api/live-now
// 
// Returns currently-live creators using stream_sessions.is_ongoing.
// Adds uptime_mins (since session start) and handles edge cases.
// Falls back to latest-snapshot query if sessions aren't populated yet.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // Prefer stream_sessions.is_ongoing
    const sessRes = await env.DB.prepare(`
      SELECT 
        c.id, c.display_name, c.avatar_url,
        cp.handle, cp.platform,
        ss.started_at, ss.peak_viewers, ss.avg_viewers,
        ss.primary_category, ss.final_title
      FROM stream_sessions ss
      INNER JOIN creators c ON c.id = ss.creator_id
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE ss.is_ongoing = 1
        AND c.role = 'creator'
      ORDER BY ss.peak_viewers DESC
    `).all();

    const rows = sessRes.results || [];

    // If sessions aren't populated, fall back to the latest snapshot approach
    if (rows.length === 0) {
      return await fallbackToSnapshots(env);
    }

    const now = Math.floor(Date.now() / 1000);
    const live = rows.map((r) => {
      const uptimeMins = r.started_at != null
        ? Math.max(0, Math.round((now - r.started_at) / 60))
        : null;
      // Get most recent viewer count from snapshots (session tracks peak not current)
      return {
        id: r.id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        platform: r.platform,
        handle: r.handle,
        viewers: r.peak_viewers, // best available without extra DB hit
        peak_viewers: r.peak_viewers,
        uptime_mins: uptimeMins,
        game_name: r.primary_category,
        stream_title: r.final_title,
        profile_url: `/creator/${r.id}`,
      };
    });

    // Enrich with current viewer count from latest snapshots (one query, all creators)
    if (live.length > 0) {
      const byId = new Map(live.map((c) => [c.id, c]));
      const ids = live.map(l => l.id);
      const placeholders = ids.map(() => '?').join(',');

      // Optionally fetch viewer counts from the most-recent row
      const viewerRes = await env.DB.prepare(`
        SELECT creator_id, viewers
        FROM snapshots
        WHERE creator_id IN (${placeholders})
          AND is_live = 1
          AND captured_at IN (SELECT MAX(captured_at) FROM snapshots s2 WHERE s2.creator_id = snapshots.creator_id AND s2.is_live = 1)
      `).bind(...ids).all();

      for (const r of (viewerRes.results || [])) {
        const target = byId.get(r.creator_id);
        if (target) target.viewers = r.viewers;
      }
    }

    return jsonResponse({ ok: true, live, count: live.length, source: 'sessions' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Fallback when stream_sessions table is empty / not yet populated.
// Uses the most recent snapshot per creator if within the last hour.
async function fallbackToSnapshots(env) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  const res = await env.DB.prepare(`
    SELECT 
      c.id, c.display_name, c.avatar_url,
      cp.handle, s.platform,
      s.viewers, s.stream_title, s.stream_category AS game_name, s.started_at, s.captured_at
    FROM snapshots s
    INNER JOIN creators c ON c.id = s.creator_id
    LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
    WHERE s.captured_at > ?
      AND s.is_live = 1
      AND c.role = 'creator'
      AND s.id IN (
        SELECT MAX(id) FROM snapshots WHERE is_live = 1 GROUP BY creator_id
      )
    ORDER BY s.viewers DESC
  `).bind(cutoff).all();

  const now = Math.floor(Date.now() / 1000);
  const live = (res.results || []).map(r => ({
    id: r.id,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    platform: r.platform,
    handle: r.handle,
    viewers: r.viewers || 0,
    uptime_mins: r.started_at ? Math.max(0, Math.round((now - r.started_at) / 60)) : null,
    game_name: r.game_name,
    stream_title: r.stream_title,
    profile_url: `/creator/${r.id}`,
  }));

  return jsonResponse({ ok: true, live, count: live.length, source: 'snapshots_fallback' });
}

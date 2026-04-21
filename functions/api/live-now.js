// ================================================================
// functions/api/live-now.js
// GET /api/live-now
// Returns every tracked creator currently live with full context:
// title, game, viewers, duration. KV-cached for 60 seconds to avoid
// hammering platform APIs on every homepage/discover load.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // KV cache first — live state doesn't change every second
    const cached = await env.KV.get('live-now:full', 'json');
    if (cached && cached.ts && (Date.now() - cached.ts) < 60000) {
      return jsonResponse({
        ok: true,
        live: cached.live,
        count: cached.live.length,
        cached: true,
      });
    }

    // Reconstruct from latest snapshot per creator where viewers > 0
    const recentCutoff = Math.floor(Date.now() / 1000) - 3600;

    const sql = `
      WITH latest AS (
        SELECT 
          creator_id, platform, viewers, followers, is_live,
          stream_title, stream_category, started_at, captured_at,
          ROW_NUMBER() OVER (PARTITION BY creator_id, platform ORDER BY captured_at DESC) AS rn
        FROM snapshots
        WHERE captured_at > ?
      )
      SELECT 
        c.id,
        c.display_name,
        c.avatar_url,
        cp.platform AS primary_platform,
        cp.handle   AS primary_handle,
        l.viewers,
        l.followers,
        l.stream_title,
        l.stream_category AS game_name,
        l.started_at,
        l.captured_at
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      INNER JOIN latest l              ON l.creator_id = c.id AND l.platform = cp.platform AND l.rn = 1
      WHERE c.role = 'creator'
        AND l.is_live = 1
      ORDER BY l.viewers DESC
      LIMIT 200
    `;

    const result = await env.DB.prepare(sql).bind(recentCutoff).all();
    const rows = result.results || [];
    const now = Math.floor(Date.now() / 1000);

    const live = rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      platform: r.primary_platform,
      handle: r.primary_handle,
      viewers: r.viewers || 0,
      followers: r.followers || 0,
      stream_title: r.stream_title || null,
      game_name: r.game_name || null,
      uptime_mins: r.started_at ? Math.round((now - r.started_at) / 60) : null,
      profile_url: `/creator/${r.id}`,
      watch_url: r.primary_platform === 'twitch'
        ? `https://twitch.tv/${r.primary_handle}`
        : r.primary_platform === 'kick'
          ? `https://kick.com/${r.primary_handle}`
          : null,
    }));

    // Cache for 60 seconds
    await env.KV.put(
      'live-now:full',
      JSON.stringify({ live, ts: Date.now() }),
      { expirationTtl: 120 }
    );

    return jsonResponse({
      ok: true,
      live,
      count: live.length,
      cached: false,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/live.js
// GET /api/live
// Returns current count of live creators across platforms.
// Polled by the sidebar live indicator.
// Uses KV cache (3 min TTL) to avoid hammering platform APIs.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // Check KV cache first
    const cached = await env.KV.get('live:counts', 'json');
    if (cached && cached.ts && (Date.now() - cached.ts) < 180000) {
      const platformCounts = cached.platform_counts || {};
      return jsonResponse({
        ok: true,
        total: cached.total,
        twitch: cached.twitch ?? platformCounts.twitch ?? 0,
        kick: cached.kick ?? platformCounts.kick ?? 0,
        youtube: cached.youtube ?? platformCounts.youtube ?? 0,
        platform_counts: platformCounts,
        cached: true,
      });
    }

    // Fetch all primary platforms for verified creators
    // We don't call platform APIs here — that would be 189+ requests.
    // Instead we look at the latest snapshot to see which creators
    // were reported as live by the refresh worker.
    // viewers > 0 in latest snapshot = currently live.
    const recentCutoff = Math.floor(Date.now() / 1000) - 3600; // 1 hour

    const sql = `
      WITH latest AS (
        SELECT creator_id, platform, viewers, captured_at,
          ROW_NUMBER() OVER (PARTITION BY creator_id, platform ORDER BY captured_at DESC) AS rn
        FROM snapshots
        WHERE captured_at > ?
      )
      SELECT platform, COUNT(*) AS live_count
      FROM latest
      WHERE rn = 1 AND viewers IS NOT NULL AND viewers > 0
      GROUP BY platform
    `;

    const result = await env.DB.prepare(sql).bind(recentCutoff).all();
    const rows = result.results || [];
    const platformCounts = {};
    let total = 0;
    for (const r of rows) {
      const key = String(r.platform || '').toLowerCase();
      const count = Number(r.live_count || 0);
      platformCounts[key] = count;
      total += count;
    }
    const twitch = platformCounts.twitch || 0;
    const kick = platformCounts.kick || 0;
    const youtube = platformCounts.youtube || 0;

    // Cache for 3 minutes
    await env.KV.put(
      'live:counts',
      JSON.stringify({ total, twitch, kick, youtube, platform_counts: platformCounts, ts: Date.now() }),
      { expirationTtl: 300 }
    );

    return jsonResponse({ ok: true, total, twitch, kick, youtube, platform_counts: platformCounts, cached: false });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

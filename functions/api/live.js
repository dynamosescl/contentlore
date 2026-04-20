// ================================================================
// functions/api/live.js
// GET /api/live
// Returns current count of live creators across Twitch + Kick.
// Polled by the sidebar live indicator.
// Uses KV cache (3 min TTL) to avoid hammering platform APIs.
// ================================================================

import { jsonResponse, fetchTwitchStream, fetchKickChannel } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // Check KV cache first
    const cached = await env.KV.get('live:counts', 'json');
    if (cached && cached.ts && (Date.now() - cached.ts) < 180000) {
      return jsonResponse({
        ok: true,
        total: cached.total,
        twitch: cached.twitch,
        kick: cached.kick,
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
    let twitch = 0;
    let kick = 0;
    for (const r of rows) {
      if (r.platform === 'twitch') twitch = r.live_count;
      if (r.platform === 'kick') kick = r.live_count;
    }
    const total = twitch + kick;

    // Cache for 3 minutes
    await env.KV.put(
      'live:counts',
      JSON.stringify({ total, twitch, kick, ts: Date.now() }),
      { expirationTtl: 300 }
    );

    return jsonResponse({ ok: true, total, twitch, kick, cached: false });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

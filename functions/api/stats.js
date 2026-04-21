// ================================================================
// functions/api/stats.js
// GET /api/stats
// Returns homepage headline numbers: total creators tracked, total
// snapshots logged, platforms covered. Cached in KV for 5 minutes.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    // KV cache first \u2014 headline numbers don't need to be real-time
    const cached = await env.KV.get('stats:homepage', 'json');
    if (cached && cached.ts && (Date.now() - cached.ts) < 300000) {
      return jsonResponse({
        ok: true,
        creators: cached.creators,
        snapshots: cached.snapshots,
        platforms: cached.platforms,
        cached: true,
      });
    }

    const [creatorsRow, snapshotsRow, platformsRow] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM creators WHERE role = 'creator'`
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM snapshots`
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT platform) AS n FROM creator_platforms`
      ).first(),
    ]);

    const creators = creatorsRow?.n || 0;
    const snapshots = snapshotsRow?.n || 0;
    const platforms = platformsRow?.n || 0;

    // Cache for 5 minutes
    await env.KV.put(
      'stats:homepage',
      JSON.stringify({ creators, snapshots, platforms, ts: Date.now() }),
      { expirationTtl: 300 }
    );

    return jsonResponse({
      ok: true,
      creators,
      snapshots,
      platforms,
      cached: false,
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: String(err?.message || err),
    }, 500);
  }
}

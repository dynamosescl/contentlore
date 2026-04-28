// ================================================================
// functions/api/scene-averages.js
// GET /api/scene-averages
//
// Returns avg concurrent streamers + avg total viewers per server,
// computed from scene_snapshots over the last 7 days. Used by the
// /gta-rp/servers/ status board's "Avg" column.
//
// scene_snapshots is written by the scheduler's captureSceneSnapshots
// step (~96 ticks/day during active hours, one row per active server
// per tick). 7-day rolling window means each active server typically
// has 200–600 sample rows.
//
// 5-minute Cache API hit.
// ================================================================

import { jsonResponse } from '../_lib.js';

const CACHE_URL = 'https://contentlore.com/cache/scene-averages';
const CACHE_TTL = 300;

export async function onRequestGet({ env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_URL);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const res = await env.DB.prepare(`
      SELECT server,
             COUNT(*)              AS sample_size,
             AVG(streamer_count)   AS avg_streamers,
             AVG(total_viewers)    AS avg_viewers,
             MAX(streamer_count)   AS peak_streamers,
             MAX(total_viewers)    AS peak_viewers
      FROM scene_snapshots
      WHERE snapshot_at > datetime('now', '-7 days')
      GROUP BY server
    `).all();

    const averages = {};
    for (const row of res.results || []) {
      averages[row.server] = {
        sample_size: row.sample_size,
        avg_streamers: row.avg_streamers != null ? Number(row.avg_streamers) : null,
        avg_viewers: row.avg_viewers != null ? Number(row.avg_viewers) : null,
        peak_streamers: row.peak_streamers || 0,
        peak_viewers: row.peak_viewers || 0,
      };
    }

    const payload = {
      ok: true,
      window: '7d',
      fetched_at: new Date().toISOString(),
      averages,
      server_count: Object.keys(averages).length,
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

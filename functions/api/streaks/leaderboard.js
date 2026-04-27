// ================================================================
// functions/api/streaks/leaderboard.js
// GET /api/streaks/leaderboard?order=current|max&limit=50
//
// Returns the top streak holders. Privacy filter: only rows with
// a non-empty display_name are surfaced (anonymous users never
// appear). 5-minute KV cache per (order, limit) tuple.
// ================================================================

import { jsonResponse } from '../../_lib.js';

const CACHE_TTL = 300;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const order = url.searchParams.get('order') === 'max' ? 'max' : 'current';
  const limitRaw = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);

  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/streaks-leaderboard/${order}/${limit}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const orderColumn = order === 'max' ? 'max_streak' : 'current_streak';

  try {
    const res = await env.DB.prepare(`
      SELECT display_name, current_streak, max_streak, total_visits, last_visit_at
      FROM watch_streaks
      WHERE display_name IS NOT NULL AND display_name <> ''
      ORDER BY ${orderColumn} DESC, last_visit_at DESC
      LIMIT ?
    `).bind(limit).all();

    const entries = (res.results || []).map((r, i) => ({
      rank: i + 1,
      display_name: r.display_name,
      current_streak: r.current_streak,
      max_streak: r.max_streak,
      total_visits: r.total_visits,
      last_visit_at: r.last_visit_at,
    }));

    const totalsRes = await env.DB.prepare(
      'SELECT COUNT(*) AS users, SUM(total_visits) AS visits FROM watch_streaks'
    ).first();

    const payload = {
      ok: true,
      order,
      limit,
      count: entries.length,
      total_users: totalsRes?.users || 0,
      total_visits: totalsRes?.visits || 0,
      entries,
      fetched_at: new Date().toISOString(),
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

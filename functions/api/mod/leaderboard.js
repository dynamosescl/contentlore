// ================================================================
// functions/api/mod/leaderboard.js
// GET /api/mod/leaderboard?limit=10&order=xp|recent
//
// Public read. Returns verified mods sorted by lifetime XP (default)
// or recent-XP (sum over the last 30 days, used for the Mod of the
// Month surface). Token-stripped.
//
// 5-min Cache API hit per (limit, order) pair.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, publicMod } from '../../_mod-auth.js';

const CACHE_TTL = 300;
const MAX_LIMIT = 50;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
  const order = url.searchParams.get('order') === 'recent' ? 'recent' : 'xp';

  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/mod-leaderboard/${order}-${limit}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let stmt;
  if (order === 'recent') {
    // Sum XP earned in the last 30 days, then join account for level/etc.
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    stmt = env.DB.prepare(`
      SELECT m.*, COALESCE(SUM(c.xp_earned), 0) AS recent_xp
        FROM mod_accounts m
        LEFT JOIN mod_contributions c ON c.mod_id = m.id AND c.created_at >= ?
       WHERE m.status = 'verified'
       GROUP BY m.id
       ORDER BY recent_xp DESC, m.xp DESC
       LIMIT ?
    `).bind(since, limit);
  } else {
    stmt = env.DB.prepare(`
      SELECT * FROM mod_accounts
       WHERE status = 'verified'
       ORDER BY xp DESC, id ASC
       LIMIT ?
    `).bind(limit);
  }

  try {
    const res = await stmt.all();
    const mods = (res.results || []).map(r => {
      const m = publicMod(hydrate(r));
      if (r.recent_xp != null) m.recent_xp = Number(r.recent_xp);
      return m;
    });

    const response = new Response(JSON.stringify({ ok: true, count: mods.length, order, mods }), {
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

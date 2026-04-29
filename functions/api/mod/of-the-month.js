// ================================================================
// functions/api/mod/of-the-month.js
// GET /api/mod/of-the-month
//
// Three pieces:
//   - current.leader    — verified mod with the most XP earned this
//                         calendar month so far (preview, no badge yet)
//   - last_winner       — the locked-in winner of the previous month,
//                         set by /api/admin/finalise-mod-of-month at
//                         the 1st-of-the-month scheduler tick
//   - history           — past winners, latest first
//
// Public read, 1h Cache API.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, publicMod } from '../../_mod-auth.js';

const CACHE_TTL = 3600;

function ymOfDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthStart(d) {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}
function monthStartFromYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, 1) / 1000);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/mod-of-month/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const now = new Date();
  const curYm = ymOfDate(now);
  const curStart = monthStart(now);

  // Current month's leader so far.
  const leaderRes = await env.DB.prepare(`
    SELECT m.*, COALESCE(SUM(c.xp_earned), 0) AS month_xp
      FROM mod_accounts m
      LEFT JOIN mod_contributions c ON c.mod_id = m.id AND c.created_at >= ?
     WHERE m.status = 'verified'
     GROUP BY m.id
    HAVING month_xp > 0
     ORDER BY month_xp DESC
     LIMIT 1
  `).bind(curStart).first();

  const currentLeader = leaderRes
    ? {
        ...publicMod(hydrate(leaderRes)),
        month_xp: Number(leaderRes.month_xp || 0),
      }
    : null;

  // History — every locked-in winner.
  const histRes = await env.DB.prepare(`
    SELECT * FROM mod_accounts WHERE mod_of_month IS NOT NULL ORDER BY mod_of_month DESC
  `).all();
  const history = (histRes.results || []).map(r => publicMod(hydrate(r)));

  // Last winner = first row in history whose month is NOT the current
  // month (we don't lock current month until /api/admin/finalise runs).
  const last_winner = history.find(h => h.mod_of_month && h.mod_of_month !== curYm) || null;

  const payload = {
    ok: true,
    current: { month: curYm, leader: currentLeader },
    last_winner,
    history,
    generated_at: new Date().toISOString(),
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
}

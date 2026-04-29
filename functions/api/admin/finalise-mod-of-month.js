// ================================================================
// functions/api/admin/finalise-mod-of-month.js
// POST /api/admin/finalise-mod-of-month  body: { month?: 'YYYY-MM' }
//
// Locks in the Mod of the Month winner for a given calendar month.
// `month` defaults to the previous calendar month — that's how the
// scheduler calls this on the 1st-of-the-month tick.
//
// Strategy:
//   1. Sum XP earned per verified mod within [month_start, month_end).
//   2. Pick the top scorer with at least one contribution.
//   3. Set mod_accounts.mod_of_month = '<month>' for the winner.
//   4. Idempotent — if a winner is already locked for the month,
//      returns it without changing anything (unless ?force=1).
//
// Bearer ADMIN_TOKEN.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, publicMod } from '../../_mod-auth.js';

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/, '').trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, error: 'Unauthorised' }, 401);
  }
  return null;
}

function previousMonthYm() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCDate(0); // last day of previous month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m, 1) / 1000);
  return { start, end };
}

export async function onRequestPost({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const month = (body?.month || previousMonthYm());
  if (!/^\d{4}-\d{2}$/.test(month)) return jsonResponse({ ok: false, error: 'month must be YYYY-MM' }, 400);

  const { start, end } = monthBounds(month);

  // Already locked?
  const existing = await env.DB.prepare(
    `SELECT * FROM mod_accounts WHERE mod_of_month = ? LIMIT 1`
  ).bind(month).first();
  if (existing && !force) {
    return jsonResponse({ ok: true, month, locked: true, winner: publicMod(hydrate(existing)) });
  }

  // Compute leader: most XP in the month among verified mods.
  const leaderRes = await env.DB.prepare(`
    SELECT m.id AS mod_id, m.*, COALESCE(SUM(c.xp_earned), 0) AS month_xp
      FROM mod_accounts m
      LEFT JOIN mod_contributions c ON c.mod_id = m.id
        AND c.created_at >= ? AND c.created_at < ?
     WHERE m.status = 'verified'
     GROUP BY m.id
    HAVING month_xp > 0
     ORDER BY month_xp DESC
     LIMIT 1
  `).bind(start, end).first();

  if (!leaderRes) {
    return jsonResponse({ ok: true, month, locked: false, reason: 'no contributions in window' });
  }

  // If forcing and there's a different existing winner, clear them first
  // so two mods don't carry the same month label.
  if (force && existing) {
    await env.DB.prepare(
      `UPDATE mod_accounts SET mod_of_month = NULL WHERE mod_of_month = ? AND id != ?`
    ).bind(month, leaderRes.id).run();
  }

  await env.DB.prepare(
    `UPDATE mod_accounts SET mod_of_month = ? WHERE id = ?`
  ).bind(month, leaderRes.id).run();

  // Re-read so the response includes the freshly-set badge.
  const winnerRow = await env.DB.prepare(`SELECT * FROM mod_accounts WHERE id = ?`).bind(leaderRes.id).first();
  return jsonResponse({
    ok: true,
    month,
    locked: true,
    winner: publicMod(hydrate(winnerRow)),
    month_xp: Number(leaderRes.month_xp || 0),
  });
}

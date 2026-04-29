// ================================================================
// functions/api/mod/contributions.js
// GET /api/mod/contributions?limit=50&since=YYYY-MM-DD
//
// Bearer mod token. Returns the authenticated mod's contribution
// history with type breakdown, recent items, and XP totals.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, levelForXp, LEVELS } from '../../_mod-auth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const since = url.searchParams.get('since');
  let sinceTs = 0;
  if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const [y, m, d] = since.split('-').map(Number);
    sinceTs = Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
  }

  const stmt = sinceTs > 0
    ? env.DB.prepare(`SELECT id, type, target_id, xp_earned, created_at FROM mod_contributions
                       WHERE mod_id = ? AND created_at >= ?
                       ORDER BY created_at DESC LIMIT ?`).bind(mod.id, sinceTs, limit)
    : env.DB.prepare(`SELECT id, type, target_id, xp_earned, created_at FROM mod_contributions
                       WHERE mod_id = ?
                       ORDER BY created_at DESC LIMIT ?`).bind(mod.id, limit);

  const res = await stmt.all();
  const items = (res.results || []).map(r => ({
    id: r.id,
    type: r.type,
    target_id: r.target_id,
    xp_earned: Number(r.xp_earned || 0),
    created_at: Number(r.created_at || 0),
  }));

  // Group totals across the (filtered) window.
  const byType = {};
  let totalXp = 0;
  for (const c of items) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    totalXp += c.xp_earned;
  }

  const idx = LEVELS.findIndex(l => l.id === mod.level);
  const next = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  const cur = LEVELS[idx] || LEVELS[0];
  const progress = next
    ? Math.min(100, Math.round(((mod.xp - cur.min) / (next.min - cur.min)) * 100))
    : 100;

  return jsonResponse({
    ok: true,
    mod_id: mod.id,
    lifetime_xp: mod.xp,
    level: mod.level,
    level_label: levelForXp(mod.xp).label,
    next_level: next,
    progress_pct: progress,
    window_total_xp: totalXp,
    by_type: byType,
    items,
  });
}

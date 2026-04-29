// ================================================================
// functions/api/mod/report.js
// GET /api/mod/report?id={mod_id}
//
// Public mod report card. Returns enough for the shareable
// /moderators/report/?id={id} page: lifetime stats, this-month
// stats, breakdown by contribution type, XP per type, "highlights"
// (most-recent clip tags + flagged moments).
//
// 5-min Cache API hit per mod.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { hydrate, publicMod, levelForXp, LEVELS } from '../../_mod-auth.js';

const CACHE_TTL = 300;

function ymOfNow() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthBounds() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = Math.floor(Date.UTC(y, m, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m + 1, 1) / 1000);
  return { start, end };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id'), 10);
  if (!id) return jsonResponse({ ok: false, error: 'id required' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/mod-report/${id}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const row = await env.DB.prepare(
    `SELECT * FROM mod_accounts WHERE id = ? AND status = 'verified' LIMIT 1`
  ).bind(id).first();
  if (!row) return jsonResponse({ ok: false, error: 'mod not found' }, 404);

  const mod = publicMod(hydrate(row));
  const { start, end } = monthBounds();

  // Contributions this month — by type + total XP.
  const monthRes = await env.DB.prepare(`
    SELECT type, COUNT(*) AS n, COALESCE(SUM(xp_earned), 0) AS xp
      FROM mod_contributions
     WHERE mod_id = ? AND created_at >= ? AND created_at < ?
     GROUP BY type
  `).bind(id, start, end).all();
  const monthlyByType = {};
  let monthlyXp = 0;
  for (const r of (monthRes.results || [])) {
    monthlyByType[r.type] = { n: Number(r.n), xp: Number(r.xp) };
    monthlyXp += Number(r.xp || 0);
  }

  // Lifetime breakdown.
  const lifeRes = await env.DB.prepare(`
    SELECT type, COUNT(*) AS n, COALESCE(SUM(xp_earned), 0) AS xp
      FROM mod_contributions
     WHERE mod_id = ?
     GROUP BY type
  `).bind(id).all();
  const lifetimeByType = {};
  for (const r of (lifeRes.results || [])) {
    lifetimeByType[r.type] = { n: Number(r.n), xp: Number(r.xp) };
  }

  // Hours their creators streamed during this calendar month — sum
  // session minutes across creators_modded.
  let creatorHoursMonth = 0;
  if (mod.creators_modded.length) {
    const ph = mod.creators_modded.map(() => '?').join(',');
    const sessRes = await env.DB.prepare(`
      SELECT SUM(ss.duration_mins) AS mins
        FROM stream_sessions ss
        INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
       WHERE cp.handle IN (${ph})
         AND ss.started_at >= ? AND ss.started_at < ?
    `).bind(...mod.creators_modded, start, end).first();
    creatorHoursMonth = Math.round(Number(sessRes?.mins || 0) / 60 * 10) / 10;
  }

  // Highlights — most recent 5 clip tags + 5 flagged moments (across
  // their stream-notes rows).
  const tagsRes = await env.DB.prepare(`
    SELECT clip_id, tag, context_description, created_at
      FROM clip_tags
     WHERE submitted_by_mod = ?
     ORDER BY created_at DESC
     LIMIT 8
  `).bind(id).all();

  const flaggedRes = await env.DB.prepare(`
    SELECT creator_handle, session_date, flagged_moments
      FROM mod_stream_notes
     WHERE mod_id = ?
       AND LENGTH(COALESCE(flagged_moments, '[]')) > 2
     ORDER BY session_date DESC
     LIMIT 10
  `).bind(id).all();
  const flagged = [];
  for (const r of (flaggedRes.results || [])) {
    let arr = [];
    try { arr = JSON.parse(r.flagged_moments || '[]'); } catch {}
    for (const f of arr) {
      flagged.push({
        creator_handle: r.creator_handle,
        session_date: r.session_date,
        ts: Number(f.ts || 0),
        label: String(f.label || 'Notable moment'),
      });
    }
  }
  flagged.sort((a, b) => b.ts - a.ts);

  // Level progress.
  const idx = LEVELS.findIndex(l => l.id === mod.level);
  const next = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  const cur = LEVELS[idx] || LEVELS[0];
  const progress = next
    ? Math.min(100, Math.round(((mod.xp - cur.min) / (next.min - cur.min)) * 100))
    : 100;

  const payload = {
    ok: true,
    mod,
    month: ymOfNow(),
    monthly: {
      xp: monthlyXp,
      hours_streamed_by_creators: creatorHoursMonth,
      by_type: monthlyByType,
    },
    lifetime: {
      xp: mod.xp,
      level: mod.level,
      level_label: levelForXp(mod.xp).label,
      next_level: next,
      progress_pct: progress,
      by_type: lifetimeByType,
    },
    highlights: {
      recent_clip_tags: (tagsRes.results || []).map(r => ({
        clip_id: r.clip_id,
        tag: r.tag,
        context_description: r.context_description,
        created_at: Number(r.created_at || 0),
      })),
      recent_flagged_moments: flagged.slice(0, 8),
    },
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

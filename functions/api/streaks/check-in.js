// ================================================================
// functions/api/streaks/check-in.js
// POST /api/streaks/check-in   { user_id, display_name? }
//
// Idempotent within a UTC day — a creator can fire this on every page
// load; only the first call per day actually mutates state. Returns the
// streak record + the badges they currently hold.
//
// Privacy: anonymous. user_id is a client-generated UUID stored in
// localStorage. display_name is optional; if absent, the user never
// appears on the leaderboard.
// ================================================================

import { jsonResponse } from '../../_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 24;

const BADGES = [
  { id: 'week-warrior',  threshold: 7,   label: 'Week Warrior' },
  { id: 'month-regular', threshold: 30,  label: 'Month Regular' },
  { id: 'scene-veteran', threshold: 100, label: 'Scene Veteran' },
];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const userId = String(body?.user_id || '').toLowerCase();
  if (!UUID_RE.test(userId)) {
    return jsonResponse({ ok: false, error: 'invalid_user_id' }, 400);
  }

  const rawName = body?.display_name;
  let displayName = null;
  if (rawName != null) {
    const cleaned = String(rawName).trim().slice(0, NAME_MAX);
    // Conservative allowlist — alphanumerics, underscore, dash, dot, space.
    // Avoids URL/HTML mischief without being unfriendly to international handles.
    if (cleaned.length > 0 && /^[\w. -]{1,24}$/.test(cleaned)) {
      displayName = cleaned;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const todayStart = utcDayStart(now);
  const yesterdayStart = todayStart - 86400;

  try {
    const existing = await env.DB.prepare(
      'SELECT user_id, display_name, first_visit_at, last_visit_at, current_streak, max_streak, total_visits FROM watch_streaks WHERE user_id = ?'
    ).bind(userId).first();

    let row;
    if (!existing) {
      // First-ever check-in — create the row.
      row = {
        user_id: userId,
        display_name: displayName,
        first_visit_at: now,
        last_visit_at: now,
        current_streak: 1,
        max_streak: 1,
        total_visits: 1,
      };
      await env.DB.prepare(`
        INSERT INTO watch_streaks
          (user_id, display_name, first_visit_at, last_visit_at, current_streak, max_streak, total_visits)
        VALUES (?, ?, ?, ?, 1, 1, 1)
      `).bind(userId, displayName, now, now).run();
    } else {
      row = { ...existing };
      // Pick up display_name updates separately from the streak math.
      const nameChanged = displayName != null && displayName !== existing.display_name;

      if (existing.last_visit_at >= todayStart) {
        // Already counted today. Apply name change if any; otherwise no-op.
        if (nameChanged) {
          row.display_name = displayName;
          await env.DB.prepare('UPDATE watch_streaks SET display_name = ? WHERE user_id = ?')
            .bind(displayName, userId).run();
        }
      } else {
        // Streak math.
        const consecutive = existing.last_visit_at >= yesterdayStart;
        const newCurrent = consecutive ? existing.current_streak + 1 : 1;
        const newMax = Math.max(existing.max_streak, newCurrent);
        const newTotal = existing.total_visits + 1;
        row.current_streak = newCurrent;
        row.max_streak = newMax;
        row.total_visits = newTotal;
        row.last_visit_at = now;
        if (nameChanged) row.display_name = displayName;

        await env.DB.prepare(`
          UPDATE watch_streaks
          SET last_visit_at = ?,
              current_streak = ?,
              max_streak = ?,
              total_visits = ?,
              display_name = COALESCE(?, display_name)
          WHERE user_id = ?
        `).bind(now, newCurrent, newMax, newTotal, nameChanged ? displayName : null, userId).run();
      }
    }

    return jsonResponse({
      ok: true,
      streak: {
        user_id: row.user_id,
        display_name: row.display_name,
        first_visit_at: row.first_visit_at,
        last_visit_at: row.last_visit_at,
        current_streak: row.current_streak,
        max_streak: row.max_streak,
        total_visits: row.total_visits,
      },
      badges: badgesForStreak(row.current_streak, row.max_streak),
      next_badge: nextBadge(row.current_streak),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function utcDayStart(unixSec) {
  return Math.floor(unixSec / 86400) * 86400;
}

function badgesForStreak(current, max) {
  return BADGES.map(b => ({
    id: b.id,
    label: b.label,
    threshold: b.threshold,
    earned_now: current >= b.threshold,
    earned_ever: max >= b.threshold,
  }));
}

function nextBadge(current) {
  const next = BADGES.find(b => b.threshold > current);
  return next ? { id: next.id, label: next.label, threshold: next.threshold, days_to_go: next.threshold - current } : null;
}

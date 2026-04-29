// ================================================================
// functions/api/mod/flag-moment.js
// POST /api/mod/flag-moment
// Body: { creator_handle, session_date?, label?, ts? }
//
// Appends one entry to mod_stream_notes.flagged_moments JSON array
// for the given (mod, creator, day). label is optional (defaults to
// "Notable moment"); ts is unix-seconds (defaults to "now").
//
// Permission: 'flag_moment' (Rookie+). Awards +5 XP per flag.
// Hard cap: 30 flags per (mod, creator, day) so the array stays
// reasonable for downstream consumers (creator profile timeline,
// recap prompts).
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';

const MAX_FLAGS_PER_DAY = 30;
const MAX_LABEL = 120;

function ukToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

export async function onRequestPost({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'flag_moment')) {
    return jsonResponse({ ok: false, error: 'flag_moment permission required' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const creator = String(body?.creator_handle || '').toLowerCase();
  const date = String(body?.session_date || ukToday()).slice(0, 10);
  if (!creator) return jsonResponse({ ok: false, error: 'creator_handle required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ ok: false, error: 'session_date must be YYYY-MM-DD' }, 400);
  if (!modModsCreator(mod, creator)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that creator' }, 403);
  }

  const ts = Number(body?.ts) || Math.floor(Date.now() / 1000);
  const label = String(body?.label ?? '').trim().slice(0, MAX_LABEL) || 'Notable moment';

  // Read the existing row (or treat as empty), append the flag,
  // re-save. UPSERT keeps the schema honest.
  const existing = await env.DB.prepare(
    `SELECT flagged_moments FROM mod_stream_notes WHERE mod_id = ? AND creator_handle = ? AND session_date = ?`
  ).bind(mod.id, creator, date).first();

  let flags = [];
  if (existing?.flagged_moments) {
    try { flags = JSON.parse(existing.flagged_moments) || []; } catch {}
  }
  if (flags.length >= MAX_FLAGS_PER_DAY) {
    return jsonResponse({ ok: false, error: `cap reached (${MAX_FLAGS_PER_DAY} flags per day)` }, 429);
  }
  flags.push({ ts, label });

  await env.DB.prepare(
    `INSERT INTO mod_stream_notes (mod_id, creator_handle, session_date, notes, flagged_moments)
     VALUES (?, ?, ?, '', ?)
     ON CONFLICT(mod_id, creator_handle, session_date) DO UPDATE SET
       flagged_moments = excluded.flagged_moments,
       updated_at = unixepoch()`
  ).bind(mod.id, creator, date, JSON.stringify(flags)).run();

  const result = await awardXp(env, mod.id, 'moment_flag', `${creator}:${date}:${ts}`);

  return jsonResponse({
    ok: true,
    creator_handle: creator,
    session_date: date,
    flagged_moments: flags,
    xp_awarded: 5,
    xp_after: result.xp_after,
    level: result.level,
  });
}

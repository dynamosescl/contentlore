// ================================================================
// functions/api/mod/stream-notes.js
// GET  /api/mod/stream-notes?creator={handle}&date=YYYY-MM-DD
// POST /api/mod/stream-notes  body: { creator_handle, session_date?, notes }
//
// Auto-saves the mod's notepad every 30 seconds. UPSERT keeps one row
// per (mod, creator, day). +20 XP awarded once per (mod, creator, day)
// — subsequent autosaves don't double-award.
//
// session_date defaults to today's UK date (Europe/London) so the
// notepad rolls over at UK midnight without the client doing anything.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';

const MAX_NOTES = 10000;

function ukToday() {
  // Europe/London via Intl is more precise than the BST approximation.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date()); // YYYY-MM-DD
}

export async function onRequestGet({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  const url = new URL(request.url);
  const creator = (url.searchParams.get('creator') || '').toLowerCase();
  const date = url.searchParams.get('date') || ukToday();
  if (!creator) return jsonResponse({ ok: false, error: 'creator query param required' }, 400);
  if (!modModsCreator(mod, creator)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that creator' }, 403);
  }

  const row = await env.DB.prepare(
    `SELECT id, notes, flagged_moments, updated_at, created_at
       FROM mod_stream_notes
      WHERE mod_id = ? AND creator_handle = ? AND session_date = ?
      LIMIT 1`
  ).bind(mod.id, creator, date).first();

  if (!row) {
    return jsonResponse({ ok: true, exists: false, date, notes: '', flagged_moments: [] });
  }

  let flags = [];
  try { flags = JSON.parse(row.flagged_moments || '[]'); } catch {}
  return jsonResponse({
    ok: true,
    exists: true,
    id: row.id,
    date,
    notes: row.notes || '',
    flagged_moments: flags,
    updated_at: Number(row.updated_at || 0),
    created_at: Number(row.created_at || 0),
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'stream_notes')) {
    return jsonResponse({ ok: false, error: 'stream_notes permission required' }, 403);
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

  const notes = String(body?.notes ?? '').slice(0, MAX_NOTES);
  const targetId = `${creator}:${date}`;

  // Has the mod already earned XP for stream_notes on this (creator, day)?
  // mod_contributions.target_id is the source of truth for that.
  const dupe = await env.DB.prepare(
    `SELECT 1 FROM mod_contributions
      WHERE mod_id = ? AND type = 'stream_notes' AND target_id = ?
      LIMIT 1`
  ).bind(mod.id, targetId).first();

  // UPSERT note.
  await env.DB.prepare(
    `INSERT INTO mod_stream_notes (mod_id, creator_handle, session_date, notes, flagged_moments)
     VALUES (?, ?, ?, ?, COALESCE((SELECT flagged_moments FROM mod_stream_notes WHERE mod_id = ? AND creator_handle = ? AND session_date = ?), '[]'))
     ON CONFLICT(mod_id, creator_handle, session_date) DO UPDATE SET
       notes = excluded.notes,
       updated_at = unixepoch()`
  ).bind(mod.id, creator, date, notes, mod.id, creator, date).run();

  let xp = 0; let level = mod.level; let xp_after = mod.xp;
  // Only award XP if there's something written (avoid awarding empty saves)
  // and the day hasn't been awarded yet.
  if (!dupe && notes.trim().length >= 20) {
    const result = await awardXp(env, mod.id, 'stream_notes', targetId);
    xp = 20; level = result.level; xp_after = result.xp_after;
  }

  return jsonResponse({
    ok: true,
    creator_handle: creator,
    session_date: date,
    saved_at: Math.floor(Date.now() / 1000),
    xp_awarded: xp,
    xp_after,
    level,
  });
}

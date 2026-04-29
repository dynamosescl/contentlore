// ================================================================
// functions/api/mod/character.js
// POST /api/mod/character          — create
// PUT  /api/mod/character          — edit (body must include id)
// DELETE /api/mod/character        — body { id } (mark deleted by setting status='dead')
//
// Permission: 'add_character' (Regular+). Auto-approved when submitted
// by a verified mod (the schema has approved=0 default to also support
// non-mod-submitted entries in the future).
//
// Awards +25 XP per CREATE. Edits don't award additional XP — just
// the work itself does.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, hasPerm, modModsCreator, awardXp } from '../../_mod-auth.js';
import { getCuratedEntry } from '../../_curated.js';

const VALID_STATUSES = new Set(['active', 'retired', 'dead']);
const MAX_NAME = 80;
const MAX_DESC = 600;
const MAX_FIELD = 100;

function clean(s, max) {
  return String(s ?? '').trim().slice(0, max) || null;
}

export async function onRequestPost({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'add_character')) {
    return jsonResponse({ ok: false, error: 'requires Regular level (100 XP)' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const handle = String(body?.played_by_handle || '').toLowerCase();
  const name = clean(body?.character_name, MAX_NAME);
  if (!handle || !name) {
    return jsonResponse({ ok: false, error: 'character_name and played_by_handle required' }, 400);
  }
  if (!modModsCreator(mod, handle)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that creator' }, 403);
  }
  const entry = await getCuratedEntry(env, handle);
  if (!entry) return jsonResponse({ ok: false, error: 'creator not found' }, 404);

  const server = clean(body?.server, MAX_FIELD);
  const faction = clean(body?.faction, MAX_FIELD);
  const description = clean(body?.description, MAX_DESC);
  const status = VALID_STATUSES.has(body?.status) ? body.status : 'active';

  const res = await env.DB.prepare(
    `INSERT INTO characters (character_name, played_by_handle, server, faction, description, status, submitted_by_mod, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(name, handle, server, faction, description, status, mod.id).run();

  const newId = res?.meta?.last_row_id || null;
  const result = await awardXp(env, mod.id, 'character_add', String(newId || ''));

  return jsonResponse({
    ok: true,
    id: newId,
    character: { id: newId, character_name: name, played_by_handle: handle, server, faction, description, status, approved: 1 },
    xp_awarded: 25,
    xp_after: result.xp_after,
    level: result.level,
  });
}

export async function onRequestPut({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  if (!hasPerm(mod, 'add_character')) {
    return jsonResponse({ ok: false, error: 'requires Regular level (100 XP)' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid json' }, 400); }

  const id = parseInt(body?.id, 10);
  if (!id) return jsonResponse({ ok: false, error: 'id required' }, 400);

  const row = await env.DB.prepare(`SELECT * FROM characters WHERE id = ?`).bind(id).first();
  if (!row) return jsonResponse({ ok: false, error: 'character not found' }, 404);

  const playedBy = String(row.played_by_handle).toLowerCase();
  if (!modModsCreator(mod, playedBy)) {
    return jsonResponse({ ok: false, error: 'you are not a mod for that character\'s creator' }, 403);
  }

  // Apply only the fields the client sent. character_name + played_by_handle locked once created.
  const updates = [];
  const params = [];
  if ('server' in body)       { updates.push('server = ?');      params.push(clean(body.server, MAX_FIELD)); }
  if ('faction' in body)      { updates.push('faction = ?');     params.push(clean(body.faction, MAX_FIELD)); }
  if ('description' in body)  { updates.push('description = ?'); params.push(clean(body.description, MAX_DESC)); }
  if ('status' in body && VALID_STATUSES.has(body.status)) {
    updates.push('status = ?');
    params.push(body.status);
  }
  if (!updates.length) return jsonResponse({ ok: false, error: 'no editable fields' }, 400);

  updates.push('updated_at = unixepoch()');
  params.push(id);
  await env.DB.prepare(
    `UPDATE characters SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return jsonResponse({ ok: true, id });
}

// ================================================================
// functions/api/characters.js
// GET /api/characters?creator={handle}     — list characters for a creator
// GET /api/characters?search={query}       — search across all approved characters
// GET /api/characters                       — list everything (cap 100)
//
// Public read-only. Only returns approved characters. 5-min Cache API.
// ================================================================

import { jsonResponse } from '../_lib.js';

const CACHE_TTL = 300;
const HARD_LIMIT = 100;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const creator = (url.searchParams.get('creator') || '').toLowerCase().trim();
  const search = (url.searchParams.get('search') || '').trim();

  // Cache key derived from query params.
  const cacheTag = creator
    ? `creator:${creator}`
    : search ? `search:${search.toLowerCase().slice(0, 60)}` : 'all';
  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/characters/${encodeURIComponent(cacheTag)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let stmt;
  if (creator) {
    if (!/^[a-z0-9_.-]{2,64}$/.test(creator)) return jsonResponse({ ok: false, error: 'invalid creator handle' }, 400);
    stmt = env.DB.prepare(`
      SELECT id, character_name, played_by_handle, server, faction, description, status, created_at
        FROM characters
       WHERE played_by_handle = ? AND approved = 1
       ORDER BY status = 'active' DESC, created_at DESC
       LIMIT ?
    `).bind(creator, HARD_LIMIT);
  } else if (search) {
    const q = '%' + search.replace(/[%_]/g, '').slice(0, 80) + '%';
    stmt = env.DB.prepare(`
      SELECT id, character_name, played_by_handle, server, faction, description, status, created_at
        FROM characters
       WHERE approved = 1
         AND (character_name LIKE ? OR played_by_handle LIKE ? OR faction LIKE ?)
       ORDER BY created_at DESC
       LIMIT ?
    `).bind(q, q, q, HARD_LIMIT);
  } else {
    stmt = env.DB.prepare(`
      SELECT id, character_name, played_by_handle, server, faction, description, status, created_at
        FROM characters
       WHERE approved = 1
       ORDER BY created_at DESC
       LIMIT ?
    `).bind(HARD_LIMIT);
  }

  try {
    const res = await stmt.all();
    const characters = (res.results || []).map(r => ({
      id: r.id,
      character_name: r.character_name,
      played_by_handle: r.played_by_handle,
      server: r.server || null,
      faction: r.faction || null,
      description: r.description || null,
      status: r.status,
      created_at: Number(r.created_at || 0),
    }));

    const response = new Response(JSON.stringify({ ok: true, count: characters.length, characters }), {
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

// ================================================================
// functions/api/gta6-pulse.js
// GET  /api/gta6-pulse?user_id={uuid}   → vote tallies + your_vote
// POST /api/gta6-pulse  { user_id, choice }   → upsert (allows changing your mind)
//
// Anonymous poll. user_id is a client-generated UUID stored in
// localStorage; mirrors the watch_streaks privacy model.
// ================================================================

import { jsonResponse } from '../_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CHOICES = new Set(['ready', 'optimistic', 'worried', 'not-thinking']);
const TALLY_CACHE_URL = 'https://contentlore.com/cache/gta6-pulse-tallies';
const TALLY_TTL = 300;

function tallyCacheKey() { return new Request(TALLY_CACHE_URL); }

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const userId = String(url.searchParams.get('user_id') || '').toLowerCase();

  // Tallies are cached at the edge (Cache API) so we don't hit D1 for every
  // page render. The cache stores only the tallies — `your_vote` is per-user
  // and read fresh from D1 each call.
  const cache = caches.default;
  const cKey = tallyCacheKey();
  let tallies = null;
  const hit = await cache.match(cKey);
  if (hit) {
    try { tallies = await hit.json(); } catch { tallies = null; }
  }

  if (!tallies) {
    tallies = await computeTallies(env);
    const tallyResponse = new Response(JSON.stringify(tallies), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, s-maxage=${TALLY_TTL}`,
      },
    });
    waitUntil(cache.put(cKey, tallyResponse));
  }

  let yourVote = null;
  if (UUID_RE.test(userId)) {
    try {
      const row = await env.DB.prepare('SELECT choice, voted_at FROM gta6_pulse_votes WHERE user_id = ?')
        .bind(userId).first();
      if (row) yourVote = { choice: row.choice, voted_at: row.voted_at };
    } catch { /* ignore */ }
  }

  return jsonResponse({ ok: true, ...tallies, your_vote: yourVote });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const userId = String(body?.user_id || '').toLowerCase();
  const choice = String(body?.choice || '');

  if (!UUID_RE.test(userId)) {
    return jsonResponse({ ok: false, error: 'invalid_user_id' }, 400);
  }
  if (!VALID_CHOICES.has(choice)) {
    return jsonResponse({ ok: false, error: 'invalid_choice' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO gta6_pulse_votes (user_id, choice, voted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        choice   = excluded.choice,
        voted_at = excluded.voted_at
    `).bind(userId, choice, now).run();
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }

  // Bust the tally cache so the next GET reflects this vote within seconds.
  // Cache API delete is per-data-center; with low traffic the next read will
  // recompute either way, and stale tallies max out at TALLY_TTL.
  try { await caches.default.delete(tallyCacheKey()); } catch { /* ignore */ }

  const tallies = await computeTallies(env);
  return jsonResponse({
    ok: true,
    your_vote: { choice, voted_at: now },
    ...tallies,
  });
}

async function computeTallies(env) {
  const res = await env.DB.prepare(
    'SELECT choice, COUNT(*) AS n FROM gta6_pulse_votes GROUP BY choice'
  ).all();

  const counts = { ready: 0, optimistic: 0, worried: 0, 'not-thinking': 0 };
  let total = 0;
  for (const r of (res.results || [])) {
    if (counts[r.choice] !== undefined) {
      counts[r.choice] = r.n;
      total += r.n;
    }
  }

  return { counts, total };
}

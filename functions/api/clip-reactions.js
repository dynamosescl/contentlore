// ================================================================
// functions/api/clip-reactions.js
// GET /api/clip-reactions?ids=clipA,clipB,clipC
//
// Batch fetch of reaction counts for a set of clip IDs. Caps at 200
// IDs per request (the clip wall renders ~100 max). Returns:
//   { ok: true, reactions: { clipA: { '🔥': 12, '😂': 3 }, ... } }
//
// Cached for 60s at the edge — short window keeps counts feeling
// near-real-time without hammering D1 on every page load.
// ================================================================

import { jsonResponse } from '../_lib.js';

const MAX_IDS = 200;
const CACHE_TTL = 60;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get('ids') || '';
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_IDS);

  if (ids.length === 0) {
    return jsonResponse({ ok: true, reactions: {} });
  }

  // Cache key derived from a stable sort of the IDs.
  const sortedIds = [...ids].sort();
  const cacheKeyStr = `reactions:${sortedIds.join(',')}`;
  // Use a short hash so we don't blow up the cache key URL length.
  const hashBuf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(cacheKeyStr));
  const hashHex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);

  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/clip-reactions/${hashHex}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const placeholders = ids.map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT clip_id, emoji, count
         FROM clip_reactions
        WHERE clip_id IN (${placeholders})
          AND count > 0`
    ).bind(...ids).all();

    const reactions = {};
    for (const row of (res.results || [])) {
      if (!reactions[row.clip_id]) reactions[row.clip_id] = {};
      reactions[row.clip_id][row.emoji] = row.count;
    }

    const response = new Response(JSON.stringify({ ok: true, reactions }), {
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

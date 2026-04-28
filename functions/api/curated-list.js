// ================================================================
// functions/api/curated-list.js
// GET /api/curated-list
//
// Public read of the curated 26 from D1 with the standard 5-min
// Cache API hit. Used by anything outside the Functions runtime that
// needs the canonical list (HTML pages with no D1 binding, future
// integrations).
//
// Within Functions, prefer the helper directly:
//   import { getCuratedList } from '../_curated.js';
// — it has the same data plus per-isolate memoisation.
// ================================================================

import { getCuratedList } from '../_curated.js';
import { jsonResponse } from '../_lib.js';

const CACHE_TTL = 300;

export async function onRequestGet({ env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/curated-list/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const list = await getCuratedList(env);
    const payload = {
      ok: true,
      count: list.length,
      creators: list,
      fetched_at: new Date().toISOString(),
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
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

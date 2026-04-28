// ================================================================
// functions/api/network.js
// GET /api/network
//
// Returns nodes + edges for the creator interaction graph.
//   nodes: creator id, display name, handle, platform, weight (avg
//          viewers from snapshots over the last 30d), avatar
//   edges: from creator_edges, type-coded (raid|host|shoutout|...)
//
// The page at /gta-rp/network/ runs the force-directed simulation
// in the browser. 5-min Cache API hit since edges accumulate slowly.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

const CACHE_TTL = 300;

export async function onRequestGet({ env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/network/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const ALLOWED_HANDLES = await getHandlesSet(env);

  try {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 86400;

    // Pull creators + primary platform handles, plus 30d avg viewers
    // (used as node weight for sizing). Filter to curated-26 in JS.
    const nodesRes = await env.DB.prepare(`
      SELECT c.id, c.display_name, c.avatar_url,
             cp.handle, cp.platform,
             AVG(CASE WHEN s.is_live = 1 AND s.captured_at >= ? THEN s.viewers END) AS avg_viewers,
             MAX(CASE WHEN s.is_live = 1 AND s.captured_at >= ? THEN s.viewers END) AS peak_viewers,
             SUM(CASE WHEN s.is_live = 1 AND s.captured_at >= ? THEN 1 ELSE 0 END) AS live_samples
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      LEFT JOIN snapshots s ON s.creator_id = c.id
      GROUP BY c.id
    `).bind(thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo).all();

    const allNodes = (nodesRes.results || []).filter(n =>
      ALLOWED_HANDLES.has(String(n.handle).toLowerCase())
    );
    const nodeIds = new Set(allNodes.map(n => n.id));

    const nodes = allNodes.map(n => ({
      id: n.id,
      handle: String(n.handle).toLowerCase(),
      display_name: n.display_name,
      platform: n.platform,
      avatar_url: n.avatar_url,
      avg_viewers: Math.round(Number(n.avg_viewers || 0)),
      peak_viewers: Number(n.peak_viewers || 0),
      live_samples: Number(n.live_samples || 0),
    }));

    // Edges — only the ones connecting two curated creators.
    const edgeRes = await env.DB.prepare(`
      SELECT from_creator_id, to_creator_id, edge_type, weight,
             first_seen_at, last_seen_at
      FROM creator_edges
      ORDER BY last_seen_at DESC
    `).all();

    const edges = (edgeRes.results || [])
      .filter(e => nodeIds.has(e.from_creator_id) && nodeIds.has(e.to_creator_id))
      .map(e => ({
        from: e.from_creator_id,
        to: e.to_creator_id,
        type: e.edge_type,
        weight: Number(e.weight || 1),
        first_seen_at: e.first_seen_at,
        last_seen_at: e.last_seen_at,
      }));

    const payload = {
      ok: true,
      node_count: nodes.length,
      edge_count: edges.length,
      nodes,
      edges,
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

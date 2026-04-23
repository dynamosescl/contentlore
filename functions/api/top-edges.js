// ================================================================
// functions/api/top-edges.js
// GET /api/top-edges
// Returns the strongest recent connections in the creator graph —
// who raided whom, who hosted whom. Powers the homepage social-graph
// strip in Scene Pulse.
//
// Query params:
//   window=7|30     days to look back, default 7
//   type=raid|host|shoutout|all   default all
//   limit=10        max rows, cap 50
// ================================================================

import { jsonResponse, parseBoundedInt } from '../_lib.js';

const ALLOWED_EDGE_TYPES = new Set(['all', 'raid', 'host', 'shoutout', 'mention', 'co_stream']);

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const window = parseBoundedInt(url.searchParams.get('window'), 7, 1, 90);
  const type = url.searchParams.get('type') || 'all';
  const limit = parseBoundedInt(url.searchParams.get('limit'), 10, 1, 50);
  if (!ALLOWED_EDGE_TYPES.has(type)) {
    return jsonResponse({ ok: false, error: 'invalid type' }, 400);
  }

  try {
    const cutoff = Math.floor(Date.now() / 1000) - (window * 86400);
    const params = [cutoff];
    let typeFilter = '';
    if (type !== 'all') {
      typeFilter = ' AND e.edge_type = ?';
      params.push(type);
    }
    params.push(limit);

    const sql = `
      SELECT 
        e.from_creator_id,
        e.to_creator_id,
        e.edge_type,
        e.weight,
        e.last_seen_at,
        cf.display_name AS from_name,
        ct.display_name AS to_name,
        cpf.platform    AS from_platform,
        cpf.handle      AS from_handle,
        cpt.platform    AS to_platform,
        cpt.handle      AS to_handle
      FROM creator_edges e
      LEFT JOIN creators cf           ON cf.id = e.from_creator_id
      LEFT JOIN creators ct           ON ct.id = e.to_creator_id
      LEFT JOIN creator_platforms cpf ON cpf.creator_id = e.from_creator_id AND cpf.is_primary = 1
      LEFT JOIN creator_platforms cpt ON cpt.creator_id = e.to_creator_id   AND cpt.is_primary = 1
      WHERE e.last_seen_at > ?${typeFilter}
      ORDER BY e.weight DESC, e.last_seen_at DESC
      LIMIT ?
    `;

    const result = await env.DB.prepare(sql).bind(...params).all();
    const edges = (result.results || []).map((r) => ({
      from: {
        id: r.from_creator_id,
        display_name: r.from_name || r.from_creator_id,
        platform: r.from_platform,
        handle: r.from_handle,
        url: `/creator/${r.from_creator_id}`,
      },
      to: {
        id: r.to_creator_id,
        display_name: r.to_name || r.to_creator_id,
        platform: r.to_platform,
        handle: r.to_handle,
        url: `/creator/${r.to_creator_id}`,
      },
      edge_type: r.edge_type,
      weight: r.weight,
      last_seen_at: r.last_seen_at,
    }));

    return jsonResponse({
      ok: true,
      window_days: window,
      type,
      count: edges.length,
      edges,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/network/[id].js
// GET /api/network/:id
// Returns creator connection context for profile sidebars.
// ================================================================

import { jsonResponse, parseBoundedInt } from '../../_lib.js';

export async function onRequestGet({ env, params, request }) {
  const creatorId = params?.id;
  if (!creatorId) {
    return jsonResponse({ ok: false, error: 'missing creator id' }, 400);
  }

  const url = new URL(request.url);
  const windowDays = parseBoundedInt(url.searchParams.get('window'), 30, 1, 90);
  const cutoff = Math.floor(Date.now() / 1000) - (windowDays * 86400);

  try {
    const [inRes, outRes, statsRes] = await Promise.all([
      env.DB.prepare(`
        SELECT
          e.from_creator_id AS creator_id,
          e.edge_type,
          e.weight,
          e.last_seen_at,
          c.display_name,
          cp.platform,
          cp.handle
        FROM creator_edges e
        LEFT JOIN creators c ON c.id = e.from_creator_id
        LEFT JOIN creator_platforms cp ON cp.creator_id = e.from_creator_id AND cp.is_primary = 1
        WHERE e.to_creator_id = ?
          AND e.last_seen_at > ?
        ORDER BY e.last_seen_at DESC, e.weight DESC
        LIMIT 30
      `).bind(creatorId, cutoff).all(),
      env.DB.prepare(`
        SELECT
          e.to_creator_id AS creator_id,
          e.edge_type,
          e.weight,
          e.last_seen_at,
          c.display_name,
          cp.platform,
          cp.handle
        FROM creator_edges e
        LEFT JOIN creators c ON c.id = e.to_creator_id
        LEFT JOIN creator_platforms cp ON cp.creator_id = e.to_creator_id AND cp.is_primary = 1
        WHERE e.from_creator_id = ?
          AND e.last_seen_at > ?
        ORDER BY e.last_seen_at DESC, e.weight DESC
        LIMIT 30
      `).bind(creatorId, cutoff).all(),
      env.DB.prepare(`
        SELECT
          SUM(CASE WHEN e.to_creator_id = ? THEN 1 ELSE 0 END) AS inbound_30d,
          SUM(CASE WHEN e.from_creator_id = ? THEN 1 ELSE 0 END) AS outbound_30d
        FROM creator_edges e
        WHERE e.last_seen_at > ?
          AND (e.to_creator_id = ? OR e.from_creator_id = ?)
      `).bind(creatorId, creatorId, cutoff, creatorId, creatorId).first(),
    ]);

    const inbound = (inRes.results || []).map(mapEdge);
    const outbound = (outRes.results || []).map(mapEdge);
    const stats = {
      inbound_30d: Number(statsRes?.inbound_30d || 0),
      outbound_30d: Number(statsRes?.outbound_30d || 0),
      window_days: windowDays,
    };

    return jsonResponse({ ok: true, creator_id: creatorId, stats, inbound, outbound });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function mapEdge(r) {
  return {
    creator_id: r.creator_id,
    display_name: r.display_name || r.creator_id,
    profile_url: `/creator/${r.creator_id}`,
    edge_type: r.edge_type,
    weight: Number(r.weight || 1),
    platform: r.platform || '',
    handle: r.handle || '',
    last_seen_at: Number(r.last_seen_at || 0),
  };
}

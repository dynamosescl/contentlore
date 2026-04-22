import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env }) {
  try {
    const now = Math.floor(Date.now() / 1000);

    // LIVE STREAMS (snapshot-based, no sessions dependency)
    const liveRes = await env.DB.prepare(`
      SELECT
        c.id,
        c.display_name,
        c.avatar_url,
        cp.handle,
        s.platform,
        s.viewers AS peak_viewers,
        s.started_at,
        s.stream_category AS primary_category
      FROM snapshots s
      JOIN creators c ON c.id = s.creator_id
      LEFT JOIN creator_platforms cp
        ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE s.is_live = 1
        AND s.id IN (
          SELECT MAX(id)
          FROM snapshots
          WHERE is_live = 1
          GROUP BY creator_id
        )
      ORDER BY s.viewers DESC
    `).all();

    const live = liveRes.results || [];
    if (!live.length) {
      return jsonResponse({ ok: true, moments: [], count: 0 });
    }

    // MOMENTUM (7-day follower growth)
    const momentumRes = await env.DB.prepare(`
      SELECT creator_id, SUM(delta) AS momentum
      FROM (
        SELECT
          s.creator_id,
          (MAX(s.followers) - MIN(s.followers)) AS delta
        FROM snapshots s
        WHERE s.captured_at > ?
        GROUP BY s.creator_id
      )
      GROUP BY creator_id
    `).bind(now - 7 * 86400).all();

    const momentumMap = new Map();
    for (const r of (momentumRes.results || [])) {
      momentumMap.set(r.creator_id, r.momentum || 0);
    }

    // SOCIAL ACTIVITY (edges)
    const edgeRes = await env.DB.prepare(`
      SELECT to_creator_id AS creator_id, SUM(weight) AS edge_score
      FROM creator_edges
      WHERE last_seen_at > ?
      GROUP BY to_creator_id
    `).bind(now - 3600).all();

    const edgeMap = new Map();
    for (const r of (edgeRes.results || [])) {
      edgeMap.set(r.creator_id, r.edge_score || 0);
    }

    // ENRICH STREAMS
    const enriched = live.map(c => {
      const viewers = c.peak_viewers || 0;
      const momentum = momentumMap.get(c.id) || 0;
      const edge = edgeMap.get(c.id) || 0;

      const score =
        Math.log(viewers + 1) * 10 +
        momentum * 0.001 +
        edge * 5;

      return {
        id: c.id,
        display_name: c.display_name,
        avatar_url: c.avatar_url,
        handle: c.handle,
        platform: c.platform,
        viewers,
        game: c.primary_category || 'other',
        uptime_mins: c.started_at
          ? Math.round((now - c.started_at) / 60)
          : 0,
        momentum,
        edge,
        score
      };
    });

    // GROUP BY GAME
    const groups = new Map();
    for (const c of enriched) {
      const key = c.game || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    // BUILD MOMENTS
    const moments = [];
    for (const [game, creators] of groups.entries()) {
      creators.sort((a, b) => b.score - a.score);

      const totalViewers = creators.reduce((s, c) => s + c.viewers, 0);
      const totalMomentum = creators.reduce((s, c) => s + c.momentum, 0);
      const totalEdge = creators.reduce((s, c) => s + c.edge, 0);

      const importance =
        totalViewers +
        totalMomentum * 0.01 +
        totalEdge * 10;

      moments.push({
        id: game,
        title: game,
        dominant: creators[0],
        creators,
        total_viewers: totalViewers,
        momentum_score: totalMomentum,
        edge_activity: totalEdge,
        importance
      });
    }

    moments.sort((a, b) => b.importance - a.importance);

    return jsonResponse({
      ok: true,
      count: moments.length,
      moments
    });

  } catch (err) {
    return jsonResponse(
      { ok: false, error: String(err?.message || err) },
      500
    );
  }
}
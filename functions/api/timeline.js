// ================================================================
// functions/api/timeline.js
// GET /api/timeline?range=today|yesterday|7d
//
// Returns every stream_sessions row that overlaps the requested
// window for any of the curated 26 handles. Each row is enriched
// with detected server id (keyword-match over final_title) and
// resolved end timestamp (now() for ongoing sessions). The page
// at /gta-rp/timeline/ does the rendering.
//
// The window is computed in UTC. The page renders bars in the
// viewer's local timezone — start/end timestamps are unix epoch
// so the conversion is the browser's job.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

const RANGES = {
  today: () => {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  },
  yesterday: () => {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 1);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  },
  '7d': () => {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  },
};

const SERVERS = [
  { id: 'unique',      keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'chase',       keywords: ['chase rp', 'chaserp'] },
  { id: 'verarp',      keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        keywords: ['the ends', 'theends', 'ends rp', 'theendsrp', 'the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', keywords: ['british life', 'britishlife'] },
  { id: '9kings',      keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
];
const SERVERS_SORTED = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);

function detectServer(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.id;
  return null;
}

const CACHE_TTL = 300;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const rangeKey = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : 'today';
  const window = RANGES[rangeKey]();

  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/timeline/${rangeKey}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    // Sessions whose [started_at, ended_at) interval overlaps [windowStart, windowEnd).
    const res = await env.DB.prepare(`
      SELECT cp.handle, c.display_name,
             ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.duration_mins, ss.peak_viewers
      FROM stream_sessions ss
      INNER JOIN creators c ON c.id = ss.creator_id
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE ss.started_at < ? AND ss.ended_at > ?
      ORDER BY ss.started_at ASC
    `).bind(window.end, window.start).all();

    const allowed = await getHandlesSet(env);
    const now = Math.floor(Date.now() / 1000);
    const sessions = (res.results || [])
      .filter(r => allowed.has(String(r.handle).toLowerCase()))
      .map(r => ({
        handle: String(r.handle).toLowerCase(),
        display_name: r.display_name,
        started_at: r.started_at,
        ended_at: r.is_ongoing ? now : r.ended_at,
        is_ongoing: !!r.is_ongoing,
        title: r.final_title || '',
        server_id: detectServer(r.final_title),
        peak_viewers: r.peak_viewers || 0,
      }));

    const payload = {
      ok: true,
      range: rangeKey,
      window,
      count: sessions.length,
      fetched_at: new Date().toISOString(),
      sessions,
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

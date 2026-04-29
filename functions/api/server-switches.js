// ================================================================
// functions/api/server-switches.js
// GET /api/server-switches
//
// Detects when a curated creator's most-played server flipped between
// last week and this week. Surface for the "Cross-Server Drama"
// section on /gta-rp/health/.
//
// Algorithm:
//   1. Pull two weeks of sessions for the curated allowlist.
//   2. For each creator, bucket session minutes by detected server.
//   3. Find this-week-leader and last-week-leader.
//   4. Emit a switch when the two differ AND both weeks have at least
//      MIN_MINS minutes (so quick-visit churn doesn't spam the feed).
//
// 5-min Cache API hit at /cache/server-switches/v1.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const CACHE_TTL = 300;
const MIN_MINS_PER_WEEK = 60; // 1h on each side — anything less is noise

const SERVERS = [
  { id: 'unique',      name: 'Unique RP',      keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         name: 'TNG RP',         keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       name: 'Orbit RP',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     name: 'New Era RP',     keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     name: 'Prodigy RP',     keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         name: 'D10 RP',         keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   name: 'Unmatched RP',   keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'chase',       name: 'Chase RP',       keywords: ['chase rp', 'chaserp'] },
  { id: 'verarp',      name: 'VeraRP',         keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        name: 'The Ends RP',    keywords: ['the ends', 'theends', 'ends rp', 'theendsrp', 'the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      name: "Let's RP",       keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     name: 'Drill UK',       keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life',   keywords: ['british life', 'britishlife'] },
  { id: '9kings',      name: '9 Kings RP',     keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
];
const SERVERS_SORTED = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);
const SERVERS_BY_ID = Object.fromEntries(SERVERS.map(s => [s.id, s]));
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.id;
  return null;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/server-switches/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const curated = await getCuratedList(env);
    const ALLOWED = new Map(curated.map(c => [c.handle, c]));

    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const twoWeeksAgo = now - 14 * 86400;

    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, c.display_name, c.avatar_url,
             ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.duration_mins
        FROM stream_sessions ss
        INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
        LEFT JOIN creators c ON c.id = ss.creator_id
       WHERE ss.started_at >= ?
    `).bind(twoWeeksAgo).all();

    // Per-creator, per-week server-mins buckets.
    // perCreator[handle] = { thisWeek: Map<serverId, mins>, lastWeek: Map<...>, displayName, avatar, lastSeenAt }
    const perCreator = new Map();

    for (const r of (sessRes.results || [])) {
      const handle = String(r.handle).toLowerCase();
      if (!ALLOWED.has(handle)) continue;
      const sid = detectServer(r.final_title);
      if (!sid) continue;
      const start = Number(r.started_at);
      const mins = Number(r.duration_mins || 0);
      if (mins <= 0) continue;

      let bucket = perCreator.get(handle);
      if (!bucket) {
        bucket = {
          handle,
          displayName: r.display_name || ALLOWED.get(handle)?.display_name || handle,
          avatar: r.avatar_url || null,
          thisWeek: new Map(),
          lastWeek: new Map(),
          lastSeenAt: 0,
        };
        perCreator.set(handle, bucket);
      }

      const target = (start >= weekAgo) ? bucket.thisWeek : bucket.lastWeek;
      target.set(sid, (target.get(sid) || 0) + mins);
      const sessEnd = r.is_ongoing ? now : Number(r.ended_at || start);
      if (sessEnd > bucket.lastSeenAt) bucket.lastSeenAt = sessEnd;
    }

    // Compute leader for each week and emit switches.
    const switches = [];
    for (const b of perCreator.values()) {
      const thisLeader = leader(b.thisWeek);
      const lastLeader = leader(b.lastWeek);
      if (!thisLeader || !lastLeader) continue;
      if (thisLeader.serverId === lastLeader.serverId) continue;
      if (thisLeader.mins < MIN_MINS_PER_WEEK || lastLeader.mins < MIN_MINS_PER_WEEK) continue;

      switches.push({
        handle: b.handle,
        display_name: b.displayName,
        avatar_url: b.avatar,
        from: {
          id: lastLeader.serverId,
          name: SERVERS_BY_ID[lastLeader.serverId]?.name || lastLeader.serverId,
          mins: lastLeader.mins,
        },
        to: {
          id: thisLeader.serverId,
          name: SERVERS_BY_ID[thisLeader.serverId]?.name || thisLeader.serverId,
          mins: thisLeader.mins,
        },
        last_seen_at: b.lastSeenAt,
      });
    }

    // Sort by intensity — more this-week mins on the new server first.
    switches.sort((a, b) => b.to.mins - a.to.mins);

    const payload = {
      ok: true,
      window: { start: twoWeeksAgo, end: now },
      count: switches.length,
      switches,
      generated_at: new Date().toISOString(),
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

function leader(serverMins) {
  let bestId = null;
  let bestMins = 0;
  for (const [sid, mins] of serverMins) {
    if (mins > bestMins) { bestMins = mins; bestId = sid; }
  }
  return bestId ? { serverId: bestId, mins: bestMins } : null;
}

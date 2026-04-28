// ================================================================
// functions/api/scene-health.js
// GET /api/scene-health
//
// "State of the nation" snapshot for the UK GTA RP scene. Computes:
//   - viewer-hours this week vs last week (% change)
//   - active creators this week vs last week
//   - new creators discovered (last 7d, pending_creators)
//   - server activity distribution by viewer-hours
//   - average peak hour-of-day this week (UTC)
//   - scene trend label (Growing / Stable / Declining)
//
// 5-min Cache API hit. All numbers come from D1 — same source-of-
// truth as analytics/digest, just framed as week-over-week deltas.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

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
];
const SERVERS_SORTED = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.id;
  return null;
}

const CACHE_TTL = 300;

function pctDelta(now, then) {
  if (!then) return null;
  return Math.round(((now - then) / then) * 100);
}

function trendFor(viewerHoursDelta) {
  if (viewerHoursDelta == null) return { id: 'building', label: 'Building data', emoji: '📡', tint: 'oklch(0.55 0.06 190)' };
  if (viewerHoursDelta >= 10)  return { id: 'growing',   label: 'Scene growing', emoji: '📈', tint: 'oklch(0.82 0.22 145)' };
  if (viewerHoursDelta <= -10) return { id: 'declining', label: 'Scene cooling', emoji: '📉', tint: 'oklch(0.68 0.27 25)' };
  return                          { id: 'stable',    label: 'Scene stable',  emoji: '⚖️', tint: 'oklch(0.82 0.20 195)' };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/scene-health/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const ALLOWED_HANDLES = await getHandlesSet(env);
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;
    const fourteenDaysAgo = now - 14 * 86400;

    // Pull two weeks of sessions in one query, bucketise client-side.
    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.duration_mins, ss.peak_viewers
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE ss.started_at >= ?
    `).bind(fourteenDaysAgo).all();

    const sessions = (sessRes.results || []).filter(r =>
      ALLOWED_HANDLES.has(String(r.handle).toLowerCase())
    );

    let thisWeek = { mins: 0, viewerHours: 0, sessions: 0, creators: new Set(), serverHours: new Map() };
    let lastWeek = { mins: 0, viewerHours: 0, sessions: 0, creators: new Set() };

    // Hour-of-day distribution (UTC) for "average peak hour" on this week's sessions.
    const hourBuckets = Array(24).fill(0);

    for (const r of sessions) {
      const handle = String(r.handle).toLowerCase();
      const startedAt = Number(r.started_at);
      const end = r.is_ongoing ? now : Number(r.ended_at || r.started_at);
      const mins = Math.max(0, Math.round((end - startedAt) / 60));
      const peak = Number(r.peak_viewers || 0);
      const viewerHours = (mins / 60) * peak;

      if (startedAt >= sevenDaysAgo) {
        thisWeek.mins += mins;
        thisWeek.viewerHours += viewerHours;
        thisWeek.sessions += 1;
        thisWeek.creators.add(handle);

        const sid = detectServer(r.final_title);
        if (sid) {
          const cur = thisWeek.serverHours.get(sid) || 0;
          thisWeek.serverHours.set(sid, cur + viewerHours);
        }

        // Distribute viewer-hours across the hours the session spanned.
        // Use the start hour as a coarse proxy — accurate enough for
        // "what hour does this scene peak at" without the cost of
        // splitting each session per-hour.
        const startHour = new Date(startedAt * 1000).getUTCHours();
        hourBuckets[startHour] += peak;
      } else {
        lastWeek.mins += mins;
        lastWeek.viewerHours += viewerHours;
        lastWeek.sessions += 1;
        lastWeek.creators.add(handle);
      }
    }

    // Find the most active hour-of-day for this week.
    let peakHour = null, peakHourValue = 0;
    for (let h = 0; h < 24; h++) {
      if (hourBuckets[h] > peakHourValue) {
        peakHourValue = hourBuckets[h];
        peakHour = h;
      }
    }

    // New creators discovered in last 7d.
    const newRes = await env.DB.prepare(`
      SELECT name, platform, status, first_seen
      FROM pending_creators
      WHERE first_seen >= datetime(?, 'unixepoch')
      ORDER BY first_seen DESC
      LIMIT 50
    `).bind(sevenDaysAgo).all();
    const newCreators = newRes.results || [];

    // Server distribution — viewer-hours, sorted desc.
    const serverDistribution = SERVERS.map(s => ({
      id: s.id,
      name: s.name,
      viewer_hours: Math.round(thisWeek.serverHours.get(s.id) || 0),
    })).filter(s => s.viewer_hours > 0).sort((a, b) => b.viewer_hours - a.viewer_hours);

    const totalServerVh = serverDistribution.reduce((s, x) => s + x.viewer_hours, 0);
    for (const s of serverDistribution) {
      s.share_pct = totalServerVh ? Math.round((s.viewer_hours / totalServerVh) * 100) : 0;
    }

    const viewerHoursDelta = pctDelta(thisWeek.viewerHours, lastWeek.viewerHours);
    const trend = trendFor(viewerHoursDelta);

    const payload = {
      ok: true,
      window: { this_week_start: sevenDaysAgo, last_week_start: fourteenDaysAgo, end: now },
      this_week: {
        viewer_hours: Math.round(thisWeek.viewerHours),
        active_creators: thisWeek.creators.size,
        sessions: thisWeek.sessions,
        total_hours: Math.round(thisWeek.mins / 60),
      },
      last_week: {
        viewer_hours: Math.round(lastWeek.viewerHours),
        active_creators: lastWeek.creators.size,
        sessions: lastWeek.sessions,
        total_hours: Math.round(lastWeek.mins / 60),
      },
      delta: {
        viewer_hours_pct: viewerHoursDelta,
        active_creators_pct: pctDelta(thisWeek.creators.size, lastWeek.creators.size),
        sessions_pct: pctDelta(thisWeek.sessions, lastWeek.sessions),
        hours_pct: pctDelta(thisWeek.mins, lastWeek.mins),
      },
      trend,
      peak_hour_utc: peakHour,
      new_creators: newCreators,
      server_distribution: serverDistribution,
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

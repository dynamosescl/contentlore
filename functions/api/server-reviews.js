// ================================================================
// functions/api/server-reviews.js
// GET /api/server-reviews
//
// Weekly auto-graded report card for every tracked RP server.
// Computes per server (from stream_sessions + scene_snapshots):
//   - hours streamed this week (last 7d)
//   - unique streamers who played there
//   - viewer-hours
//   - week-over-week growth in viewer-hours
//   - top 3 streamers by hours
// Assigns a letter grade A/B/C/D/F based on activity, and asks
// Claude for a one-sentence summary per server (single batched
// call). Falls back to a deterministic sentence if Anthropic is
// unreachable.
//
// 1h Cache API hit. The grades change at most once per day.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const MODEL = 'claude-sonnet-4-6';
const CACHE_TTL = 3600;

// Mirror of the SERVERS list in /api/digest.js — keep in sync.
const SERVERS = [
  { id: 'unique',      name: 'Unique RP',      origin: 'UK',       keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         name: 'TNG RP',         origin: 'UK',       keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       name: 'Orbit RP',       origin: 'UK',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     name: 'New Era RP',     origin: 'American', keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     name: 'Prodigy RP',     origin: 'American', keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         name: 'D10 RP',         origin: 'American', keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   name: 'Unmatched RP',   origin: 'UK',       keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'chase',       name: 'Chase RP',       origin: 'American', keywords: ['chase rp', 'chaserp'] },
  { id: 'verarp',      name: 'VeraRP',         origin: 'UK',       keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        name: 'The Ends RP',    origin: 'UK',       keywords: ['the ends', 'theends', 'ends rp', 'theendsrp', 'the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      name: "Let's RP",       origin: 'UK',       keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     name: 'Drill UK',       origin: 'UK',       keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life',   origin: 'UK',       keywords: ['british life', 'britishlife'] },
  { id: '9kings',      name: '9 Kings RP',     origin: 'Unknown',  keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
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

// Letter grade based on combined activity. Grade thresholds tuned
// to the UK GTA RP scale — most weeks have 2-3 dominant servers and
// a long tail of quiet ones.
function gradeFor({ hours, streamers, viewer_hours }) {
  if (hours === 0 && streamers === 0) return 'F';
  // Weighted score: viewer-hours dominate (audience signal), hours
  // and streamer count amplify.
  const score = viewer_hours + (hours * 8) + (streamers * 25);
  if (score >= 1500) return 'A';
  if (score >= 600)  return 'B';
  if (score >= 200)  return 'C';
  if (score >= 30)   return 'D';
  return 'F';
}

const GRADE_LABEL = {
  A: 'Thriving',
  B: 'Healthy',
  C: 'Steady',
  D: 'Quiet',
  F: 'Inactive',
};

function aggregateWindow(sessionRows, windowStart, windowEnd) {
  const byServer = new Map();
  for (const s of SERVERS) byServer.set(s.id, {
    id: s.id, name: s.name, origin: s.origin,
    hours: 0, mins: 0, streamers: new Set(), viewer_hours: 0,
    streamer_hours: new Map(), // handle -> mins for top-3
  });
  for (const r of sessionRows) {
    const sStart = Math.max(r.started_at, windowStart);
    const sEndRaw = r.is_ongoing ? Math.floor(Date.now() / 1000) : (r.ended_at || r.started_at);
    const sEnd = Math.min(sEndRaw, windowEnd);
    if (sEnd <= sStart) continue;
    const mins = Math.max(0, Math.round((sEnd - sStart) / 60));
    if (mins === 0) continue;
    const sid = detectServer(r.final_title);
    if (!sid) continue;
    const agg = byServer.get(sid);
    if (!agg) continue;
    const handle = String(r.handle).toLowerCase();
    agg.mins += mins;
    agg.viewer_hours += (mins / 60) * Number(r.peak_viewers || 0);
    agg.streamers.add(handle);
    agg.streamer_hours.set(handle, (agg.streamer_hours.get(handle) || 0) + mins);
  }
  for (const agg of byServer.values()) agg.hours = Math.round(agg.mins / 60 * 10) / 10;
  return byServer;
}

async function summariseWithClaude(env, rows) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const lines = rows.map(r =>
    `${r.id}: "${r.name}" (${r.origin}) — grade ${r.grade}, ${r.hours}h streamed by ${r.streamers} streamer${r.streamers === 1 ? '' : 's'}, ${r.viewer_hours} viewer-hours, ${r.growth_pct == null ? 'no comparison' : (r.growth_pct >= 0 ? '+' : '') + r.growth_pct + '% vs last week'}, top streamer: ${r.top_streamers[0]?.handle || '—'}`
  ).join('\n');

  const userPrompt = `Here are this week's UK GTA RP server stats. For each server, write one short sentence (max 22 words) summarising the week. Be specific about who's driving the activity or why a server is quiet. UK English.

${lines}

Reply with strict JSON only — an object mapping server id to its sentence:
{"unique": "...", "tng": "...", ...}
Include every id from the input. No prefix, no code fence, no commentary.`;

  const body = {
    model: MODEL,
    max_tokens: 1200,
    system: [{
      type: 'text',
      text: 'You write weekly server review one-liners for ContentLore, a UK GTA RP streaming site. Each sentence should be punchy, specific, and useful — a viewer should learn something they didn\'t see in the stats. Don\'t restate the grade. Don\'t hedge. UK English. Output ONLY the JSON object — no prefix, no code fence, no commentary.',
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: userPrompt }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Anthropic ' + res.status);
  const j = await res.json();
  const raw = j?.content?.[0]?.text?.trim() || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('non-JSON');
  return { map: JSON.parse(m[0]), model: j?.model || MODEL };
}

function fallbackSummary(r) {
  if (r.grade === 'F') return `Quiet week — no tracked streamers detected on ${r.name}.`;
  const top = r.top_streamers[0];
  const topNote = top ? ` ${top.display_name} led with ${top.hours}h.` : '';
  const trend = r.growth_pct == null ? '' :
    r.growth_pct >= 25 ? ' Up sharply on last week.' :
    r.growth_pct >= 0  ? ' Roughly steady week-on-week.' :
    r.growth_pct >= -25 ? ' Slightly cooler than last week.' :
                         ' Down notably on last week.';
  return `${r.streamers} streamer${r.streamers === 1 ? '' : 's'} put in ${r.hours} hour${r.hours === 1 ? '' : 's'} on ${r.name} this week.${topNote}${trend}`.trim();
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/server-reviews/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const curated = await getCuratedList(env);
    const ALLOWED = new Set(curated.map(c => c.handle));
    const handleToName = new Map(curated.map(c => [c.handle, c.display_name]));

    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const twoWeeksAgo = now - 14 * 86400;

    const sessRes = await env.DB.prepare(`
      SELECT cp.handle, ss.started_at, ss.ended_at, ss.is_ongoing,
             ss.final_title, ss.peak_viewers
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE (ss.is_ongoing = 1 OR ss.ended_at >= ?)
        AND ss.started_at < ?
    `).bind(twoWeeksAgo, now).all();
    const sessions = (sessRes.results || []).filter(r => ALLOWED.has(String(r.handle).toLowerCase()));

    const thisWeek = aggregateWindow(sessions, weekAgo, now);
    const lastWeek = aggregateWindow(sessions, twoWeeksAgo, weekAgo);

    const reviews = SERVERS.map(s => {
      const t = thisWeek.get(s.id);
      const l = lastWeek.get(s.id);
      const grade = gradeFor({ hours: t.hours, streamers: t.streamers.size, viewer_hours: t.viewer_hours });
      const top_streamers = [...t.streamer_hours.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([h, mins]) => ({
          handle: h,
          display_name: handleToName.get(h) || h,
          hours: Math.round(mins / 60 * 10) / 10,
        }));
      const growthPct = l.viewer_hours > 0
        ? Math.round(((t.viewer_hours - l.viewer_hours) / l.viewer_hours) * 100)
        : (t.viewer_hours > 0 ? null : null);
      return {
        id: s.id,
        name: s.name,
        origin: s.origin,
        grade,
        grade_label: GRADE_LABEL[grade],
        hours: t.hours,
        streamers: t.streamers.size,
        viewer_hours: Math.round(t.viewer_hours),
        last_week_viewer_hours: Math.round(l.viewer_hours),
        growth_pct: growthPct,
        top_streamers,
      };
    });

    // Sort: grade A→F, then viewer_hours desc.
    const gradeOrder = { A: 0, B: 1, C: 2, D: 3, F: 4 };
    reviews.sort((a, b) => (gradeOrder[a.grade] - gradeOrder[b.grade]) || (b.viewer_hours - a.viewer_hours));

    // One Claude call → one sentence per server.
    let source = 'anthropic';
    let model = MODEL;
    let summaries = {};
    try {
      const { map, model: m } = await summariseWithClaude(env, reviews);
      summaries = map;
      model = m;
    } catch (err) {
      source = 'fallback';
      model = 'fallback';
      console.error('[server-reviews] anthropic failed', String(err?.message || err));
    }
    for (const r of reviews) {
      r.summary = (summaries[r.id] && String(summaries[r.id]).trim()) || fallbackSummary(r);
    }

    const payload = {
      ok: true,
      window: { start: weekAgo, end: now, prior_start: twoWeeksAgo, prior_end: weekAgo },
      summary_source: source,
      model,
      count: reviews.length,
      reviews,
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

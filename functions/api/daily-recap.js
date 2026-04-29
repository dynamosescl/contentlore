// ================================================================
// functions/api/daily-recap.js
// GET  /api/daily-recap
// POST /api/daily-recap   (admin-auth, used by the scheduler)
//
// Daily AI-written narrative of one UTC day's UK GTA RP activity.
//
// GET:
//   Returns the most recent stored daily_recaps row. Optionally
//   ?date=YYYY-MM-DD pins to a specific date. ?days=7 returns the
//   last 7 daily recaps (max 30) instead of just one.
//
// POST:
//   Generates a new daily recap for yesterday (UTC) by default, or
//   the given ?date. Pulls that day's sessions + snapshots from D1,
//   hands them to Claude, persists the result. Idempotent — if a row
//   already exists for that date it returns it unless ?force=1.
//   Requires Authorization: Bearer ADMIN_TOKEN.
//
// Falls back to deterministic prose if Anthropic is unreachable so
// the Discord daily summary never posts an empty card.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet, getCuratedList } from '../_curated.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 500;

// ----------------------------------------------------------------
// Date helpers — all UTC.
// ----------------------------------------------------------------
function todayUtcYmd() {
  const d = new Date();
  return ymd(d);
}
function yesterdayUtcYmd() {
  const d = new Date(Date.now() - 86400_000);
  return ymd(d);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function utcDayBounds(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const start = Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
  return { start, end: start + 86400 };
}
function fmtN(n) {
  if (n == null) return 'unknown';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// ----------------------------------------------------------------
// Servers — keyword detection from stream titles. Mirror of the
// SERVERS list in /api/digest.js — kept in sync manually.
// ----------------------------------------------------------------
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
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.id;
  return null;
}
const SERVER_NAME_BY_ID = Object.fromEntries(SERVERS.map(s => [s.id, s.name]));

// ----------------------------------------------------------------
// Compute one day's metrics (UTC bounds).
// ----------------------------------------------------------------
async function computeDayMetrics(env, dayYmd) {
  const ALLOWED = await getHandlesSet(env);
  const { start, end } = utcDayBounds(dayYmd);

  // Sessions whose live time intersects this UTC day.
  const sessRes = await env.DB.prepare(`
    SELECT cp.handle, c.display_name,
           ss.started_at, ss.ended_at, ss.is_ongoing,
           ss.final_title, ss.peak_viewers, ss.avg_viewers
    FROM stream_sessions ss
    INNER JOIN creators c ON c.id = ss.creator_id
    INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
    WHERE (ss.is_ongoing = 1 OR ss.ended_at >= ?)
      AND ss.started_at < ?
  `).bind(start, end).all();
  const sessions = (sessRes.results || []).filter(r => ALLOWED.has(String(r.handle).toLowerCase()));

  let totalMins = 0;
  const liveCreators = new Set();
  const hoursByHandle = new Map();
  const serverHours = new Map(); // sid -> { mins, viewer_hours }
  let peak = null;

  for (const r of sessions) {
    const h = String(r.handle).toLowerCase();
    liveCreators.add(h);
    const sStart = Math.max(r.started_at, start);
    const sEnd = Math.min(r.is_ongoing ? Math.floor(Date.now()/1000) : (r.ended_at || r.started_at), end);
    const mins = Math.max(0, Math.round((sEnd - sStart) / 60));
    totalMins += mins;
    hoursByHandle.set(h, (hoursByHandle.get(h) || 0) + mins);

    const sid = detectServer(r.final_title);
    if (sid) {
      const cur = serverHours.get(sid) || { mins: 0, viewer_hours: 0 };
      cur.mins += mins;
      cur.viewer_hours += (mins / 60) * Number(r.peak_viewers || 0);
      serverHours.set(sid, cur);
    }
  }

  // Peak moment from snapshots within the day.
  const peakRes = await env.DB.prepare(`
    SELECT cp.handle, c.display_name, s.platform, s.viewers, s.captured_at, s.stream_title
    FROM snapshots s
    INNER JOIN creators c ON c.id = s.creator_id
    INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
    WHERE s.captured_at >= ? AND s.captured_at < ?
      AND s.is_live = 1
    ORDER BY s.viewers DESC
    LIMIT 1
  `).bind(start, end).all();
  const pr = peakRes.results?.[0];
  if (pr && ALLOWED.has(String(pr.handle).toLowerCase())) {
    peak = {
      who: pr.display_name || pr.handle,
      handle: String(pr.handle).toLowerCase(),
      platform: pr.platform,
      viewers: Number(pr.viewers || 0),
      title: pr.stream_title,
      ts: pr.captured_at,
    };
  }

  // Hours leaderboard — top creators by hours this day.
  const meta = await getCuratedList(env);
  const metaByHandle = new Map(meta.map(c => [c.handle, c]));
  const topCreators = [...hoursByHandle.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([h, mins]) => ({
      handle: h,
      display_name: metaByHandle.get(h)?.display_name || h,
      hours: Math.round(mins / 60 * 10) / 10,
      peak: 0, // unused by the LLM prompt
    }));

  // Top server by viewer-hours.
  let topServer = null;
  for (const [sid, agg] of serverHours) {
    if (!topServer || agg.viewer_hours > topServer.viewer_hours) {
      topServer = {
        id: sid,
        name: SERVER_NAME_BY_ID[sid] || sid,
        viewer_hours: Math.round(agg.viewer_hours),
        mins: agg.mins,
      };
    }
  }
  const allServers = [...serverHours.entries()]
    .map(([sid, agg]) => ({ id: sid, name: SERVER_NAME_BY_ID[sid] || sid, viewer_hours: Math.round(agg.viewer_hours) }))
    .sort((a, b) => b.viewer_hours - a.viewer_hours);

  // Mod notes for this day. Per-creator concatenation of every mod's
  // notes for the day (non-empty only). Capped per-creator so a single
  // verbose mod can't blow up the prompt.
  let modNotes = [];
  try {
    const notesRes = await env.DB.prepare(`
      SELECT n.creator_handle, n.notes, n.flagged_moments, m.display_name AS mod_name
        FROM mod_stream_notes n
        INNER JOIN mod_accounts m ON m.id = n.mod_id
       WHERE n.session_date = ? AND m.status = 'verified'
         AND (LENGTH(n.notes) > 0 OR LENGTH(COALESCE(n.flagged_moments, '[]')) > 2)
       ORDER BY n.updated_at DESC
       LIMIT 30
    `).bind(dayYmd).all();
    for (const r of (notesRes.results || [])) {
      const trimmed = String(r.notes || '').slice(0, 600);
      let flags = [];
      try { flags = JSON.parse(r.flagged_moments || '[]'); } catch {}
      modNotes.push({
        creator_handle: String(r.creator_handle).toLowerCase(),
        mod_name: r.mod_name,
        notes: trimmed,
        flagged_moments: flags.slice(0, 8),
      });
    }
  } catch { /* mod_stream_notes may not exist on legacy DBs — ignore */ }

  return {
    date: dayYmd,
    totalHours: Math.round(totalMins / 60),
    creatorsLive: liveCreators.size,
    sessionsCount: sessions.length,
    peak,
    topServer,
    allServers,
    topCreators,
    modNotes,
  };
}

// ----------------------------------------------------------------
// Anthropic call — daily voicing (200 words, sports-reporter style).
// ----------------------------------------------------------------
async function callAnthropicDaily(env, data) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const lines = [];
  lines.push(`Date covered: ${data.date} (UTC)`);
  lines.push(`Total hours streamed across the curated UK GTA RP streamers: ${data.totalHours}`);
  lines.push(`Streamers who went live this day: ${data.creatorsLive}`);
  lines.push(`Total stream sessions: ${data.sessionsCount}`);
  if (data.peak) {
    lines.push(`Peak viewership moment: ${data.peak.who} on ${data.peak.platform} hit ${data.peak.viewers} viewers — stream titled "${data.peak.title || '(no title)'}"`);
  }
  if (data.topServer) {
    lines.push(`Most active server: ${data.topServer.name} (${data.topServer.viewer_hours} viewer-hours)`);
  }
  if (data.allServers?.length > 1) {
    lines.push(`Server rotation: ${data.allServers.slice(0, 5).map(s => `${s.name}=${s.viewer_hours}vh`).join(', ')}`);
  }
  if (data.topCreators?.length) {
    lines.push(`Hours leaderboard: ${data.topCreators.slice(0, 5).map(c => `${c.display_name} ${c.hours}h`).join('; ')}`);
  }

  // Mod notes (item 5) — verified mods can write per-stream notes that
  // get fed into the recap prompt as additional colour. Each mod's
  // notes get a clearly-labelled section so the model can attribute
  // narrative beats they couldn't otherwise see in the metrics.
  if (Array.isArray(data.modNotes) && data.modNotes.length) {
    lines.push('');
    lines.push('=== Mod stream notes (private, from verified moderators of these streamers) ===');
    for (const m of data.modNotes) {
      const flagsStr = (m.flagged_moments || []).map(f => `${f.label || 'moment'}`).join(' / ');
      lines.push(`- For ${m.creator_handle} (mod: ${m.mod_name})${flagsStr ? ` [flagged: ${flagsStr}]` : ''}: ${m.notes || '(no notes, only flags)'}`);
    }
    lines.push('=== End mod notes ===');
    lines.push('Use these mod notes to add specifics the metrics can\'t show — character names, plot beats, "why" something happened. Don\'t quote the notes verbatim or attribute to the mod; just integrate the colour into the narrative naturally.');
  }

  const userPrompt = `Here is yesterday's UK GTA RP scene data:\n\n${lines.join('\n')}\n\nWrite the daily recap now.`;

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{
      type: 'text',
      text: 'You are a UK GTA RP scene reporter writing for ContentLore, a streaming intelligence site. Your audience already follows the scene. Write a 150-180 word daily recap of yesterday\'s action based on the data provided. Write like a sports match reporter: vivid, specific, energetic, present tense for the moments. Name streamers, servers and viewer counts directly. Don\'t hedge, don\'t list — narrate. Don\'t open with "Here\'s your recap" or restate the prompt. Don\'t use the word "creators" — call them streamers. Use UK English spelling. Output plain prose only — no headings, no markdown, no bullet points.',
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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  const text = j?.content?.[0]?.text?.trim();
  if (!text) throw new Error('Anthropic returned empty content');
  return { text, model: j?.model || MODEL };
}

function fallbackDaily(d) {
  const parts = [];
  if (d.totalHours === 0 && d.creatorsLive === 0) {
    return `Quiet day on ${d.date} — no UK GTA RP streamers went live in the tracked window.`;
  }
  parts.push(`On ${d.date}, the tracked UK GTA RP scene logged ${fmtN(d.totalHours)} streamed hours from ${d.creatorsLive} streamer${d.creatorsLive === 1 ? '' : 's'}.`);
  if (d.peak) parts.push(`The peak moment came from ${d.peak.who}, pulling ${fmtN(d.peak.viewers)} viewers on ${d.peak.platform}.`);
  if (d.topServer) parts.push(`${d.topServer.name} dominated server time with ${fmtN(d.topServer.viewer_hours)} viewer-hours.`);
  if (d.topCreators?.[0]) parts.push(`${d.topCreators[0].display_name} led the hours leaderboard with ${d.topCreators[0].hours}h streamed.`);
  parts.push("Auto-generated fallback — Claude wasn't reachable.");
  return parts.join(' ');
}

// ----------------------------------------------------------------
// GET — read recent recap(s) from D1.
// ----------------------------------------------------------------
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get('days') || '1', 10) || 1));

  try {
    if (date) {
      const row = await env.DB.prepare(
        `SELECT date, content, source, model, data_snapshot, generated_at FROM daily_recaps WHERE date = ?`
      ).bind(date).first();
      if (!row) return jsonResponse({ ok: false, error: 'not_found', date }, 404);
      return jsonResponse({ ok: true, recap: rowToObj(row) });
    }
    const res = await env.DB.prepare(
      `SELECT date, content, source, model, data_snapshot, generated_at FROM daily_recaps ORDER BY date DESC LIMIT ?`
    ).bind(days).all();
    const rows = (res.results || []).map(rowToObj);
    if (days === 1) {
      if (!rows.length) return jsonResponse({ ok: true, recap: null });
      return jsonResponse({ ok: true, recap: rows[0] });
    }
    return jsonResponse({ ok: true, count: rows.length, recaps: rows });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ----------------------------------------------------------------
// POST — generate-and-store. Admin-auth required.
// ----------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.ADMIN_TOKEN || ''}`;
  if (!env.ADMIN_TOKEN || auth !== expected) {
    return jsonResponse({ ok: false, error: 'unauthorised' }, 401);
  }

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || yesterdayUtcYmd();
  const force = url.searchParams.get('force') === '1';

  try {
    if (!force) {
      const existing = await env.DB.prepare(`SELECT date, content, source, model, data_snapshot, generated_at FROM daily_recaps WHERE date = ?`).bind(date).first();
      if (existing) return jsonResponse({ ok: true, reused: true, recap: rowToObj(existing) });
    }

    const data = await computeDayMetrics(env, date);

    let content, source, model;
    try {
      const r = await callAnthropicDaily(env, data);
      content = r.text;
      model = r.model;
      source = 'anthropic';
    } catch (err) {
      content = fallbackDaily(data);
      model = 'fallback';
      source = 'fallback';
      console.error('[daily-recap] anthropic failed', String(err?.message || err));
    }

    await env.DB.prepare(
      `INSERT INTO daily_recaps (date, content, source, model, data_snapshot, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         content = excluded.content,
         source = excluded.source,
         model = excluded.model,
         data_snapshot = excluded.data_snapshot,
         generated_at = excluded.generated_at`
    ).bind(
      date, content, source, model, JSON.stringify(data), Math.floor(Date.now() / 1000)
    ).run();

    return jsonResponse({ ok: true, generated: true, recap: { date, content, source, model, data_snapshot: data, generated_at: Math.floor(Date.now() / 1000) } });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function rowToObj(r) {
  let data = null;
  try { data = r.data_snapshot ? JSON.parse(r.data_snapshot) : null; } catch { /* ignore */ }
  return {
    date: r.date,
    content: r.content,
    source: r.source,
    model: r.model,
    data_snapshot: data,
    generated_at: Number(r.generated_at),
  };
}

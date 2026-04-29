// ================================================================
// functions/wrapped/[handle].js
// GET /wrapped/{handle}
//
// Spotify-Wrapped-style monthly recap for one curated creator.
// Bold colour cards, big numbers, share button.
// Server-rendered HTML — same shape as /creator-profile/{handle}.
// ================================================================

import { getCuratedEntry } from '../_curated.js';

// Mirror of SERVERS from creator-profile/[handle].js. Sync when the
// servers list changes there. See gotchas in CLAUDE.md.
const SERVERS = [
  { id: 'unique',      name: 'Unique RP',      keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         name: 'TNG RP',         keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       name: 'Orbit RP',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     name: 'New Era RP',     keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     name: 'Prodigy RP',     keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         name: 'D10 RP',         keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   name: 'Unmatched RP',   keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'verarp',      name: 'VeraRP',         keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        name: 'The Endz',       keywords: ['the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      name: "Let's RP",       keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     name: 'Drill UK RP',    keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life RP',keywords: ['british life', 'britishlife'] },
  { id: '9kings',      name: '9 Kings RP',     keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
];
const SERVERS_BY_KEYWORD_LENGTH = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);
function detectServer(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const s of SERVERS_BY_KEYWORD_LENGTH) {
    for (const kw of s.keywords) if (t.includes(kw)) return s;
  }
  return null;
}

function monthBounds() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = Math.floor(Date.UTC(y, m, 1) / 1000);
  const lastY = m === 0 ? y - 1 : y;
  const lastM = m === 0 ? 11 : m - 1;
  const lastStart = Math.floor(Date.UTC(lastY, lastM, 1) / 1000);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  return { start, lastStart, monthLabel };
}

export async function onRequestGet({ params, env }) {
  const rawHandle = String(params.handle || '').toLowerCase();
  const entry = await getCuratedEntry(env, rawHandle);
  if (!entry) return notFoundPage(rawHandle);

  const { start, lastStart, monthLabel } = monthBounds();

  const [sessionRows, monthRanks, profileRow, bestClip, topPeer] = await Promise.all([
    queryMonthSessions(env, entry.handle, lastStart).catch(() => []),
    queryMonthRanks(env, start).catch(() => []),
    lookupCreator(env, entry.handle).catch(() => null),
    queryBestClip(env, entry.handle, start).catch(() => null),
    queryTopPeer(env, entry.handle, start).catch(() => null),
  ]);

  const wrapped = computeWrapped(sessionRows, start, lastStart, monthRanks, entry.handle);

  return new Response(renderWrapped({
    handle: entry.handle,
    name: profileRow?.display_name || entry.name,
    platform: entry.platform,
    avatar: profileRow?.avatar_url || null,
    monthLabel,
    wrapped,
    bestClip,
    topPeer,
  }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=600',
    },
  });
}

// ================================================================
// Data
// ================================================================
async function lookupCreator(env, handle) {
  const row = await env.DB.prepare(`
    SELECT c.display_name, c.avatar_url
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id
     WHERE cp.handle = ? AND cp.is_primary = 1
     LIMIT 1`).bind(handle).first();
  return row || null;
}

async function queryMonthSessions(env, handle, sinceLast) {
  // Pull both this month and last month so we can compute deltas in JS.
  const res = await env.DB.prepare(`
    SELECT ss.started_at, ss.ended_at, ss.duration_mins,
           ss.peak_viewers, ss.avg_viewers, ss.final_title
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id
     WHERE cp.handle = ? AND ss.started_at >= ?
     ORDER BY ss.started_at ASC`).bind(handle, sinceLast).all();
  return res.results || [];
}

async function queryMonthRanks(env, start) {
  const res = await env.DB.prepare(`
    SELECT cp.handle, SUM(ss.duration_mins) AS mins
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      INNER JOIN curated_creators cc ON cc.handle = cp.handle AND cc.active = 1
     WHERE ss.started_at >= ?
     GROUP BY ss.creator_id
     ORDER BY mins DESC`).bind(start).all();
  return (res.results || []).map(r => ({
    handle: String(r.handle).toLowerCase(),
    mins: Number(r.mins || 0),
  }));
}

async function queryBestClip(env, handle, start) {
  // Pull approved community submissions for this creator first; fall back
  // to nothing if there are none. Helix clips would need a sub-request to
  // /api/clips, which we'd rather not add to a server-rendered page hot path.
  try {
    const row = await env.DB.prepare(`
      SELECT id, url, platform, clip_id, description, decided_at
        FROM clip_submissions
       WHERE status = 'approved' AND creator_handle = ?
         AND COALESCE(decided_at, submitted_at) >= ?
       ORDER BY COALESCE(decided_at, submitted_at) DESC
       LIMIT 1`).bind(handle, start).first();
    return row || null;
  } catch {
    return null;
  }
}

// Top peer this month — same overlap query as creator-profile but scoped
// to the current calendar month and limit 1.
async function queryTopPeer(env, handle, start) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    SELECT cp_other.handle AS handle,
           c.display_name AS display_name,
           c.avatar_url AS avatar_url,
           SUM(MAX(0,
             MIN(IFNULL(ss_a.ended_at, ?), IFNULL(ss_other.ended_at, ?))
             - MAX(ss_a.started_at, ss_other.started_at)
           )) AS overlap_secs
      FROM stream_sessions ss_a
      INNER JOIN creator_platforms cp_a ON cp_a.creator_id = ss_a.creator_id AND cp_a.handle = ?
      INNER JOIN stream_sessions ss_other ON ss_other.creator_id != ss_a.creator_id
             AND ss_other.started_at < IFNULL(ss_a.ended_at, ?)
             AND IFNULL(ss_other.ended_at, ?) > ss_a.started_at
      INNER JOIN creator_platforms cp_other ON cp_other.creator_id = ss_other.creator_id AND cp_other.is_primary = 1
      INNER JOIN curated_creators cc ON cc.handle = cp_other.handle AND cc.active = 1
      LEFT JOIN creators c ON c.id = ss_other.creator_id
     WHERE ss_a.started_at >= ?
     GROUP BY cp_other.handle, c.display_name, c.avatar_url
     HAVING overlap_secs > 0
     ORDER BY overlap_secs DESC
     LIMIT 1`).bind(now, now, handle, now, now, start).first();
  return row || null;
}

// ================================================================
// Computation
// ================================================================
function computeWrapped(sessions, start, lastStart, monthRanks, handle) {
  const thisMonth = sessions.filter(s => Number(s.started_at) >= start);
  const lastMonth = sessions.filter(s => Number(s.started_at) >= lastStart && Number(s.started_at) < start);

  const totalMins = thisMonth.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const lastMins = lastMonth.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const peak = thisMonth.reduce((m, r) => Math.max(m, r.peak_viewers || 0), 0);
  const peakSession = thisMonth.find(r => (r.peak_viewers || 0) === peak) || null;
  const weighted = thisMonth.reduce((s, r) => s + (r.avg_viewers || 0) * (r.duration_mins || 0), 0);
  const avg = totalMins > 0 ? Math.round(weighted / totalMins) : 0;
  const sessions_count = thisMonth.length;

  // Most-played server (by minutes, not just session count — longer means more committed).
  const serverMins = new Map();
  for (const s of thisMonth) {
    const sv = detectServer(s.final_title);
    if (!sv) continue;
    const cur = serverMins.get(sv.id) || { name: sv.name, mins: 0 };
    cur.mins += (s.duration_mins || 0);
    serverMins.set(sv.id, cur);
  }
  const serversByMins = [...serverMins.values()].sort((a, b) => b.mins - a.mins);
  const topServer = serversByMins[0] || null;
  const totalServerMins = serversByMins.reduce((s, x) => s + x.mins, 0) || 1;
  const topServerPct = topServer ? Math.round((topServer.mins / totalServerMins) * 100) : 0;

  // Days streamed this month (unique UTC dates).
  const days = new Set();
  for (const s of thisMonth) {
    if (!s.started_at) continue;
    const d = new Date(Number(s.started_at) * 1000);
    days.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`);
  }

  // Longest single session.
  const longest = thisMonth.reduce((m, r) => Math.max(m, r.duration_mins || 0), 0);

  // Most active hour-of-day (UK time).
  const hourMins = new Array(24).fill(0);
  for (const s of thisMonth) {
    if (!s.started_at) continue;
    const t = Number(s.started_at);
    const m = new Date(t * 1000).getUTCMonth();
    const offset = (m >= 2 && m <= 9) ? 1 : 0;
    const ukHour = new Date(t * 1000 + offset * 3600_000).getUTCHours();
    hourMins[ukHour] += (s.duration_mins || 0);
  }
  const peakHour = hourMins.reduce((bestIdx, _, i, a) => a[i] > a[bestIdx] ? i : bestIdx, 0);
  const peakHourMins = hourMins[peakHour];

  // Position in this month's leaderboard.
  let rank = null;
  if (Array.isArray(monthRanks) && monthRanks.length) {
    const idx = monthRanks.findIndex(r => r.handle === handle);
    if (idx !== -1) rank = idx + 1;
  }
  const rankOf = monthRanks?.length || 0;

  // Hours delta vs last month.
  const hoursDeltaPct = lastMins > 0 ? Math.round(((totalMins - lastMins) / lastMins) * 100) : null;

  return {
    hasData: thisMonth.length > 0,
    hours: Math.round(totalMins / 60 * 10) / 10,
    lastHours: Math.round(lastMins / 60 * 10) / 10,
    hoursDeltaPct,
    sessions_count,
    peak,
    peakSession,
    avg,
    topServer,
    topServerPct,
    days: days.size,
    longestHours: Math.round(longest / 60 * 10) / 10,
    peakHour,
    peakHourMins,
    rank,
    rankOf,
    serverSplit: serversByMins.slice(0, 5),
  };
}

// ================================================================
// Render
// ================================================================
function renderWrapped({ handle, name, platform, avatar, monthLabel, wrapped, bestClip, topPeer }) {
  const platUrl = platform === 'kick' ? `https://kick.com/${handle}` : `https://twitch.tv/${handle}`;

  if (!wrapped.hasData) {
    return baseHtml(`${esc(name)} · Wrapped`, `
      <div class="empty-wrap">
        <h1>${esc(name)}</h1>
        <p class="kicker">${esc(monthLabel)} Wrapped</p>
        <p class="empty-msg">No streams tracked this month yet — your Wrapped will fill in as the month progresses.</p>
        <a class="back" href="/creator-profile/${esc(handle)}">← Back to profile</a>
      </div>`);
  }

  const w = wrapped;
  const peakWhen = w.peakSession ? new Date(Number(w.peakSession.started_at) * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '';
  const ukHourLabel = formatHour(w.peakHour);
  const deltaTxt = w.hoursDeltaPct == null ? null
    : (w.hoursDeltaPct >= 0 ? `+${w.hoursDeltaPct}% vs ${monthBoundsLastLabel()}` : `${w.hoursDeltaPct}% vs ${monthBoundsLastLabel()}`);
  const rankCopy = w.rank ? `#${w.rank} of ${w.rankOf} active streamers` : 'Tracked among the curated scene';

  const peerCard = topPeer ? renderPeerCard(topPeer) : '';
  const clipCard = bestClip ? renderClipCard(bestClip) : '';

  return baseHtml(`${esc(name)} · ${esc(monthLabel)} Wrapped`, `
  <nav class="nav">
    <a href="/" class="brand"><img src="/logo.png" alt="ContentLore"></a>
    <a class="back-link" href="/creator-profile/${esc(handle)}">← ${esc(name)}'s profile</a>
  </nav>

  <section class="hero">
    <div class="hero-tag">${esc(monthLabel)} Wrapped</div>
    ${avatar ? `<img class="hero-av" src="${esc(avatar)}" alt="${esc(name)}">` : `<div class="hero-av-ph">${esc((name || '?').charAt(0).toUpperCase())}</div>`}
    <h1 class="hero-name">${esc(name)}</h1>
    <p class="hero-sub">Here's how ${esc(name)}'s month went on the UK GTA RP scene.</p>
  </section>

  <section class="cards">
    <div class="card g1">
      <div class="card-tag">Hours streamed</div>
      <div class="card-big">${w.hours}</div>
      <div class="card-unit">hours live</div>
      ${deltaTxt ? `<div class="card-foot">${esc(deltaTxt)}</div>` : ''}
    </div>

    ${w.topServer ? `
    <div class="card g2">
      <div class="card-tag">Home server</div>
      <div class="card-big card-server">${esc(w.topServer.name.replace(/ RP$/, ''))}</div>
      <div class="card-unit">${w.topServerPct}% of streamed time</div>
      ${w.serverSplit.length > 1 ? `<div class="card-foot">+${w.serverSplit.length - 1} other server${w.serverSplit.length - 1 === 1 ? '' : 's'} this month</div>` : ''}
    </div>` : ''}

    <div class="card g3">
      <div class="card-tag">Peak viewers</div>
      <div class="card-big">${formatBig(w.peak)}</div>
      <div class="card-unit">on ${esc(peakWhen || 'this month')}</div>
      ${w.peakSession?.final_title ? `<div class="card-foot">"${esc(trimTitle(w.peakSession.final_title, 90))}"</div>` : ''}
    </div>

    <div class="card g4">
      <div class="card-tag">Average viewers</div>
      <div class="card-big">${formatBig(w.avg)}</div>
      <div class="card-unit">across ${w.sessions_count} session${w.sessions_count === 1 ? '' : 's'}</div>
    </div>

    <div class="card g5">
      <div class="card-tag">Days live</div>
      <div class="card-big">${w.days}</div>
      <div class="card-unit">day${w.days === 1 ? '' : 's'} streamed</div>
      <div class="card-foot">Longest: ${w.longestHours}h in one go</div>
    </div>

    <div class="card g6">
      <div class="card-tag">Peak hour</div>
      <div class="card-big card-hour">${esc(ukHourLabel)}</div>
      <div class="card-unit">UK time · most active</div>
      <div class="card-foot">${Math.round(w.peakHourMins / 60 * 10) / 10}h streamed in this hour-of-day</div>
    </div>

    <div class="card g7">
      <div class="card-tag">Scene position</div>
      <div class="card-big">${w.rank ? '#' + w.rank : '—'}</div>
      <div class="card-unit">${esc(rankCopy)}</div>
      ${w.rank && w.rank <= 3 ? `<div class="card-foot">${w.rank === 1 ? '🥇 Top of the scene' : w.rank === 2 ? '🥈 Runner-up' : '🥉 Top three'}</div>` : ''}
    </div>

    ${peerCard}
    ${clipCard}
  </section>

  <section class="share-row">
    <div class="share-box">
      <div class="share-tag">Share this Wrapped</div>
      <div class="share-line">
        <input id="share-url" readonly value="${esc(`https://contentlore.com/wrapped/${handle}`)}">
        <button id="share-btn" type="button">Copy link</button>
      </div>
      <p class="share-help">Take a screenshot of any card above and post it. The page is open to anyone — no login needed.</p>
    </div>
  </section>

  <footer class="ftr">
    <a href="/creator-profile/${esc(handle)}">${esc(name)}'s profile</a>
    · <a href="${esc(platUrl)}" target="_blank" rel="noopener">${platform === 'kick' ? 'Kick' : 'Twitch'} channel</a>
    · <a href="/gta-rp/">Live hub</a>
  </footer>

  <script>
    (function(){
      var btn = document.getElementById('share-btn');
      var inp = document.getElementById('share-url');
      btn?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inp.value);
          btn.textContent = 'Copied ✓';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy link'; btn.classList.remove('copied'); }, 1800);
        } catch {
          inp.select();
          document.execCommand('copy');
          btn.textContent = 'Copied ✓';
        }
      });
    })();
  </script>`);
}

function renderPeerCard(p) {
  const av = p.avatar_url
    ? `<img class="peer-av" src="${esc(p.avatar_url)}" alt="${esc(p.display_name || p.handle)}">`
    : `<div class="peer-av-ph">${esc((p.display_name || p.handle || '?').charAt(0).toUpperCase())}</div>`;
  const hours = (p.overlap_secs || 0) >= 3600
    ? Math.round(p.overlap_secs / 3600) + 'h'
    : Math.max(1, Math.round((p.overlap_secs || 0) / 60)) + 'm';
  return `<a class="card g8 card-link" href="/creator-profile/${esc(String(p.handle).toLowerCase())}">
    <div class="card-tag">Most-shared streams</div>
    <div class="peer-row">
      ${av}
      <div class="peer-col">
        <div class="card-big card-peer">${esc(p.display_name || p.handle)}</div>
        <div class="card-unit">${hours} of overlap this month</div>
      </div>
    </div>
    <div class="card-foot">Tap to view their profile →</div>
  </a>`;
}

function renderClipCard(c) {
  const url = c.url || '#';
  const blurb = c.description ? trimTitle(c.description, 110) : 'A community-picked highlight from this month.';
  return `<a class="card g9 card-link" href="${esc(url)}" target="_blank" rel="noopener">
    <div class="card-tag">Best clip · community pick</div>
    <div class="card-big card-clip">★</div>
    <div class="card-unit">${esc(blurb)}</div>
    <div class="card-foot">Open on ${c.platform === 'kick' ? 'Kick' : 'Twitch'} ↗</div>
  </a>`;
}

// ================================================================
// HTML chrome / styles
// ================================================================
function baseHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} · ContentLore</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0a0612">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ContentLore">
<meta property="og:title" content="${title} · ContentLore">
<meta property="og:image" content="https://contentlore.com/logo.png">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="/pwa.js" defer></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --ink:#fff; --bg:#0a0612;
  --font-d:'Bebas Neue',Impact,sans-serif;
  --font-m:'JetBrains Mono',monospace;
  --font-b:'Inter',system-ui,sans-serif;
}
html,body{background:var(--bg);color:var(--ink);font-family:var(--font-b);min-height:100vh}
body{position:relative;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background:
  radial-gradient(ellipse at 15% 10%, rgba(80,255,210,.10), transparent 60%),
  radial-gradient(ellipse at 85% 90%, rgba(255,80,180,.10), transparent 60%);
  pointer-events:none;z-index:0}
body>*{position:relative;z-index:1}

.nav{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid rgba(255,255,255,.05);position:sticky;top:0;background:rgba(10,6,18,.85);backdrop-filter:blur(8px);z-index:100}
.nav .brand img{height:32px;display:block}
.back-link{font-family:var(--font-m);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.65);text-decoration:none}
.back-link:hover{color:#fff}

.hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:64px 24px 48px;max-width:780px;margin:0 auto}
.hero-tag{font-family:var(--font-m);font-size:13px;letter-spacing:4px;text-transform:uppercase;background:linear-gradient(90deg,#7af,#fa7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:600}
.hero-av{width:140px;height:140px;border-radius:50%;border:4px solid rgba(255,255,255,.15);object-fit:cover;margin:18px 0;box-shadow:0 30px 60px rgba(0,0,0,.5)}
.hero-av-ph{width:140px;height:140px;border-radius:50%;border:4px solid rgba(255,255,255,.15);background:linear-gradient(135deg,#7af,#fa7);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:64px;color:#fff;margin:18px 0}
.hero-name{font-family:var(--font-d);font-size:clamp(56px,11vw,108px);line-height:.95;letter-spacing:3px;text-transform:uppercase;background:linear-gradient(90deg,#fff,#fff,#a8d0ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero-sub{font-size:16px;line-height:1.6;color:rgba(255,255,255,.65);margin-top:14px;max-width:560px}

.cards{max-width:1200px;margin:0 auto;padding:24px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:880px){.cards{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.cards{grid-template-columns:1fr}}
.card{position:relative;padding:32px 28px;border-radius:24px;overflow:hidden;min-height:240px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 18px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06);text-decoration:none;color:inherit;transition:transform .25s ease}
.card-link:hover{transform:translateY(-3px)}
.card::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at top right,rgba(255,255,255,.12),transparent 60%);pointer-events:none}

/* Bold gradients per card — distinct, vibrant, photo-friendly. */
.g1{background:linear-gradient(135deg,#1f4dff 0%,#9c1bff 100%)}
.g2{background:linear-gradient(135deg,#ff5e98 0%,#ffc74f 100%)}
.g3{background:linear-gradient(135deg,#00d2c0 0%,#0091ff 100%)}
.g4{background:linear-gradient(135deg,#ff7a00 0%,#ff2e6b 100%)}
.g5{background:linear-gradient(135deg,#9d4cff 0%,#1de1ff 100%)}
.g6{background:linear-gradient(135deg,#ffd24f 0%,#ff7c4f 100%);color:#180a00}
.g6 .card-tag,.g6 .card-foot{color:rgba(0,0,0,.6)}
.g6 .card-unit{color:rgba(0,0,0,.7)}
.g7{background:linear-gradient(135deg,#0c2a52 0%,#1572a8 100%)}
.g8{background:linear-gradient(135deg,#220a45 0%,#7a1eb5 100%)}
.g9{background:linear-gradient(135deg,#1a1a1a 0%,#3a0c0c 100%);border:1px solid rgba(255,200,0,.4)}

.card-tag{font-family:var(--font-m);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.85);font-weight:600;position:relative;z-index:2}
.card-big{font-family:var(--font-d);font-size:clamp(56px,9vw,84px);line-height:.95;letter-spacing:1px;color:#fff;position:relative;z-index:2;margin:8px 0 0}
.card-server{font-size:clamp(38px,6.5vw,56px);word-break:break-word}
.card-peer{font-size:clamp(28px,5.5vw,42px);word-break:break-word}
.card-clip{font-size:84px}
.card-hour{font-size:clamp(48px,8vw,72px)}
.card-unit{font-family:var(--font-b);font-size:13px;color:rgba(255,255,255,.78);position:relative;z-index:2;margin-top:6px;letter-spacing:.5px}
.card-foot{font-family:var(--font-m);font-size:11px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:1.5px;margin-top:auto;padding-top:14px;border-top:1px dashed rgba(255,255,255,.18);position:relative;z-index:2}

.peer-row{display:flex;align-items:center;gap:14px;margin-top:8px;position:relative;z-index:2}
.peer-av{width:56px;height:56px;border-radius:50%;border:2px solid rgba(255,255,255,.3);object-fit:cover}
.peer-av-ph{width:56px;height:56px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:24px}
.peer-col{flex:1;min-width:0}

.share-row{padding:36px 24px;max-width:780px;margin:0 auto}
.share-box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px}
.share-tag{font-family:var(--font-m);font-size:12px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.85);margin-bottom:14px}
.share-line{display:flex;gap:8px}
.share-line input{flex:1;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);color:#fff;padding:12px 14px;border-radius:10px;font-family:var(--font-m);font-size:13px}
.share-line button{background:linear-gradient(135deg,#7af,#fa7);border:0;color:#0a0612;font-family:var(--font-d);font-size:14px;letter-spacing:2px;padding:12px 22px;border-radius:10px;cursor:pointer;transition:transform .15s}
.share-line button:hover{transform:translateY(-1px)}
.share-line button.copied{background:#3acc88;color:#fff}
.share-help{margin-top:10px;font-size:12px;color:rgba(255,255,255,.5);line-height:1.5}

.ftr{padding:24px;text-align:center;font-family:var(--font-m);font-size:12px;color:rgba(255,255,255,.5);letter-spacing:1.5px;text-transform:uppercase}
.ftr a{color:rgba(255,255,255,.7);text-decoration:none;margin:0 6px}
.ftr a:hover{color:#fff}

/* empty / 404 */
.empty-wrap{max-width:560px;margin:0 auto;padding:96px 24px;text-align:center}
.empty-wrap h1{font-family:var(--font-d);font-size:clamp(56px,12vw,96px);line-height:.95;letter-spacing:3px}
.empty-wrap .kicker{font-family:var(--font-m);font-size:13px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.6);margin-top:8px}
.empty-wrap .empty-msg{margin-top:24px;font-size:15px;line-height:1.6;color:rgba(255,255,255,.7)}
.empty-wrap .back{display:inline-block;margin-top:32px;font-family:var(--font-m);font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#7af;text-decoration:none;border:1px solid rgba(255,255,255,.15);padding:12px 22px;border-radius:10px}
.empty-wrap .back:hover{border-color:#7af}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function notFoundPage(handle) {
  return new Response(baseHtml('404', `
    <div class="empty-wrap">
      <h1>404</h1>
      <p class="kicker">"${esc(handle)}" isn't on the curated roster — no Wrapped to render.</p>
      <a class="back" href="/gta-rp/">← Back to live hub</a>
    </div>`), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ================================================================
// Helpers
// ================================================================
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatBig(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}
function trimTitle(t, max) {
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}
function formatHour(h) {
  if (h == null) return '—';
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}
function monthBoundsLastLabel() {
  const d = new Date();
  d.setUTCDate(0); // last day of previous month
  return d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
}

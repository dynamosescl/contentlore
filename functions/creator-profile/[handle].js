// ================================================================
// functions/creator-profile/[handle].js
// GET /creator-profile/{handle}
//
// Server-rendered HTML profile page for one of the curated 26.
// Off-allowlist handles return a branded 404. Data sources:
//   - Live state: KV `uk-rp-live:cache` (warmed by /api/uk-rp-live)
//   - Clips:      KV `clips:30d:cache`  (warmed by /api/clips)
//   - History:    D1 `stream_sessions`  (joined via creator_platforms.handle)
//   - Server affinity: keyword-match over recent stream titles
//
// We intentionally read the warm KV caches rather than re-call the
// platform APIs so this page is cheap to serve and stays consistent
// with what the rest of the site shows.
// ================================================================

const ALLOWLIST = [
  { handle: 'tyrone',         platform: 'twitch', name: 'Tyrone' },
  { handle: 'lbmm',           platform: 'twitch', name: 'LBMM' },
  { handle: 'reeclare',       platform: 'twitch', name: 'Reeclare' },
  { handle: 'stoker',         platform: 'twitch', name: 'Stoker' },
  { handle: 'samham',         platform: 'twitch', name: 'SamHam' },
  { handle: 'deggyuk',        platform: 'twitch', name: 'DeggyUK' },
  { handle: 'megsmary',       platform: 'twitch', name: 'MegsMary' },
  { handle: 'tazzthegeeza',   platform: 'twitch', name: 'TaZzTheGeeza' },
  { handle: 'wheelydev',      platform: 'twitch', name: 'WheelyDev' },
  { handle: 'rexality',       platform: 'twitch', name: 'RexaliTy' },
  { handle: 'steeel',         platform: 'twitch', name: 'Steeel' },
  { handle: 'justj0hnnyhd',   platform: 'twitch', name: 'JustJ0hnnyHD' },
  { handle: 'cherish_remedy', platform: 'twitch', name: 'Cherish_Remedy' },
  { handle: 'lorddorro',      platform: 'twitch', name: 'LordDorro' },
  { handle: 'jck0__',         platform: 'twitch', name: 'JCK0__' },
  { handle: 'absthename',     platform: 'twitch', name: 'ABsTheName' },
  { handle: 'essellz',          platform: 'twitch', name: 'Essellz' },
  { handle: 'lewthescot',       platform: 'twitch', name: 'LewTheScot' },
  { handle: 'angels365',        platform: 'twitch', name: 'Angels365' },
  { handle: 'fantasiasfantasy', platform: 'twitch', name: 'FantasiasFantasy' },
  { handle: 'kavsual',        platform: 'kick',   name: 'Kavsual' },
  { handle: 'shammers',       platform: 'kick',   name: 'Shammers' },
  { handle: 'bags',           platform: 'kick',   name: 'Bags' },
  { handle: 'dynamoses',      platform: 'kick',   name: 'Dynamoses' },
  { handle: 'dcampion',       platform: 'kick',   name: 'DCampion' },
  { handle: 'elliewaller',    platform: 'kick',   name: 'EllieWaller' },
];

// Subset of SERVERS data needed for affinity detection. Kept in sync with
// the SERVERS array in /gta-rp/servers/index.html — when that grows, mirror
// the additions here. (Eventually move to a shared module.)
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
];

// Match longest keyword first so "newera rp" beats "newera"/"new era".
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

export async function onRequestGet({ params, env, request }) {
  const rawHandle = String(params.handle || '').toLowerCase();
  const entry = ALLOWLIST.find(c => c.handle === rawHandle);

  if (!entry) return notFoundPage(rawHandle);

  // Pull the warm KV caches and the D1 history in parallel.
  const [liveCache, clipsCache, dbProfile, sessionRows] = await Promise.all([
    env.KV.get('uk-rp-live:cache', 'json').catch(() => null),
    getClipsCache(env, request),
    lookupDbCreator(env, entry.handle),
    querySessions(env, entry.handle).catch(() => null),
  ]);

  const liveEntry = (liveCache?.live || []).find(c => c.handle === entry.handle) || null;
  const clips = (clipsCache?.clips || []).filter(c => c.creator_handle === entry.handle).slice(0, 6);
  const stats = aggregateStats(sessionRows || []);
  const affinity = aggregateServerAffinity(sessionRows || []);

  const display = liveEntry?.display_name || dbProfile?.display_name || entry.name;
  const avatar = liveEntry?.avatar_url || dbProfile?.avatar_url || null;
  const tiktok = liveEntry?.tiktok || null;
  const youtube = liveEntry?.youtube || null;

  return new Response(renderProfile({
    handle: entry.handle, name: display, platform: entry.platform,
    avatar, liveEntry, clips, stats, affinity, tiktok, youtube,
  }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60',
    },
  });
}

// ================================================================
// Data
// ================================================================

// Clip cache lookup with cold-start fallback. Preference order:
//   1. clips:30d:cache  — preferred; widest window, freshest 5-min KV value
//   2. sub-request to /api/clips?range=30d — warms the 30d KV for next time
//   3. clips:7d:cache  — last resort; populated by every Clip Wall hit
async function getClipsCache(env, request) {
  let cache = await env.KV.get('clips:30d:cache', 'json').catch(() => null);
  if (cache) return cache;

  // Sub-request the API endpoint — the function and the API live on the same
  // origin, so this hits cache.cloudflare → the worker → KV write-through.
  try {
    const url = new URL('/api/clips?range=30d', request.url);
    const res = await fetch(url.toString(), { headers: { 'cf-pages-internal': '1' } });
    if (res.ok) {
      const json = await res.json();
      if (json?.ok) return json;
    }
  } catch { /* swallow — we'll try the 7d cache next */ }

  cache = await env.KV.get('clips:7d:cache', 'json').catch(() => null);
  return cache;
}

async function lookupDbCreator(env, handle) {
  try {
    const row = await env.DB.prepare(`
      SELECT c.id, c.display_name, c.avatar_url
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id
      WHERE cp.handle = ? AND cp.is_primary = 1
      LIMIT 1
    `).bind(handle).first();
    return row || null;
  } catch {
    return null;
  }
}

async function querySessions(env, handle) {
  // 90-day window — long enough for meaningful averages, short enough that
  // dropped/inactive servers don't skew affinity.
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  try {
    const res = await env.DB.prepare(`
      SELECT ss.started_at, ss.ended_at, ss.duration_mins,
             ss.peak_viewers, ss.avg_viewers, ss.final_title,
             ss.primary_category, ss.is_ongoing
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id
      WHERE cp.handle = ? AND ss.started_at >= ?
      ORDER BY ss.started_at DESC
      LIMIT 200
    `).bind(handle, since).all();
    return res.results || [];
  } catch {
    return [];
  }
}

function aggregateStats(sessions) {
  if (!sessions.length) {
    return { count: 0, hours: 0, avgViewers: 0, peakViewers: 0, lastStreamAt: null, hasData: false };
  }
  const totalMins = sessions.reduce((s, r) => s + (r.duration_mins || 0), 0);
  const peak = sessions.reduce((m, r) => Math.max(m, r.peak_viewers || 0), 0);
  // Weighted average across sessions (each session's avg_viewers weighted by its duration).
  const weighted = sessions.reduce((s, r) => s + (r.avg_viewers || 0) * (r.duration_mins || 0), 0);
  const avg = totalMins > 0 ? Math.round(weighted / totalMins) : 0;
  const lastStreamAt = sessions[0].started_at;
  return {
    count: sessions.length,
    hours: Math.round(totalMins / 60),
    avgViewers: avg,
    peakViewers: peak,
    lastStreamAt,
    hasData: true,
  };
}

function aggregateServerAffinity(sessions) {
  const counts = new Map();
  // Only the most recent 30 sessions feed affinity — current allegiance > stale history.
  for (const s of sessions.slice(0, 30)) {
    const server = detectServer(s.final_title);
    if (!server) continue;
    counts.set(server.id, { ...server, n: (counts.get(server.id)?.n || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

// ================================================================
// Render
// ================================================================

function renderProfile({ handle, name, platform, avatar, liveEntry, clips, stats, affinity, tiktok, youtube }) {
  const platUrl = platform === 'kick' ? `https://kick.com/${handle}` : `https://twitch.tv/${handle}`;
  const platLabel = platform === 'kick' ? 'Kick' : 'Twitch';
  const isLive = !!liveEntry?.is_live;
  const liveBanner = isLive ? renderLiveBanner(handle, platform, liveEntry) : '';

  const platformLinks = [
    platform === 'twitch' ? { label: 'Twitch', url: platUrl, color: 'twitch' } : null,
    platform === 'kick' ? { label: 'Kick', url: platUrl, color: 'kick' } : null,
    tiktok ? { label: 'TikTok', url: `https://tiktok.com/@${tiktok.replace(/^@/, '')}`, color: 'tiktok' } : null,
    youtube ? { label: 'YouTube', url: youtube.startsWith('http') ? youtube : `https://youtube.com/@${youtube.replace(/^@/, '')}`, color: 'youtube' } : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(name)} — UK GTA RP | ContentLore</title>
<meta name="description" content="${esc(name)} — UK GTA RP creator on ${platLabel}. Live status, recent clips, stream stats and server affinity.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:oklch(0.09 0.04 295);--fg:oklch(0.97 0.02 320);
  --card:oklch(0.13 0.05 295);--card2:oklch(0.18 0.06 295);
  --ink-dim:oklch(0.78 0.05 320);--ink-faint:oklch(0.55 0.06 295);
  --signal:oklch(0.82 0.20 195);--signal-dim:oklch(0.65 0.18 195);--signal-cyan:oklch(0.85 0.18 200);
  --border:oklch(0.28 0.08 295);--live:oklch(0.82 0.20 195);
  --twitch:oklch(0.65 0.25 295);--kick:oklch(0.82 0.22 145);
  --tiktok:oklch(0.78 0.20 350);--youtube:oklch(0.68 0.27 25);
  --font-d:'Bebas Neue',Impact,sans-serif;--font-m:'JetBrains Mono',monospace;--font-b:'Inter',system-ui,sans-serif;
  --cut:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);
}
html{background:var(--bg);color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--font-b);-webkit-font-smoothing:antialiased;position:relative;min-height:100vh}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:1;background-image:repeating-linear-gradient(0deg,oklch(0.82 0.20 195/.04) 0 1px,transparent 1px 3px);mix-blend-mode:screen}
body>*{position:relative;z-index:3}

.nav{height:48px;background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;position:sticky;top:0;z-index:100}
.nav-brand{font-family:var(--font-d);font-size:22px;letter-spacing:2px;margin-right:24px;text-decoration:none;color:var(--fg);display:flex;align-items:center;gap:6px}
.nav-links{display:flex}
.nav-link{font-family:var(--font-m);font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);text-decoration:none;padding:14px;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nav-link:hover{color:var(--ink-dim)}
@media(max-width:700px){.nav-links{overflow-x:auto}}

.mx{max-width:1200px;margin:0 auto;padding:24px}
.back{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);text-decoration:none;margin-bottom:18px;transition:color .15s}
.back:hover{color:var(--signal)}

/* HERO */
.hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:32px 28px;margin-bottom:18px}
@media(max-width:600px){.hero{grid-template-columns:1fr;text-align:center}}
.hero-av{width:160px;height:160px;border-radius:50%;border:2px solid var(--signal);background:var(--card2);object-fit:cover;display:block;box-shadow:0 0 32px oklch(0.82 0.20 195/.3)}
@media(max-width:600px){.hero-av{margin:0 auto}}
.hero-av-ph{width:160px;height:160px;border-radius:50%;border:2px solid var(--border);background:var(--card2);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:64px;color:var(--ink-faint)}
.hero-info .h-kicker{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:3px;color:var(--signal);margin-bottom:8px}
.hero-info h1{font-family:var(--font-d);font-size:clamp(48px,8vw,84px);line-height:.95;letter-spacing:2px;margin-bottom:14px;word-break:break-word}
.hero-actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:600px){.hero-actions{justify-content:center}}
.btn{font-family:var(--font-d);font-size:14px;letter-spacing:2px;padding:10px 20px;text-decoration:none;clip-path:var(--cut);transition:all .2s;display:inline-block}
.btn-primary{background:var(--signal);color:var(--bg)}
.btn-primary:hover{box-shadow:0 0 22px oklch(0.82 0.20 195/.5);transform:translateY(-1px)}
.btn-ghost{background:var(--card2);border:1px solid var(--border);color:var(--fg)}
.btn-ghost:hover{border-color:var(--signal);color:var(--signal)}

/* LIVE BANNER */
.live-bar{display:flex;align-items:center;gap:12px;background:oklch(0.82 0.20 195/.12);border:1px solid var(--signal);clip-path:var(--cut);padding:14px 18px;margin-bottom:18px}
.live-bar .dot{width:10px;height:10px;border-radius:50%;background:var(--signal);animation:lp 2s infinite}
@keyframes lp{0%,100%{box-shadow:0 0 0 0 oklch(0.82 0.20 195/.8)}70%{box-shadow:0 0 0 10px oklch(0.82 0.20 195/0)}}
.live-bar .l-kicker{font-family:var(--font-m);font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--signal);font-weight:600}
.live-bar .l-title{font-family:var(--font-b);font-size:14px;color:var(--fg);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.live-bar .l-meta{font-family:var(--font-m);font-size:11px;color:var(--ink-dim);white-space:nowrap;display:flex;gap:10px}
.live-bar .l-meta .views{color:var(--signal);font-weight:600}
@media(max-width:700px){.live-bar{flex-wrap:wrap}.live-bar .l-title{order:3;flex-basis:100%}}
.embed-wrap{aspect-ratio:16/9;background:#000;border:1px solid var(--border);clip-path:var(--cut);overflow:hidden;margin-bottom:18px;position:relative}
.embed-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:none}

/* PLATFORM LINKS */
.plinks{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.plink{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;padding:8px 14px;background:var(--card);border:1px solid var(--border);color:var(--ink-dim);text-decoration:none;transition:all .15s;display:inline-flex;align-items:center;gap:6px}
.plink:hover{transform:translateY(-1px)}
.plink.twitch:hover{border-color:var(--twitch);color:var(--twitch)}
.plink.kick:hover{border-color:var(--kick);color:var(--kick)}
.plink.tiktok:hover{border-color:var(--tiktok);color:var(--tiktok)}
.plink.youtube:hover{border-color:var(--youtube);color:var(--youtube)}

/* SECTIONS */
.section{margin-top:32px}
.sec-h{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px}
.sec-h h2{font-family:var(--font-d);font-size:28px;letter-spacing:1px;color:var(--fg)}
.sec-h .sub{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint)}

/* STATS PANEL */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);padding:18px}
.stat .v{font-family:var(--font-d);font-size:34px;letter-spacing:1px;line-height:1;color:var(--signal)}
.stat .l{font-family:var(--font-m);font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint);margin-top:6px}
.stat .extra{font-family:var(--font-m);font-size:10px;color:var(--ink-dim);margin-top:6px}
.empty-block{background:var(--card);border:1px dashed var(--border);clip-path:var(--cut);padding:28px;text-align:center;font-family:var(--font-m);font-size:12px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:2px}

/* AFFINITY CHIPS */
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font-family:var(--font-m);font-size:11px;text-transform:uppercase;letter-spacing:1px;padding:8px 14px;background:var(--card);border:1px solid var(--border);color:var(--ink-dim);display:inline-flex;align-items:center;gap:8px;transition:all .15s}
.chip:hover{border-color:var(--signal);color:var(--fg)}
.chip .n{font-family:var(--font-d);font-size:14px;color:var(--signal);letter-spacing:0}

/* CLIPS GRID */
.clips-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:850px){.clips-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.clips-grid{grid-template-columns:1fr}}
.clip{background:var(--card);border:1px solid var(--border);clip-path:var(--cut);overflow:hidden;text-decoration:none;color:inherit;transition:all .2s;display:block}
.clip:hover{border-color:var(--signal);transform:translateY(-2px)}
.clip-thumb{aspect-ratio:16/9;background:var(--card2);position:relative;overflow:hidden}
.clip-thumb img{width:100%;height:100%;object-fit:cover}
.clip-vw{position:absolute;top:6px;right:6px;font-family:var(--font-m);font-size:10px;font-weight:600;padding:2px 6px;background:oklch(0.09 0.04 295/.85);color:var(--signal);border:1px solid oklch(0.82 0.20 195/.4)}
.clip-body{padding:10px 12px}
.clip-title{font-size:12px;line-height:1.4;color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.5em}
.clip-when{font-family:var(--font-m);font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;margin-top:4px}

.footer{border-top:1px solid var(--border);padding:20px;margin-top:40px;text-align:center;font-family:var(--font-m);font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--ink-faint)}

::selection{background:var(--signal);color:var(--bg)}
</style>
</head>
<body>

<nav class="nav">
  <a href="/gta-rp/" class="nav-brand"><img src="/logo.png" alt="ContentLore" style="height:40px;filter:brightness(1.1)" loading="eager"></a>
  <div class="nav-links">
    <a href="/gta-rp/" class="nav-link">Live</a>
    <a href="/gta-rp/now/" class="nav-link">Now</a>
    <a href="/gta-rp/multi/" class="nav-link">Multi-View</a>
    <a href="/gta-rp/clips/" class="nav-link">Clips</a>
    <a href="/gta-rp/timeline/" class="nav-link">Timeline</a>
    <a href="/gta-rp/streaks/" class="nav-link">Streaks</a>
    <a href="/gta-rp/servers/" class="nav-link">Servers</a>
  </div>
</nav>

<div class="mx">
  <a href="/gta-rp/" class="back">← Back to roster</a>

  <div class="hero">
    ${avatar
      ? `<img class="hero-av" src="${esc(avatar)}" alt="${esc(name)}">`
      : `<div class="hero-av-ph">${esc((name || '?').charAt(0))}</div>`}
    <div class="hero-info">
      <div class="h-kicker">UK GTA RP · ${platLabel}</div>
      <h1>${esc(name)}</h1>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${esc(platUrl)}" target="_blank" rel="noopener">Follow on ${platLabel} ↗</a>
        ${isLive ? `<a class="btn btn-ghost" href="#live">Watch now ↓</a>` : ''}
      </div>
    </div>
  </div>

  ${liveBanner}

  <div class="plinks">
    ${platformLinks.map(p =>
      `<a class="plink ${p.color}" href="${esc(p.url)}" target="_blank" rel="noopener">${p.label} ↗</a>`
    ).join('')}
  </div>

  <div class="section">
    <div class="sec-h"><h2>Stats</h2><span class="sub">Last 90 days</span></div>
    ${stats.hasData ? renderStats(stats) : `<div class="empty-block">No session history recorded yet for this creator. Stats will populate as the scheduler observes streams over time.</div>`}
  </div>

  ${affinity.length ? `
  <div class="section">
    <div class="sec-h"><h2>Server Affinity</h2><span class="sub">Most recent 30 sessions</span></div>
    <div class="chips">
      ${affinity.map(a => `<span class="chip">${esc(a.name)} <span class="n">${a.n}</span></span>`).join('')}
    </div>
  </div>` : ''}

  <div class="section">
    <div class="sec-h"><h2>Recent Clips</h2><a class="sub" href="/gta-rp/clips/" style="color:var(--signal);text-decoration:none">All clips →</a></div>
    ${clips.length ? `
      <div class="clips-grid">
        ${clips.map(renderClipCard).join('')}
      </div>` : `<div class="empty-block">${platform === 'kick' ? "Kick doesn't expose a clips API yet — we'll surface clips here as soon as they ship one." : 'No clips in the last 30 days.'}</div>`}
  </div>
</div>

<div class="footer">ContentLore · UK GTA RP · Creator Profile</div>

<script>
// Lightweight live-status refresh every 60s — only updates the banner, not the whole page.
async function refreshLive() {
  try {
    const r = await fetch('/api/uk-rp-live');
    const d = await r.json();
    if (!d.ok) return;
    const me = (d.live || []).find(c => c.handle === '${esc(handle)}');
    const bar = document.getElementById('live-bar');
    if (me && me.is_live) {
      const wasLive = !!bar;
      // If we weren't live before and now are, hard-reload to pull the embed.
      if (!wasLive) location.reload();
      else {
        document.getElementById('lb-views').textContent = formatBig(me.viewers || 0) + ' watching';
        document.getElementById('lb-uptime').textContent = formatUptime(me.uptime_mins);
        document.getElementById('lb-title').textContent = me.stream_title || '';
      }
    } else if (bar) {
      // Went offline — strip the embed banner.
      bar.remove();
      const wrap = document.getElementById('embed-wrap');
      if (wrap) wrap.remove();
    }
  } catch (e) { /* ignore */ }
}
function formatBig(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'k';return String(n)}
function formatUptime(m){if(!m)return '0m';const h=Math.floor(m/60),r=m%60;return h>0?h+'h '+r+'m':r+'m'}
setInterval(refreshLive, 60000);
</script>
</body>
</html>`;
}

function renderLiveBanner(handle, platform, e) {
  const embedUrl = platform === 'kick'
    ? `https://player.kick.com/${encodeURIComponent(handle)}`
    : `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=contentlore.com&autoplay=true&muted=true`;
  return `
    <div class="live-bar" id="live-bar">
      <div class="dot"></div>
      <span class="l-kicker">Live</span>
      <span class="l-title" id="lb-title">${esc(e.stream_title || '')}</span>
      <span class="l-meta">
        <span class="views" id="lb-views">${formatBig(e.viewers || 0)} watching</span>
        <span id="lb-uptime">${formatUptime(e.uptime_mins)}</span>
        ${e.game_name ? `<span>· ${esc(e.game_name)}</span>` : ''}
      </span>
    </div>
    <div class="embed-wrap" id="embed-wrap"><iframe src="${embedUrl}" allow="autoplay; fullscreen" allowfullscreen></iframe></div>
    <a id="live" style="position:absolute;visibility:hidden"></a>
  `;
}

function renderStats(s) {
  const lastStream = s.lastStreamAt ? timeAgo(s.lastStreamAt) : '—';
  return `
    <div class="stats">
      <div class="stat"><div class="v">${s.count}</div><div class="l">Sessions</div></div>
      <div class="stat"><div class="v">${s.hours}</div><div class="l">Hours streamed</div></div>
      <div class="stat"><div class="v">${formatBig(s.avgViewers)}</div><div class="l">Avg viewers</div><div class="extra">across all sessions</div></div>
      <div class="stat"><div class="v">${formatBig(s.peakViewers)}</div><div class="l">Peak viewers</div><div class="extra">last seen ${lastStream}</div></div>
    </div>
  `;
}

function renderClipCard(c) {
  return `
    <a class="clip" href="${esc(c.url)}" target="_blank" rel="noopener">
      <div class="clip-thumb">
        ${c.thumbnail_url ? `<img src="${esc(c.thumbnail_url)}" alt="" loading="lazy">` : ''}
        <span class="clip-vw">${formatBig(c.view_count)}</span>
      </div>
      <div class="clip-body">
        <div class="clip-title">${esc(c.title || 'Untitled clip')}</div>
        <div class="clip-when">${timeAgoIso(c.created_at)}</div>
      </div>
    </a>
  `;
}

function notFoundPage(handle) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found · ContentLore</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>body{background:oklch(0.09 0.04 295);color:oklch(0.97 0.02 320);font-family:'JetBrains Mono',monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-family:'Bebas Neue';font-size:96px;letter-spacing:4px;color:oklch(0.82 0.20 195);margin-bottom:8px}p{font-size:13px;text-transform:uppercase;letter-spacing:2px;color:oklch(0.55 0.06 295);margin-bottom:24px}a{color:oklch(0.82 0.20 195);text-decoration:none;font-size:11px;text-transform:uppercase;letter-spacing:2px;border:1px solid oklch(0.82 0.20 195);padding:10px 20px}a:hover{background:oklch(0.82 0.20 195);color:oklch(0.09 0.04 295)}</style>
</head><body><h1>404</h1><p>"${esc(handle)}" isn't on the curated UK GTA RP roster.</p><a href="/gta-rp/">← Back to roster</a></body></html>`;
  return new Response(body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ================================================================
// Helpers
// ================================================================

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBig(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function formatUptime(m) {
  if (!m) return '0m';
  const h = Math.floor(m / 60), r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}
function timeAgo(unixSec) {
  const diff = Math.max(0, Date.now() / 1000 - unixSec);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function timeAgoIso(iso) {
  if (!iso) return '';
  return timeAgo(Math.floor(new Date(iso).getTime() / 1000));
}

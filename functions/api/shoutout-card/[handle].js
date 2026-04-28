// ================================================================
// functions/api/shoutout-card/[handle].js
// GET /api/shoutout-card/{handle}
//
// Server-rendered HTML page that LOOKS like a 1200x630 social card.
// Used as the og:image target on creator profile pages so when
// someone pastes a profile URL the preview shows the creator's
// stats card. Browser-rendering services that respect HTML og:image
// will use it as-is; for proper PNG previews on Twitter/Discord
// we'd need a real image renderer (Cloudflare Browser Rendering)
// — that's deferred. The page itself doubles as a screenshot
// surface (dedicated "Download as image" button uses html2canvas).
//
// Off-allowlist handles get a branded 404. Stats come from D1
// stream_sessions for the current calendar month.
// ================================================================

const ALLOWLIST = [
  { handle: 'tyrone',           platform: 'twitch', name: 'Tyrone' },
  { handle: 'lbmm',             platform: 'twitch', name: 'LBMM' },
  { handle: 'reeclare',         platform: 'twitch', name: 'Reeclare' },
  { handle: 'stoker',           platform: 'twitch', name: 'Stoker' },
  { handle: 'samham',           platform: 'twitch', name: 'SamHam' },
  { handle: 'deggyuk',          platform: 'twitch', name: 'DeggyUK' },
  { handle: 'megsmary',         platform: 'twitch', name: 'MegsMary' },
  { handle: 'tazzthegeeza',     platform: 'twitch', name: 'TaZzTheGeeza' },
  { handle: 'wheelydev',        platform: 'twitch', name: 'WheelyDev' },
  { handle: 'rexality',         platform: 'twitch', name: 'RexaliTy' },
  { handle: 'steeel',           platform: 'twitch', name: 'Steeel' },
  { handle: 'justj0hnnyhd',     platform: 'twitch', name: 'JustJ0hnnyHD' },
  { handle: 'cherish_remedy',   platform: 'twitch', name: 'Cherish_Remedy' },
  { handle: 'lorddorro',        platform: 'twitch', name: 'LordDorro' },
  { handle: 'jck0__',           platform: 'twitch', name: 'JCK0__' },
  { handle: 'absthename',       platform: 'twitch', name: 'ABsTheName' },
  { handle: 'essellz',          platform: 'twitch', name: 'Essellz' },
  { handle: 'lewthescot',       platform: 'twitch', name: 'LewTheScot' },
  { handle: 'angels365',        platform: 'twitch', name: 'Angels365' },
  { handle: 'fantasiasfantasy', platform: 'twitch', name: 'FantasiasFantasy' },
  { handle: 'kavsual',          platform: 'kick',   name: 'Kavsual' },
  { handle: 'shammers',         platform: 'kick',   name: 'Shammers' },
  { handle: 'bags',             platform: 'kick',   name: 'Bags' },
  { handle: 'dynamoses',        platform: 'kick',   name: 'Dynamoses' },
  { handle: 'dcampion',         platform: 'kick',   name: 'DCampion' },
  { handle: 'elliewaller',      platform: 'kick',   name: 'EllieWaller' },
];

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
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s.name;
  return null;
}

function monthStartUnix() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

function fmtBig(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onRequestGet({ params, env, request }) {
  const handle = String(params.handle || '').toLowerCase();
  const entry = ALLOWLIST.find(c => c.handle === handle);
  if (!entry) {
    return new Response(notFoundHtml(handle), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  const start = monthStartUnix();
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // All curated handles' totals for the month (one query → rank).
  let allRanks = [];
  let myRows = [];
  try {
    const allRes = await env.DB.prepare(`
      SELECT cp.handle,
             SUM(ss.duration_mins) AS mins,
             MAX(ss.peak_viewers) AS peak,
             SUM(ss.duration_mins * ss.avg_viewers) AS weighted_avg_num,
             COUNT(*) AS sessions
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE ss.started_at >= ?
      GROUP BY ss.creator_id
    `).bind(start).all();
    allRanks = (allRes.results || [])
      .map(r => ({
        handle: String(r.handle).toLowerCase(),
        mins: Number(r.mins || 0),
        peak: Number(r.peak || 0),
        weighted: Number(r.weighted_avg_num || 0),
        sessions: Number(r.sessions || 0),
      }))
      .sort((a, b) => b.mins - a.mins);

    // Pull this creator's session rows for server detection.
    const myRes = await env.DB.prepare(`
      SELECT ss.final_title, ss.duration_mins
      FROM stream_sessions ss
      INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
      WHERE LOWER(cp.handle) = ?
        AND ss.started_at >= ?
    `).bind(handle, start).all();
    myRows = myRes.results || [];
  } catch { /* best-effort — fall through with zeros */ }

  const me = allRanks.find(r => r.handle === handle);
  const rank = me ? (allRanks.findIndex(r => r.handle === handle) + 1) : null;
  const hours = me ? Math.round(me.mins / 60) : 0;
  const peak = me ? me.peak : 0;
  const avg = me && me.mins > 0 ? Math.round(me.weighted / me.mins) : 0;
  const sessions = me ? me.sessions : 0;

  const serverCounts = new Map();
  for (const r of myRows) {
    const sv = detectServer(r.final_title);
    if (!sv) continue;
    serverCounts.set(sv, (serverCounts.get(sv) || 0) + 1);
  }
  const topServer = [...serverCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Try to get the avatar from the creators table (set during the
  // Twitch backfill — kicks may be null until they go live).
  let avatar = null;
  try {
    const r = await env.DB.prepare(`
      SELECT c.avatar_url
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id
      WHERE LOWER(cp.handle) = ?
      LIMIT 1
    `).bind(handle).first();
    avatar = r?.avatar_url || null;
  } catch { /* ignore */ }

  const platformLabel = entry.platform === 'kick' ? 'Kick' : 'Twitch';
  const platformColor = entry.platform === 'kick' ? 'oklch(0.82 0.22 145)' : 'oklch(0.65 0.25 295)';

  const rankBadge =
    rank == null ? { e: '📊', label: 'Unranked' } :
    rank === 1   ? { e: '🥇', label: '#1 of 26' } :
    rank === 2   ? { e: '🥈', label: '#2 of 26' } :
    rank === 3   ? { e: '🥉', label: '#3 of 26' } :
    rank <= 10   ? { e: '⭐', label: `#${rank} of 26` } :
                   { e: '📈', label: `#${rank} of 26` };

  const html = renderCard({
    handle, name: entry.name, platform: entry.platform, platformLabel, platformColor,
    avatar, monthLabel, hours, peak, avg, sessions, topServer, rank, rankBadge,
  });
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=600',
    },
  });
}

function renderCard(d) {
  const profileUrl = `/creator-profile/${d.handle}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(d.name)} — ${esc(d.monthLabel)} on ContentLore</title>
<meta name="description" content="${esc(d.name)} on ${esc(d.platformLabel)} — ${d.hours}h streamed in ${esc(d.monthLabel)}.">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(d.name)} — ${esc(d.monthLabel)} on ContentLore">
<meta property="og:description" content="${d.hours} hours streamed · peak ${fmtBig(d.peak)} viewers · ${d.sessions} sessions${d.topServer ? ` · ${esc(d.topServer)}` : ''}">
<meta property="og:image" content="https://contentlore.com/api/shoutout-card/${esc(d.handle)}">
<meta property="og:url" content="https://contentlore.com${profileUrl}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:oklch(0.10 0.04 190);--fg:oklch(0.97 0.02 320);
  --card:oklch(0.14 0.05 190);--card2:oklch(0.19 0.06 190);
  --ink-dim:oklch(0.78 0.05 320);--ink-faint:oklch(0.55 0.06 190);
  --signal:oklch(0.82 0.20 195);--signal-cyan:oklch(0.85 0.18 200);
  --border:oklch(0.28 0.06 190);
  --plat:${d.platformColor};
  --font-d:'Bebas Neue',Impact,sans-serif;--font-m:'JetBrains Mono',monospace;--font-b:'Inter',system-ui,sans-serif;
}
html,body{background:var(--bg);color:var(--fg);font-family:var(--font-b);min-height:100vh}
body{display:flex;flex-direction:column;align-items:center;padding:32px 16px;gap:16px}

/* Container fixed at 1200x630 — the card's "natural" social-share size.
   On smaller viewports we scale down with transform so screenshots
   still resemble what they'll look like in the OG preview. */
.shoutout-frame{position:relative;width:1200px;height:630px;flex-shrink:0;
  background:linear-gradient(135deg,var(--card),var(--bg));
  border:1px solid var(--signal);
  box-shadow:0 0 60px oklch(0.82 0.20 195/.25);
  overflow:hidden;
  transform-origin:top center}
@media(max-width:1240px){
  .shoutout-frame{transform:scale(calc(100vw / 1240));margin-bottom:calc((1 - (100vw / 1240)) * -630px)}
}

.shoutout-frame::before{content:'';position:absolute;inset:0;pointer-events:none;
  background-image:repeating-linear-gradient(0deg,oklch(0.82 0.20 195/.04) 0 1px,transparent 1px 3px);
  mix-blend-mode:screen}
.shoutout-frame::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 800px 600px at top right,oklch(0.82 0.20 195/.18),transparent 60%),
             radial-gradient(ellipse 600px 400px at bottom left,oklch(0.85 0.18 200/.10),transparent 70%)}

.diag{position:absolute;inset:0;opacity:.06;
  background-image:repeating-linear-gradient(135deg,var(--signal) 0 1px,transparent 1px 80px);
  pointer-events:none}

.brand{position:absolute;top:32px;left:40px;display:flex;align-items:center;gap:14px;z-index:5}
.brand img{height:44px;filter:brightness(1.1)}
.brand .b-text{font-family:var(--font-d);font-size:24px;letter-spacing:3px;color:var(--fg)}
.brand .b-text .cl{color:var(--signal)}
.brand .b-tag{font-family:var(--font-m);font-size:11px;letter-spacing:2px;color:var(--ink-faint);text-transform:uppercase;margin-top:2px}

.month-tag{position:absolute;top:40px;right:40px;font-family:var(--font-m);font-size:13px;letter-spacing:3px;color:var(--signal);text-transform:uppercase;padding:6px 14px;border:1px solid var(--signal);background:oklch(0.82 0.20 195/.10);z-index:5}

.body{position:absolute;inset:120px 40px 40px;display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center;z-index:4}
.av-wrap{display:flex;flex-direction:column;align-items:center;gap:14px}
.av{width:280px;height:280px;border-radius:50%;border:4px solid var(--signal);object-fit:cover;background:var(--card2);box-shadow:0 0 40px oklch(0.82 0.20 195/.4)}
.av-ph{width:280px;height:280px;border-radius:50%;border:4px solid var(--signal);background:var(--card2);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:120px;color:var(--signal);box-shadow:0 0 40px oklch(0.82 0.20 195/.4)}
.platform-pill{font-family:var(--font-m);font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:5px 12px;color:var(--plat);border:1px solid var(--plat);background:color-mix(in oklab,var(--plat) 12%,transparent)}

.info{min-width:0}
.kicker{font-family:var(--font-m);font-size:13px;letter-spacing:3px;text-transform:uppercase;color:var(--signal-cyan);margin-bottom:6px}
.name{font-family:var(--font-d);font-size:96px;letter-spacing:2px;line-height:.92;color:var(--fg);margin-bottom:16px;word-break:break-word;text-shadow:0 0 12px oklch(0.82 0.20 195/.25)}
.rank-badge{display:inline-flex;align-items:center;gap:10px;font-family:var(--font-d);font-size:30px;letter-spacing:1px;padding:8px 18px;background:oklch(0.82 0.20 195/.12);border:1px solid var(--signal);color:var(--signal);margin-bottom:24px}
.rank-badge .e{font-size:32px;line-height:1}

.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:760px}
.stat{background:var(--card);border:1px solid var(--border);padding:14px 18px;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
.stat .v{font-family:var(--font-d);font-size:42px;letter-spacing:1px;line-height:1;color:var(--signal-cyan)}
.stat .l{font-family:var(--font-m);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-faint);margin-top:6px}

.server-strip{margin-top:20px;font-family:var(--font-m);font-size:14px;letter-spacing:2px;color:var(--ink-dim);text-transform:uppercase}
.server-strip strong{color:var(--signal);font-weight:600}

.footer{position:absolute;bottom:24px;left:40px;right:40px;display:flex;justify-content:space-between;align-items:center;font-family:var(--font-m);font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-faint);z-index:5}
.footer .url{color:var(--signal)}
.footer .cta{color:var(--signal-cyan);font-weight:600}

/* PAGE CHROME (outside the card) — controls + back link */
.chrome{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;max-width:1200px}
.btn{font-family:var(--font-m);font-size:12px;text-transform:uppercase;letter-spacing:2px;padding:10px 18px;background:var(--card);border:1px solid var(--border);color:var(--fg);text-decoration:none;cursor:pointer;transition:all .15s}
.btn:hover{border-color:var(--signal);color:var(--signal)}
.btn-primary{background:var(--signal);color:var(--bg);border-color:var(--signal);font-weight:600}
.btn-primary:hover{box-shadow:0 0 18px oklch(0.82 0.20 195/.5)}
.btn.copied{border-color:var(--signal);color:var(--signal);background:oklch(0.82 0.20 195/.1)}
.note{font-family:var(--font-m);font-size:11px;letter-spacing:1.5px;color:var(--ink-faint);text-align:center;max-width:680px;line-height:1.6;text-transform:uppercase;margin-top:8px}
</style>
</head>
<body>

<div class="chrome">
  <a class="btn" href="${esc(profileUrl)}">← ${esc(d.name)}'s profile</a>
  <button class="btn btn-primary" id="dl-btn" type="button">⬇ Download as image</button>
  <button class="btn" id="copy-btn" type="button">Copy share link</button>
</div>

<div class="shoutout-frame" id="card-frame">
  <div class="diag"></div>
  <div class="brand">
    <img src="/logo.png" alt="ContentLore" loading="eager">
    <div>
      <div class="b-text"><span class="cl">CONTENT</span>LORE</div>
      <div class="b-tag">UK GTA RP · Streaming Intelligence</div>
    </div>
  </div>
  <div class="month-tag">${esc(d.monthLabel)}</div>

  <div class="body">
    <div class="av-wrap">
      ${d.avatar
        ? `<img class="av" src="${esc(d.avatar)}" alt="${esc(d.name)}" crossorigin="anonymous">`
        : `<div class="av-ph">${esc((d.name || '?').charAt(0))}</div>`}
      <span class="platform-pill">${esc(d.platformLabel)}</span>
    </div>
    <div class="info">
      <div class="kicker">UK GTA RP CREATOR</div>
      <div class="name">${esc(d.name)}</div>
      <div class="rank-badge"><span class="e">${d.rankBadge.e}</span> ${esc(d.rankBadge.label)}</div>
      <div class="stats">
        <div class="stat"><div class="v">${d.hours}</div><div class="l">Hours</div></div>
        <div class="stat"><div class="v">${fmtBig(d.peak)}</div><div class="l">Peak viewers</div></div>
        <div class="stat"><div class="v">${fmtBig(d.avg)}</div><div class="l">Avg viewers</div></div>
        <div class="stat"><div class="v">${d.sessions}</div><div class="l">Sessions</div></div>
      </div>
      <div class="server-strip">${d.topServer ? `Most-played server <strong>${esc(d.topServer)}</strong>` : 'Server affinity building this month'}</div>
    </div>
  </div>

  <div class="footer">
    <span>contentlore.com<span class="url">/creator-profile/${esc(d.handle)}</span></span>
    <span class="cta">📡 Track the UK GTA RP scene</span>
  </div>
</div>

<p class="note">Tip: tap "Download as image" or screenshot this card to share it. The card is sized 1200×630 — the same dimensions Twitter, Discord, and Facebook use for link previews.</p>

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script>
(function(){
  var dl = document.getElementById('dl-btn');
  var cp = document.getElementById('copy-btn');
  var frame = document.getElementById('card-frame');
  if (dl && frame && window.html2canvas) {
    dl.addEventListener('click', async function(){
      var orig = dl.textContent;
      dl.textContent = 'Rendering…';
      dl.disabled = true;
      try {
        // Reset transform on the frame for capture so html2canvas
        // grabs the native 1200x630 pixels regardless of viewport.
        var savedTransform = frame.style.transform;
        var savedMargin = frame.style.marginBottom;
        frame.style.transform = 'none';
        frame.style.marginBottom = '0';
        var canvas = await html2canvas(frame, {
          width: 1200, height: 630,
          backgroundColor: null,
          scale: 1,
          useCORS: true,
          logging: false,
        });
        frame.style.transform = savedTransform;
        frame.style.marginBottom = savedMargin;
        var url = canvas.toDataURL('image/png');
        var a = document.createElement('a');
        a.href = url;
        a.download = ${JSON.stringify(`contentlore-${d.handle}-${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}.png`)};
        document.body.appendChild(a);
        a.click();
        a.remove();
        dl.textContent = 'Downloaded ✓';
        setTimeout(function(){ dl.textContent = orig; dl.disabled = false; }, 1800);
      } catch (e) {
        console.error(e);
        dl.textContent = 'Failed — screenshot instead';
        setTimeout(function(){ dl.textContent = orig; dl.disabled = false; }, 2400);
      }
    });
  } else if (dl) {
    // html2canvas didn't load (CSP, offline). Fall back to a hint.
    dl.textContent = 'Screenshot to share';
    dl.disabled = true;
  }
  if (cp) {
    cp.addEventListener('click', async function(){
      var url = location.href;
      try { await navigator.clipboard.writeText(url); }
      catch (e) {
        var ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      var orig = cp.textContent;
      cp.textContent = 'Copied ✓';
      cp.classList.add('copied');
      setTimeout(function(){ cp.textContent = orig; cp.classList.remove('copied'); }, 1800);
    });
  }
})();
</script>
</body>
</html>`;
}

function notFoundHtml(handle) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found · ContentLore</title>
<style>body{background:oklch(0.10 0.04 190);color:oklch(0.97 0.02 320);font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-size:64px;margin-bottom:8px;color:oklch(0.82 0.20 195)}p{color:oklch(0.55 0.06 190)}</style>
</head><body><h1>404</h1><p>"${esc(handle)}" isn't on the curated UK GTA RP roster.</p></body></html>`;
}

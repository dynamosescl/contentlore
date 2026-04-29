// ================================================================
// functions/api/widget/[handle].js
// GET /api/widget/{handle}
//
// Returns a self-contained 300×100 HTML card meant to be embedded
// in a creator's linktree / website / Twitter card via:
//
//   <iframe src="https://contentlore.com/api/widget/tyrone"
//           width="300" height="100" frameborder="0"></iframe>
//
// Shows: avatar, display name, live status (red LIVE pill +
// viewer count, or grey OFFLINE), platform badges, "Powered by
// ContentLore" footer link. Auto-refreshes every 60s via meta
// refresh + a tiny inline poll for sub-page updates.
//
// 60-second edge cache so 100 simultaneous widget loads map to
// at most 1 live-state hit.
// ================================================================

import { getCuratedEntry } from '../../_curated.js';

const CACHE_TTL = 60;

const ESC = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtN(n) {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}

function badPage(title) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Widget — not found</title>
  <style>html,body{margin:0;padding:0;background:#0d1f1f;color:#7e8895;font:12px/1.4 'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;letter-spacing:1px;text-transform:uppercase}</style>
  </head><body>${ESC(title)}</body></html>`;
  return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet({ params, env, waitUntil }) {
  const raw = String(params.handle || '').toLowerCase().trim();
  if (!raw) return badPage('Streamer not specified');

  const entry = await getCuratedEntry(env, raw);
  if (!entry) return badPage('Streamer not tracked');

  // Edge cache key includes the handle.
  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/widget/${encodeURIComponent(raw)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Live state via the same-origin cached endpoint.
  let live = null;
  let avatar = null;
  let display = entry.display_name;
  try {
    const r = await fetch('https://contentlore.com/api/uk-rp-live');
    const d = await r.json();
    const me = (d.live || []).find(c => c.handle === entry.handle);
    if (me) {
      live = me;
      avatar = me.avatar_url || null;
      display = me.display_name || display;
    }
  } catch { /* offline render */ }

  // Platform pills derived from the curated socials.
  const socials = entry.socials || {};
  const platforms = [];
  if (socials.twitch) platforms.push({ key: 'twitch', label: 'TW', url: `https://twitch.tv/${socials.twitch}` });
  if (socials.kick)   platforms.push({ key: 'kick',   label: 'KK', url: `https://kick.com/${socials.kick}` });
  if (socials.youtube)platforms.push({ key: 'youtube', label: 'YT', url: `https://youtube.com/@${socials.youtube}` });
  if (socials.tiktok) platforms.push({ key: 'tiktok',  label: 'TT', url: `https://tiktok.com/@${socials.tiktok}` });

  const profileUrl = `https://contentlore.com/creator-profile/${entry.handle}`;
  const isLive = !!(live && live.is_live);
  const viewers = isLive ? Number(live.viewers || 0) : 0;
  const initial = (display || '?').charAt(0).toUpperCase();
  const platHtml = platforms.map(p =>
    `<a href="${ESC(p.url)}" target="_blank" rel="noopener" class="p p-${p.key}">${ESC(p.label)}</a>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${ESC(display)} — ContentLore widget</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="refresh" content="120">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;height:100%;overflow:hidden}
body{font-family:'JetBrains Mono',monospace;-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:inherit}
.w{width:300px;height:100px;background:linear-gradient(135deg,oklch(0.10 0.04 195) 0%,oklch(0.14 0.05 200) 100%);
  border:1px solid oklch(0.28 0.06 195);position:relative;overflow:hidden;color:oklch(0.97 0.02 320);
  display:grid;grid-template-rows:1fr auto;
  clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)}
.w::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle at top right,oklch(0.82 0.20 195/.10),transparent 60%)}
.row{display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;padding:10px 12px 6px;position:relative;z-index:1}
.av{width:48px;height:48px;border-radius:50%;border:2px solid oklch(0.82 0.20 195);object-fit:cover;background:oklch(0.18 0.06 195)}
.av-ph{width:48px;height:48px;border-radius:50%;border:2px solid oklch(0.82 0.20 195);background:oklch(0.18 0.06 195);
  display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',Impact,sans-serif;font-size:22px;color:oklch(0.82 0.20 195)}
.name{min-width:0}
.name .nm{font-family:'Bebas Neue',Impact,sans-serif;font-size:20px;letter-spacing:1.2px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.name .sub{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:oklch(0.55 0.06 195);margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.live-pill{background:oklch(0.65 0.27 25);color:#fff;font-size:11px;letter-spacing:1.5px;padding:3px 6px;font-weight:600;display:flex;align-items:center;gap:5px;text-transform:uppercase;flex-shrink:0}
.live-pill::before{content:'';width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 4px #fff;animation:pulse 1.4s infinite}
.off-pill{background:oklch(0.18 0.06 195);color:oklch(0.55 0.06 195);font-size:11px;letter-spacing:1.5px;padding:3px 6px;text-transform:uppercase;border:1px solid oklch(0.28 0.06 195);flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.viewers{font-family:'Bebas Neue',Impact,sans-serif;font-size:18px;color:oklch(0.85 0.18 200);text-shadow:0 0 8px oklch(0.85 0.18 200/.4);line-height:1}
.viewers .vlbl{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:1px;color:oklch(0.55 0.06 195);text-transform:uppercase;display:block;margin-top:1px;text-align:right}
.foot{display:flex;justify-content:space-between;align-items:center;padding:5px 12px 7px;border-top:1px solid oklch(0.28 0.06 195/.5);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:oklch(0.55 0.06 195);position:relative;z-index:1}
.plats{display:flex;gap:4px}
.p{padding:2px 5px;font-size:11px;font-weight:600;letter-spacing:1px;border:1px solid;border-radius:2px}
.p-twitch{color:oklch(0.78 0.20 295);border-color:oklch(0.65 0.25 295/.6)}
.p-kick{color:oklch(0.82 0.22 145);border-color:oklch(0.82 0.22 145/.6)}
.p-youtube{color:oklch(0.68 0.22 25);border-color:oklch(0.68 0.22 25/.6)}
.p-tiktok{color:oklch(0.88 0.02 320);border-color:oklch(0.55 0.06 195)}
.poweredby{color:oklch(0.55 0.06 195)}
.poweredby:hover{color:oklch(0.85 0.18 200)}
.profile-link{position:absolute;inset:0;z-index:0}
</style>
</head>
<body>
<div class="w">
  <a class="profile-link" href="${ESC(profileUrl)}" target="_blank" rel="noopener" aria-label="${ESC(display)} profile"></a>
  <div class="row">
    ${avatar
      ? `<img class="av" src="${ESC(avatar)}" alt="${ESC(display)}" loading="lazy">`
      : `<div class="av-ph">${ESC(initial)}</div>`}
    <div class="name">
      <div class="nm">${ESC(display)}</div>
      <div class="sub">
        ${isLive
          ? `<span class="live-pill">LIVE</span><span>${ESC(live.platform || '')}</span>`
          : `<span class="off-pill">Offline</span>`}
      </div>
    </div>
    ${isLive
      ? `<div class="viewers">${ESC(fmtN(viewers))}<span class="vlbl">watching</span></div>`
      : ''}
  </div>
  <div class="foot">
    <div class="plats">${platHtml}</div>
    <a class="poweredby" href="https://contentlore.com" target="_blank" rel="noopener">contentlore.com</a>
  </div>
</div>
<script>
// Soft-refresh every 60s in case the embedding page caches us.
setTimeout(function(){ location.reload(); }, 60000);
</script>
</body>
</html>`;

  const response = new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, s-maxage=${CACHE_TTL}`,
      // Permit embedding on any site.
      'x-frame-options': 'ALLOWALL',
      'content-security-policy': "frame-ancestors *",
    },
  });
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

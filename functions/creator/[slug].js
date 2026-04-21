// ================================================================
// functions/creator/[slug].js
// GET /creator/:slug
// Server-rendered creator profile with v2 design system.
// Includes: Vault (lore entries), 30-day momentum sparklines,
// live platform data, OG meta.
// ================================================================

import { htmlResponse, escapeHtml, formatCount } from '../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return new Response('Not found', { status: 404 });

  try {
    // Fetch all data in parallel
    const [creator, platformsResult, loreResult, snapshotsResult, latestSnap] = await Promise.all([
      env.DB.prepare(`SELECT * FROM creators WHERE id = ?`).bind(slug).first(),
      env.DB.prepare(
        `SELECT platform, handle, is_primary, verified, verified_at
         FROM creator_platforms WHERE creator_id = ?
         ORDER BY is_primary DESC, platform ASC`
      ).bind(slug).all(),
      env.DB.prepare(
        `SELECT title, body, entry_type, entry_date 
         FROM lore_entries WHERE creator_id = ?
         ORDER BY entry_date DESC, created_at DESC LIMIT 10`
      ).bind(slug).all(),
      env.DB.prepare(
        `SELECT platform, followers, viewers, captured_at
         FROM snapshots
         WHERE creator_id = ? AND captured_at > ?
         ORDER BY captured_at ASC`
      ).bind(slug, Math.floor(Date.now() / 1000) - 30 * 86400).all(),
      env.DB.prepare(
        `SELECT platform, followers, viewers FROM snapshots 
         WHERE creator_id = ? AND followers IS NOT NULL
         ORDER BY captured_at DESC LIMIT 1`
      ).bind(slug).first(),
    ]);

    if (!creator) {
      return new Response(renderNotFound(slug), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    const platforms = platformsResult.results || [];
    const lore = loreResult.results || [];
    const snapshots = snapshotsResult.results || [];

    // Group snapshots by platform for sparklines
    const byPlatform = {};
    for (const s of snapshots) {
      if (!byPlatform[s.platform]) byPlatform[s.platform] = [];
      if (s.followers != null) byPlatform[s.platform].push(s);
    }

    // Calculate 30-day delta + current follower totals per platform
    const platformMomentum = {};
    for (const [p, series] of Object.entries(byPlatform)) {
      if (series.length < 2) continue;
      const first = series[0].followers;
      const last = series[series.length - 1].followers;
      platformMomentum[p] = {
        current: last,
        delta: last - first,
        series,
      };
    }

    const displayName = creator.display_name || slug;
    const bio = creator.bio || `UK streaming creator on ContentLore.`;
    const categories = creator.categories
      ? creator.categories.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // Total current followers across all platforms
    const totalFollowers = Object.values(platformMomentum).reduce(
      (sum, pm) => sum + (pm.current || 0), 0
    );
    const total7dDelta = Object.values(platformMomentum).reduce(
      (sum, pm) => sum + (pm.delta || 0), 0
    );

    const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(displayName)} · ContentLore</title>
<meta name="description" content="${escapeHtml(bio.substring(0, 200))}">
<meta name="theme-color" content="#0A0A0B">

<meta property="og:title" content="${escapeHtml(displayName)} · ContentLore">
<meta property="og:description" content="${escapeHtml(bio.substring(0, 200))}">
<meta property="og:type" content="profile">
<meta property="og:url" content="https://contentlore.com/creator/${escapeHtml(slug)}">
<meta property="og:site_name" content="ContentLore">
<meta property="og:image" content="https://contentlore.com/api/og/creator/${escapeHtml(slug)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(displayName)} · ContentLore">
<meta name="twitter:description" content="${escapeHtml(bio.substring(0, 200))}">
<meta name="twitter:image" content="https://contentlore.com/api/og/creator/${escapeHtml(slug)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500;1,9..144,600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<div class="cl-app">

  <aside class="cl-sidebar">
    <a href="/" class="cl-masthead">Content<em>Lore</em><span class="cl-mark"></span></a>
    <div class="cl-masthead-sub">The UK Streaming Desk · Est. 2026</div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Sections</div>
      <ul class="cl-nav-list">
        <li><a href="/people/" class="active">People <span class="cl-count">285</span></a></li>
        <li><a href="/places/">Places <span class="cl-count">soon</span></a></li>
        <li><a href="/platforms/">Platforms <span class="cl-count">04</span></a></li>
        <li><a href="/community/">Community <span class="cl-count">soon</span></a></li>
      </ul>
    </div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Read</div>
      <ul class="cl-nav-list">
        <li><a href="/discover/" class="small">Discover</a></li>
        <li><a href="/the-platform/" class="small">The Platform</a></li>
        <li><a href="/ledger/" class="small">The Ledger</a></li>
        <li><a href="/gta-rp/" class="small">GTA RP</a></li>
      </ul>
    </div>

    <div class="cl-live-stat" id="live-stat">
      <div class="cl-live-stat-head">
        <span class="cl-live-dot"></span>
        Live signal
      </div>
      <div class="cl-live-stat-body">
        <strong id="live-count">—</strong> creators live right now<br>
        across Twitch and Kick.
      </div>
      <div class="cl-live-stat-breakdown">
        <span><i class="platform-square twitch"></i> <span id="live-twitch">—</span></span>
        <span><i class="platform-square kick"></i> <span id="live-kick">—</span></span>
      </div>
    </div>

    <div class="cl-network-sidebar" id="cl-network-sidebar" data-creator-id="${escapeHtml(slug)}">
      <div class="cl-network-head">\u25c6 Network</div>
      <div class="cl-network-stats">
        <div class="cl-network-stat">
          <span class="cl-network-stat-num" id="cl-net-inbound">\u2014</span>
          <span class="cl-network-stat-label">Inbound</span>
        </div>
        <div class="cl-network-stat">
          <span class="cl-network-stat-num" id="cl-net-outbound">\u2014</span>
          <span class="cl-network-stat-label">Outbound</span>
        </div>
      </div>
      <div class="cl-network-list" id="cl-network-list">
        <div class="cl-network-empty">Loading connections\u2026</div>
      </div>
    </div>

    <div class="cl-signoff">
      <a href="/about/">About</a> · <a href="/ethics/">Ethics</a><br>
      <a href="/contact/">Contact</a> · <a href="/claim">Claim profile</a><br><br>
      © ContentLore 2026<br>
      Independent UK publication
    </div>
  </aside>

  <main class="cl-main">

    <div class="cl-topbar">
      <div class="cl-topbar-left">
        <span><a href="/people/" style="color: inherit; text-decoration: none;">← People</a></span>
        <span>Profile</span>
      </div>
      <div><span class="cl-live-inline">Tracked</span></div>
    </div>

    <section class="cl-creator">
      <div class="cl-creator-kicker">${escapeHtml(categories[0] || 'UK Creator')} · Profile</div>
      <div class="cl-creator-hero">
        ${creator.avatar_url ? `
          <div class="cl-creator-avatar platform-${escapeHtml((platforms[0]?.platform) || '')}">
            <img src="${escapeHtml(creator.avatar_url)}" alt="${escapeHtml(displayName)}" onerror="this.style.display='none';this.parentElement.classList.add('cl-creator-avatar--fallback');this.parentElement.innerHTML='<span>${escapeHtml((displayName || '?').charAt(0).toUpperCase())}</span>';">
          </div>
        ` : `
          <div class="cl-creator-avatar platform-${escapeHtml((platforms[0]?.platform) || '')} cl-creator-avatar--fallback">
            <span>${escapeHtml((displayName || '?').charAt(0).toUpperCase())}</span>
          </div>
        `}
        <div class="cl-creator-hero-text">
          <h1>${escapeHtml(displayName)}</h1>
          <p class="cl-creator-bio">${escapeHtml(bio)}</p>
        </div>
      </div>

      <div class="cl-creator-platforms">
        ${platforms.map(p => `
          <a class="cl-creator-platform-chip" 
             href="${p.platform === 'twitch' ? `https://twitch.tv/${escapeHtml(p.handle)}` : `https://kick.com/${escapeHtml(p.handle)}`}" 
             target="_blank" rel="noopener">
            <span class="cl-p-label ${escapeHtml(p.platform)}">${escapeHtml(p.platform.toUpperCase())}</span>
            <span class="cl-p-handle">@${escapeHtml(p.handle)}</span>
            ${p.verified ? '<span class="cl-p-verified">✓ Verified</span>' : ''}
          </a>
        `).join('')}
      </div>

      ${totalFollowers > 0 ? `
      <div class="cl-creator-stats">
        <div class="cl-creator-stat">
          <div class="cl-creator-stat-label">Total followers</div>
          <div class="cl-creator-stat-value">${escapeHtml(formatCount(totalFollowers))}</div>
          <div class="cl-creator-stat-sub">Across all platforms</div>
        </div>
        ${total7dDelta !== 0 ? `
        <div class="cl-creator-stat">
          <div class="cl-creator-stat-label">30-day momentum</div>
          <div class="cl-creator-stat-value ${total7dDelta > 0 ? 'signal' : ''}">${total7dDelta > 0 ? '+' : ''}${total7dDelta.toLocaleString('en-GB')}</div>
          <div class="cl-creator-stat-sub">Follower delta</div>
        </div>
        ` : ''}
        <div class="cl-creator-stat">
          <div class="cl-creator-stat-label">Platforms</div>
          <div class="cl-creator-stat-value">${platforms.length}</div>
          <div class="cl-creator-stat-sub">${platforms.map(p => p.platform).join(' · ').toUpperCase()}</div>
        </div>
        <div class="cl-creator-stat">
          <div class="cl-creator-stat-label">Snapshots</div>
          <div class="cl-creator-stat-value">${snapshots.length}</div>
          <div class="cl-creator-stat-sub">Last 30 days</div>
        </div>
      </div>
      ` : ''}

      ${Object.keys(platformMomentum).length > 0 ? `
      <section class="cl-creator-momentum">
        <div class="cl-creator-momentum-head">
          <h2>30-day <em>momentum</em></h2>
          <div style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.15em; color: var(--text-3); text-transform: uppercase;">Follower trajectory</div>
        </div>
        ${Object.entries(platformMomentum).map(([platform, pm]) => {
          const points = renderSparklinePoints(pm.series, 700, 56);
          const deltaClass = pm.delta >= 0 ? 'up' : 'down';
          const deltaSign = pm.delta >= 0 ? '+' : '';
          return `
          <div class="cl-sparkline-row">
            <div class="cl-sr-meta">
              <span class="cl-platform-chip ${escapeHtml(platform)}">${escapeHtml(platform.toUpperCase())}</span>
              <span class="cl-sr-current">${escapeHtml(formatCount(pm.current))}</span>
            </div>
            <svg class="cl-sr-chart" viewBox="0 0 700 56" preserveAspectRatio="none">
              <polyline points="${points}" fill="none" stroke="${pm.delta >= 0 ? '#E8B04A' : '#E63946'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="cl-sr-delta ${deltaClass}">${deltaSign}${pm.delta.toLocaleString('en-GB')}</div>
          </div>
          `;
        }).join('')}
      </section>
      ` : ''}

      <section class="cl-creator-edges" id="cl-creator-edges" data-creator-id="${escapeHtml(slug)}" style="display: none;">
        <div class="cl-creator-edges-head">
          <span class="cl-creator-edges-label">\u25c6 Scene connections</span>
          <span class="cl-creator-edges-meta" id="cl-creator-edges-meta"></span>
        </div>
        <div class="cl-creator-edges-body" id="cl-creator-edges-body"></div>
      </section>

      ${lore.length > 0 ? `
      <section class="cl-vault">
        <h2>The <em>Vault</em></h2>
        ${lore.map(l => `
          <article class="cl-vault-entry">
            <div class="cl-vault-entry-date">${escapeHtml(l.entry_date || '')}</div>
            <div>
              <h3>${escapeHtml(l.title)}</h3>
              <p>${escapeHtml(l.body || '')}</p>
            </div>
          </article>
        `).join('')}
      </section>
      ` : ''}

    </section>

    <footer class="cl-footer-v2">
      <div>ContentLore · Independent UK streaming publication</div>
      <div>
        <a href="/about/">About</a> ·
        <a href="/ethics/">Ethics</a> ·
        <a href="/contact/">Contact</a>
      </div>
    </footer>

  </main>
</div>

<script src="/assets/livecount.js" defer></script>
<script src="/assets/network.js" defer></script>
</body>
</html>`;

    return htmlResponse(html);
  } catch (err) {
    return new Response(renderError(err), {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

function renderSparklinePoints(series, width, height) {
  if (!series || series.length < 2) return '';
  const values = series.map(s => s.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const pad = 4;
  return series.map((s, i) => {
    const x = pad + (i / (series.length - 1)) * (width - 2 * pad);
    const y = height - pad - ((s.followers - min) / range) * (height - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function renderNotFound(slug) {
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="UTF-8"><title>Not found · ContentLore</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head><body>
<div class="cl-app">
  <aside class="cl-sidebar">
    <a href="/" class="cl-masthead">Content<em>Lore</em><span class="cl-mark"></span></a>
    <div class="cl-masthead-sub">The UK Streaming Desk · Est. 2026</div>
  </aside>
  <main class="cl-main">
    <div class="cl-error">
      <h1>Not <em>in the index.</em></h1>
      <p>No UK creator matches <code style="font-family: var(--font-mono); color: var(--signal);">${escapeHtml(slug)}</code> in the ContentLore directory. If that's you, you can claim your profile in under two minutes.</p>
      <a href="/claim">Claim a profile →</a>
      &nbsp;&nbsp;
      <a href="/people/">Browse the directory →</a>
    </div>
  </main>
</div>
</body></html>`;
}

function renderError(err) {
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="UTF-8"><title>Error · ContentLore</title>
<link rel="stylesheet" href="/styles.css"></head>
<body><div class="cl-app"><main class="cl-main"><div class="cl-error">
<h1>Something <em>broke.</em></h1>
<p style="font-family: monospace; font-size: 13px;">${escapeHtml(String(err?.message || err))}</p>
<a href="/">← Back home</a>
</div></main></div></body></html>`;
}

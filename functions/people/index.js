// ================================================================
// functions/people/index.js
// GET /people/
// Directory of all verified UK creators in the ContentLore catalogue.
// Filterable, clickable — every card is a link to /creator/:slug.
// ================================================================

import { htmlResponse, escapeHtml, formatCount } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const platformFilter = url.searchParams.get('platform');

  try {
    let sql = `
      SELECT 
        c.id,
        c.display_name,
        c.bio,
        c.categories,
        c.avatar_url,
        cp.platform AS primary_platform,
        cp.handle AS primary_handle,
        cp.verified,
        (SELECT followers FROM snapshots 
         WHERE creator_id = c.id AND followers IS NOT NULL 
         ORDER BY captured_at DESC LIMIT 1) AS current_followers
      FROM creators c
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE c.role = 'creator'
    `;
    const params = [];
    if (platformFilter && ['twitch', 'kick'].includes(platformFilter)) {
      sql += ` AND cp.platform = ?`;
      params.push(platformFilter);
    }
    sql += ` ORDER BY current_followers DESC NULLS LAST, c.display_name COLLATE NOCASE ASC`;

    const result = await env.DB.prepare(sql).bind(...params).all();
    const creators = result.results || [];

    // Totals for the header
    const totalCount = creators.length;
    const twitchCount = creators.filter(c => c.primary_platform === 'twitch').length;
    const kickCount = creators.filter(c => c.primary_platform === 'kick').length;
    const totalFollowers = creators.reduce((sum, c) => sum + (c.current_followers || 0), 0);

    const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>People · ${totalCount} UK creators · ContentLore</title>
<meta name="description" content="The ContentLore directory of ${totalCount} UK streaming creators on Twitch and Kick. Editorial intelligence on the British streaming scene.">
<meta name="theme-color" content="#0A0A0B">

<meta property="og:title" content="People · ${totalCount} UK creators tracked · ContentLore">
<meta property="og:description" content="Directory of ${totalCount} UK streaming creators. ${formatCount(totalFollowers)} combined followers.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://contentlore.com/people/">
<meta property="og:site_name" content="ContentLore">
<meta property="og:image" content="https://contentlore.com/api/og/home">

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
        <li><a href="/people/" class="active">People <span class="cl-count">${totalCount}</span></a></li>
        <li><a href="/places/">Places <span class="cl-count">soon</span></a></li>
        <li><a href="/platforms/">Platforms <span class="cl-count">04</span></a></li>
        <li><a href="/community/">Community <span class="cl-count">soon</span></a></li>
      </ul>
    </div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Filter</div>
      <ul class="cl-nav-list">
        <li><a href="/people/" class="small${!platformFilter ? ' active' : ''}">All platforms</a></li>
        <li><a href="/people/?platform=twitch" class="small${platformFilter === 'twitch' ? ' active' : ''}">Twitch only <span class="cl-count">${twitchCount}</span></a></li>
        <li><a href="/people/?platform=kick" class="small${platformFilter === 'kick' ? ' active' : ''}">Kick only <span class="cl-count">${kickCount}</span></a></li>
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
        <span><strong>Directory</strong></span>
        <span>People · ${totalCount} creators</span>
        ${platformFilter ? `<span style="color: var(--signal);">Filter: ${escapeHtml(platformFilter.toUpperCase())}</span>` : ''}
      </div>
      <div><a href="/claim" style="color: var(--signal); text-decoration: none;">Claim profile →</a></div>
    </div>

    <section class="cl-people">
      <div class="cl-people-header">
        <h1>The <em>people</em> of UK streaming.</h1>
        <p class="cl-people-dek">Every verified UK creator in the ContentLore catalogue. Click through for editorial profile, platform details, and 30-day momentum.</p>
      </div>

      <div class="cl-people-meta">
        <div class="cl-people-meta-item">
          <span class="label">Creators</span>
          <span class="value signal">${totalCount}</span>
        </div>
        <div class="cl-people-meta-item">
          <span class="label">On Twitch</span>
          <span class="value">${twitchCount}</span>
        </div>
        <div class="cl-people-meta-item">
          <span class="label">On Kick</span>
          <span class="value">${kickCount}</span>
        </div>
        <div class="cl-people-meta-item">
          <span class="label">Combined followers</span>
          <span class="value">${formatCount(totalFollowers)}</span>
        </div>
      </div>

      ${creators.length === 0 ? `
        <p style="padding: 64px 0; color: var(--text-3); font-family: var(--font-mono); font-size: 14px;">No creators match this filter.</p>
      ` : `
      <div class="cl-people-grid">
        ${creators.map(c => {
          const platform = (c.primary_platform || '').toLowerCase();
          const platformClass = ['twitch','kick','youtube','tiktok'].includes(platform) ? platform : '';
          const bio = c.bio ? c.bio.substring(0, 140) + (c.bio.length > 140 ? '…' : '') : '';
          return `
          <a href="/creator/${escapeHtml(c.id)}" class="cl-person-card">
            <div class="cl-person-card-head">
              <div class="cl-person-identity">
                ${c.avatar_url
                  ? `<span class="cl-card-avatar ${platformClass}">
                       <img src="${escapeHtml(c.avatar_url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                       <span class="cl-card-avatar-fallback" style="display:none;">${escapeHtml((c.display_name || c.id || '?').charAt(0).toUpperCase())}</span>
                     </span>`
                  : `<span class="cl-card-avatar ${platformClass} cl-card-avatar--initial">
                       <span class="cl-card-avatar-fallback">${escapeHtml((c.display_name || c.id || '?').charAt(0).toUpperCase())}</span>
                     </span>`}
                <div>
                  <div class="cl-person-name">${escapeHtml(c.display_name || c.id)}</div>
                  <div class="cl-person-handle">@${escapeHtml(c.primary_handle || c.id)}</div>
                </div>
              </div>
              ${platformClass ? `<span class="cl-platform-chip ${platformClass}">${escapeHtml(platform.toUpperCase())}</span>` : ''}
            </div>
            ${bio ? `<p>${escapeHtml(bio)}</p>` : '<p class="cl-muted" style="font-style: italic;">No bio yet.</p>'}
            <div class="cl-person-stat">
              <span>Followers</span>
              <strong>${c.current_followers ? formatCount(c.current_followers) : '—'}</strong>
            </div>
          </a>
          `;
        }).join('')}
      </div>
      `}
    </section>

    <section class="cl-claim-cta">
      <div class="cl-claim-cta-inner">
        <div class="cl-claim-cta-label">\u25c6 Are you on this list?</div>
        <h2 class="cl-claim-cta-title">Claim your <em>profile</em>.</h2>
        <p class="cl-claim-cta-dek">If you\u2019re a UK streamer we cover, claim your page. You get to edit your bio, add your other platforms, link your Discord and socials, and \u2014 for verified creators \u2014 submit canonical clips for The Vault.</p>
        <div class="cl-claim-cta-row">
          <a href="/claim" class="cl-claim-cta-btn">Claim your profile \u2192</a>
          <a href="/about/" class="cl-claim-cta-link">What is ContentLore?</a>
        </div>
      </div>
    </section>

    <footer class="cl-footer-v2">
      <div>ContentLore · Independent UK streaming publication</div>
      <div>
        <a href="/about/">About</a> ·
        <a href="/ethics/">Ethics</a> ·
        <a href="/contact/">Contact</a> ·
        <a href="/claim">Claim profile</a>
      </div>
    </footer>

  </main>
</div>

<script src="/assets/livecount.js" defer></script>
</body>
</html>`;

    return htmlResponse(html);
  } catch (err) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family: monospace; padding: 40px; background: #0A0A0B; color: #F2F2F0;"><h1>Error loading directory</h1><pre>${escapeHtml(String(err?.message || err))}</pre><a href="/" style="color: #E8B04A;">← Home</a></body></html>`,
      { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
}

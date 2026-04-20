// ================================================================
// functions/creator/[slug].js
// GET /creator/:slug
// Server-renders the creator profile page. Injects real D1 data
// directly into the HTML (no client-side roundtrip for initial load).
// Writes OG/Twitter meta tags per creator so share cards show properly.
// ================================================================

import { htmlResponse, escapeHtml, formatCount } from '../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return new Response('Not found', { status: 404 });

  try {
    const creator = await env.DB
      .prepare(`SELECT * FROM creators WHERE id = ?`)
      .bind(slug)
      .first();
    if (!creator) return new Response(renderNotFound(slug), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const platformsResult = await env.DB
      .prepare(
        `SELECT platform, handle, is_primary, verified 
         FROM creator_platforms WHERE creator_id = ?
         ORDER BY is_primary DESC, platform ASC`
      )
      .bind(slug)
      .all();
    const platforms = platformsResult.results || [];

    const loreResult = await env.DB
      .prepare(
        `SELECT title, body, entry_type, entry_date 
         FROM lore_entries WHERE creator_id = ?
         ORDER BY entry_date DESC LIMIT 5`
      )
      .bind(slug)
      .all();
    const lore = loreResult.results || [];

    // Latest snapshot for follower count display
    const latestSnap = await env.DB
      .prepare(
        `SELECT platform, followers FROM snapshots 
         WHERE creator_id = ? AND followers IS NOT NULL
         ORDER BY captured_at DESC LIMIT 1`
      )
      .bind(slug)
      .first();

    const displayName = creator.display_name || slug;
    const bio = creator.bio || `UK streaming creator on ContentLore.`;
    const accent = creator.accent_colour || '#D4A574';
    const categories = creator.categories
      ? creator.categories.split(',').map((s) => s.trim())
      : [];

    const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(displayName)} · ContentLore</title>
<meta name="description" content="${escapeHtml(bio.substring(0, 200))}">
<meta name="theme-color" content="#0A0A0B">

<!-- Open Graph -->
<meta property="og:title" content="${escapeHtml(displayName)} · ContentLore">
<meta property="og:description" content="${escapeHtml(bio.substring(0, 200))}">
<meta property="og:type" content="profile">
<meta property="og:url" content="https://contentlore.com/creator/${escapeHtml(slug)}">
<meta property="og:site_name" content="ContentLore">
<meta property="og:image" content="https://contentlore.com/api/og/creator/${escapeHtml(slug)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(displayName)} · ContentLore">
<meta name="twitter:description" content="${escapeHtml(bio.substring(0, 200))}">
<meta name="twitter:image" content="https://contentlore.com/api/og/creator/${escapeHtml(slug)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<nav class="cl-nav">
  <a href="/" class="cl-nav-brand">
    <span class="cl-wordmark">ContentLore<span class="dot">.</span></span>
  </a>
  <div class="cl-nav-links">
    <a href="/gta-rp/">GTA RP</a>
    <a href="/the-platform/">The Platform</a>
    <a href="/claim">Claim</a>
    <a href="/ethics/">Ethics</a>
    <a href="/ledger/">Ledger</a>
  </div>
</nav>

<main class="cl-creator-profile" style="--creator-accent: ${escapeHtml(accent)};">
  <section class="cl-creator-hero">
    <div class="cl-creator-eyebrow">
      <span class="cl-kicker">UK Creator</span>
      ${categories.length ? `<span class="cl-category-chip">${escapeHtml(categories[0])}</span>` : ''}
    </div>
    <h1 class="cl-creator-name">${escapeHtml(displayName)}</h1>
    <p class="cl-creator-bio">${escapeHtml(bio)}</p>

    <div class="cl-creator-platforms">
      ${platforms.map((p) => `
        <a class="cl-platform-chip ${p.verified ? 'verified' : ''}" 
           href="${p.platform === 'twitch' ? `https://twitch.tv/${escapeHtml(p.handle)}` : `https://kick.com/${escapeHtml(p.handle)}`}" 
           target="_blank" rel="noopener">
          <span class="cl-platform-label">${escapeHtml(p.platform.toUpperCase())}</span>
          <span class="cl-platform-handle">@${escapeHtml(p.handle)}</span>
          ${p.verified ? '<span class="cl-verified-tick" title="Verified">✓</span>' : ''}
        </a>
      `).join('')}
    </div>

    ${latestSnap?.followers ? `
    <div class="cl-creator-stats">
      <span class="cl-stat"><span class="cl-stat-value">${escapeHtml(formatCount(latestSnap.followers))}</span> <span class="cl-stat-label">followers on ${escapeHtml(latestSnap.platform)}</span></span>
    </div>
    ` : ''}
  </section>

  ${lore.length ? `
  <section class="cl-creator-lore">
    <h2 class="cl-section-heading">The Vault</h2>
    <ol class="cl-lore-list">
      ${lore.map((l) => `
        <li class="cl-lore-entry">
          <time class="cl-lore-date">${escapeHtml(l.entry_date || '')}</time>
          <h3 class="cl-lore-title">${escapeHtml(l.title)}</h3>
          <p class="cl-lore-body">${escapeHtml(l.body || '')}</p>
        </li>
      `).join('')}
    </ol>
  </section>
  ` : ''}

  <section class="cl-creator-sparkline-placeholder" data-creator-id="${escapeHtml(slug)}">
    <h2 class="cl-section-heading">30-day momentum</h2>
    <div id="cl-sparkline" class="cl-sparkline-box">
      <p class="cl-muted">Loading follower history…</p>
    </div>
  </section>
</main>

<footer class="cl-footer">
  <p>ContentLore · The home of UK streaming culture.</p>
  <p><a href="/about/">About</a> · <a href="/ethics/">Ethics</a> · <a href="/ledger/">Ledger</a> · <a href="/contact/">Contact</a></p>
</footer>

<script src="/assets/creator-page.js" defer></script>
</body>
</html>`;

    return htmlResponse(html);
  } catch (err) {
    return new Response(`Error: ${err?.message || err}`, { status: 500 });
  }
}

function renderNotFound(slug) {
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="UTF-8"><title>Not found · ContentLore</title>
<link rel="stylesheet" href="/styles.css"></head>
<body><main style="padding: 80px 40px; max-width: 600px; margin: 0 auto;">
<h1>Creator not found</h1>
<p>No creator matches <code>${escapeHtml(slug)}</code> in the ContentLore catalogue.</p>
<p><a href="/">Back to homepage</a> · <a href="/claim">Claim a profile</a></p>
</main></body></html>`;
}

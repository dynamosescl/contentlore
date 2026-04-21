// ================================================================
// functions/discover/index.js
// GET /discover/
// The Discovery Engine v0.1.
// Reader-facing, filter-driven surface for finding UK creators.
// Answers the "what should I watch tonight" question.
// ================================================================

import { htmlResponse, escapeHtml, formatCount } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  try {
    // Count overall creators so the sidebar number is accurate.
    const countResult = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM creators WHERE role = 'creator'`)
      .first();
    const totalCount = countResult?.n || 0;

    const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Discover · ContentLore</title>
<meta name="description" content="The UK streaming Discovery Engine. Filter by platform, vertical, followers, and liveness — find UK creators worth your watch-time tonight.">
<meta name="theme-color" content="#0A0A0B">

<meta property="og:title" content="Discover · ContentLore">
<meta property="og:description" content="The UK streaming Discovery Engine. Neutral, scene-native, cross-platform.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://contentlore.com/discover/">
<meta property="og:site_name" content="ContentLore">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500;1,6..72,600&family=Anton&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
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
        <li><a href="/people/">People <span class="cl-count">${totalCount}</span></a></li>
        <li><a href="/places/">Places <span class="cl-count">soon</span></a></li>
        <li><a href="/platforms/">Platforms <span class="cl-count">04</span></a></li>
        <li><a href="/community/">Community <span class="cl-count">soon</span></a></li>
      </ul>
    </div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Read</div>
      <ul class="cl-nav-list">
        <li><a href="/discover/" class="small active">Discover</a></li>
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
        <strong id="live-count">\u2014</strong> creators live right now<br>
        across Twitch and Kick.
      </div>
      <div class="cl-live-stat-breakdown">
        <span><i class="platform-square twitch"></i> <span id="live-twitch">\u2014</span></span>
        <span><i class="platform-square kick"></i> <span id="live-kick">\u2014</span></span>
      </div>
    </div>

    <div class="cl-signoff">
      <a href="/about/">About</a> \u00b7 <a href="/ethics/">Ethics</a><br>
      <a href="/contact/">Contact</a> \u00b7 <a href="/claim">Claim profile</a><br><br>
      \u00a9 ContentLore 2026<br>
      Independent UK publication
    </div>
  </aside>

  <main class="cl-main">

    <div class="cl-topbar">
      <div class="cl-topbar-left">
        <span><strong>Discover</strong></span>
        <span>The Discovery Engine</span>
      </div>
      <div>v0.1 \u00b7 live filtering</div>
    </div>

    <section class="cl-hero" style="padding-bottom: 24px;">
      <div class="cl-hero-main">
        <div class="cl-hero-kicker">The Discovery Engine</div>
        <h1>What\u2019s <em>worth</em> your watch-time tonight.</h1>
        <p class="cl-hero-dek">Every UK creator we track, in one place, filterable the way platforms won\u2019t let you filter. <em>No algorithm pushing big streamers</em>. No platform paying us to surface a name. Just the scene, honestly sorted.</p>
      </div>
    </section>

    <!-- ==============================================================
         FILTER BAR
         ============================================================== -->
    <section class="cl-discover-filters">
      <div class="cl-df-group">
        <label class="cl-df-label">Platform</label>
        <div class="cl-df-pills" data-filter="platform">
          <button class="cl-df-pill active" data-value="">All</button>
          <button class="cl-df-pill" data-value="twitch">Twitch</button>
          <button class="cl-df-pill" data-value="kick">Kick</button>
        </div>
      </div>

      <div class="cl-df-group">
        <label class="cl-df-label">Status</label>
        <div class="cl-df-pills" data-filter="live">
          <button class="cl-df-pill active" data-value="">All</button>
          <button class="cl-df-pill" data-value="1">Live now</button>
        </div>
      </div>

      <div class="cl-df-group">
        <label class="cl-df-label">Tier</label>
        <div class="cl-df-pills" data-filter="tier">
          <button class="cl-df-pill active" data-value="">Any size</button>
          <button class="cl-df-pill" data-value="small" data-min="0" data-max="5000">Small \u00b7 under 5k</button>
          <button class="cl-df-pill" data-value="mid" data-min="5000" data-max="50000">Mid \u00b7 5k\u201350k</button>
          <button class="cl-df-pill" data-value="large" data-min="50000" data-max="0">Large \u00b7 50k+</button>
        </div>
      </div>

      <div class="cl-df-group">
        <label class="cl-df-label">Sort by</label>
        <div class="cl-df-pills" data-filter="sort">
          <button class="cl-df-pill active" data-value="momentum">Momentum</button>
          <button class="cl-df-pill" data-value="followers">Followers</button>
          <button class="cl-df-pill" data-value="live">Live viewers</button>
          <button class="cl-df-pill" data-value="name">Name (A\u2013Z)</button>
        </div>
      </div>

      <div class="cl-df-group cl-df-group-search">
        <label class="cl-df-label">Vertical</label>
        <input type="text" id="cl-df-category" class="cl-df-input" placeholder="e.g. gta-rp, just-chatting, irl" autocomplete="off">
      </div>
    </section>

    <!-- ==============================================================
         RESULTS
         ============================================================== -->
    <section class="cl-discover-results">
      <div class="cl-discover-meta" id="cl-discover-meta">
        Loading\u2026
      </div>

      <div class="cl-discover-grid" id="cl-discover-grid">
        <!-- Populated by /assets/discover.js -->
      </div>

      <div class="cl-discover-empty" id="cl-discover-empty" style="display: none;">
        <h3>No creators match those filters.</h3>
        <p>Try relaxing one of them, or clear the search box.</p>
      </div>
    </section>

    <footer class="cl-footer-v2">
      <div>ContentLore \u00b7 Independent UK streaming publication</div>
      <div>
        <a href="/about/">About</a> \u00b7
        <a href="/ethics/">Ethics</a> \u00b7
        <a href="/contact/">Contact</a> \u00b7
        <a href="/claim">Claim profile</a>
      </div>
    </footer>

  </main>
</div>

<script src="/assets/discover.js" defer></script>
<script src="/assets/livecount.js" defer></script>
</body>
</html>`;

    return htmlResponse(html);
  } catch (err) {
    return htmlResponse(
      `<h1>Discover is briefly unavailable</h1><p>${escapeHtml(String(err?.message || err))}</p>`,
      500
    );
  }
}

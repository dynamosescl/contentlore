// ================================================================
// /assets/desk.js
// The Desk — the live scene intelligence surface at the top of
// /discover/. Polls /api/live-now every 90s. Promotes the top
// streams into hero cards, renders the rest as compact rows.
// Falls through to /api/recent-live when nobody is currently on.
// ================================================================

(function() {
  'use strict';

  const root       = document.getElementById('cl-desk');
  const headline   = document.getElementById('cl-desk-headline');
  const metaEl     = document.getElementById('cl-desk-meta');
  const heroEl     = document.getElementById('cl-desk-hero');
  const rowsEl     = document.getElementById('cl-desk-rows');
  const emptyEl    = document.getElementById('cl-desk-empty');
  const emptyCopy  = document.getElementById('cl-desk-empty-copy');
  const emptyRecent= document.getElementById('cl-desk-empty-recent');

  if (!root) return;

  const POLL_MS = 90 * 1000;

  refresh();
  setInterval(refresh, POLL_MS);

  async function refresh() {
    try {
      const res = await fetch('/api/live-now');
      if (!res.ok) throw new Error('live-now status ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'live-now not ok');

      if (!data.live || data.live.length === 0) {
        await renderEmpty();
      } else {
        renderLive(data.live);
      }
    } catch (err) {
      console.error('Desk refresh failed:', err);
      renderError();
    }
  }

  // ============================================================
  // LIVE STATE — somebody is on
  // ============================================================
  function renderLive(live) {
    root.dataset.state = 'live';
    if (emptyEl) emptyEl.hidden = true;

    const total = live.length;
    const totalViewers = live.reduce((sum, c) => sum + (c.viewers || 0), 0);

    // Headline — the lede of the Desk
    headline.innerHTML = `
      <span class="cl-desk-hl-count">${total}</span>
      <span class="cl-desk-hl-verb">${total === 1 ? 'UK creator is' : 'UK creators are'}</span>
      <em class="cl-desk-hl-live">live</em><span class="cl-desk-hl-now"> right now</span>
    `;

    // Meta — aggregate viewer count
    metaEl.innerHTML = `
      <div class="cl-desk-meta-num">${formatCount(totalViewers)}</div>
      <div class="cl-desk-meta-label">watching</div>
    `;

    // Split into hero (top 3) and rows (the rest)
    const heroSlots = live.slice(0, Math.min(3, live.length));
    const rowSlots  = live.slice(3);

    heroEl.innerHTML = heroSlots.map(heroCard).join('');
    rowsEl.innerHTML = rowSlots.length
      ? `<div class="cl-desk-rows-label">Also live</div>` + rowSlots.map(compactRow).join('')
      : '';
  }

  // Hero card — one of the top 3 live streams, promoted
  function heroCard(c) {
    const platformClass = c.platform ? 'platform-' + c.platform : '';
    const game  = c.game_name
      ? `<div class="cl-hcard-game">${escapeHtml(c.game_name)}</div>`
      : '';
    const title = c.stream_title
      ? `<div class="cl-hcard-title">${escapeHtml(truncate(c.stream_title, 110))}</div>`
      : '';
    const uptime = c.uptime_mins != null ? formatUptime(c.uptime_mins) : '';
    const watchUrl = c.platform === 'twitch'
      ? `https://twitch.tv/${c.handle}`
      : c.platform === 'kick'
        ? `https://kick.com/${c.handle}`
        : null;

    return `
      <article class="cl-hcard ${platformClass}">
        <a class="cl-hcard-body" href="${c.profile_url}">
          <header class="cl-hcard-head">
            <div class="cl-hcard-name">${escapeHtml(c.display_name)}</div>
            <div class="cl-hcard-viewers">
              <span class="cl-hcard-vnum">${formatCount(c.viewers)}</span>
              <span class="cl-hcard-vlabel">watching</span>
            </div>
          </header>
          <div class="cl-hcard-handle">
            <i class="platform-square ${c.platform}"></i>
            <span>${escapeHtml(c.handle || '')}</span>
            ${uptime ? `<span class="cl-hcard-dot">\u00b7</span><span class="cl-hcard-uptime">live ${uptime}</span>` : ''}
          </div>
          ${game}
          ${title}
        </a>
        ${watchUrl ? `
          <a class="cl-hcard-watch" href="${watchUrl}" target="_blank" rel="noopener">
            Watch on ${c.platform} \u2192
          </a>
        ` : ''}
      </article>
    `;
  }

  // Compact row — live creators beyond the top 3
  function compactRow(c) {
    const watchUrl = c.platform === 'twitch'
      ? `https://twitch.tv/${c.handle}`
      : c.platform === 'kick'
        ? `https://kick.com/${c.handle}`
        : null;

    return `
      <a class="cl-drow" href="${c.profile_url}">
        <i class="platform-square ${c.platform}"></i>
        <span class="cl-drow-name">${escapeHtml(c.display_name)}</span>
        <span class="cl-drow-game">${c.game_name ? escapeHtml(c.game_name) : ''}</span>
        <span class="cl-drow-title">${c.stream_title ? escapeHtml(truncate(c.stream_title, 60)) : ''}</span>
        <span class="cl-drow-viewers">${formatCount(c.viewers)}</span>
      </a>
    `;
  }

  // ============================================================
  // EMPTY STATE — nobody currently on
  // ============================================================
  async function renderEmpty() {
    root.dataset.state = 'empty';
    heroEl.innerHTML = '';
    rowsEl.innerHTML = '';

    headline.innerHTML = `
      <span class="cl-desk-hl-verb">The scene is</span>
      <em class="cl-desk-hl-quiet">quiet</em>
      <span class="cl-desk-hl-now">right now</span>
    `;

    metaEl.innerHTML = `
      <div class="cl-desk-meta-num">0</div>
      <div class="cl-desk-meta-label">live</div>
    `;

    emptyCopy.textContent = emptyStateCopy();

    // Try to populate the recent fallback
    try {
      const res = await fetch('/api/recent-live');
      const data = res.ok ? await res.json() : null;
      if (data?.ok && data.recent?.length > 0) {
        emptyRecent.innerHTML = `
          <div class="cl-desk-rows-label">Top of the past week</div>
          ${data.recent.map(recentRow).join('')}
        `;
      } else {
        emptyRecent.innerHTML = '';
      }
    } catch (e) {
      emptyRecent.innerHTML = '';
    }

    if (emptyEl) emptyEl.hidden = false;
  }

  function recentRow(c) {
    let ago;
    if (c.hours_ago === 0)       ago = 'just now';
    else if (c.hours_ago === 1)  ago = '1h ago';
    else if (c.hours_ago < 24)   ago = `${c.hours_ago}h ago`;
    else if (c.days_ago === 1)   ago = '1d ago';
    else                          ago = `${c.days_ago}d ago`;

    return `
      <a class="cl-drow cl-drow-recent" href="${c.profile_url}">
        <i class="platform-square ${c.platform}"></i>
        <span class="cl-drow-name">${escapeHtml(c.display_name)}</span>
        <span class="cl-drow-game">${c.game_name ? escapeHtml(c.game_name) : ''}</span>
        <span class="cl-drow-title">${c.stream_title ? escapeHtml(truncate(c.stream_title, 55)) : ''}</span>
        <span class="cl-drow-viewers">${formatCount(c.peak_viewers)} peak</span>
        <span class="cl-drow-when">${ago}</span>
      </a>
    `;
  }

  // Time-aware empty state copy
  function emptyStateCopy() {
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 10)      return 'Most of the UK scene is asleep. Real talk \u2014 things kick off properly around 6pm.';
    if (hour >= 10 && hour < 14)     return 'Late morning, quiet period. Scene usually starts building in the afternoon.';
    if (hour >= 14 && hour < 18)     return 'Quiet hour. The scene typically picks up as the afternoon winds down.';
    if (hour >= 18 && hour < 22)     return 'Unusually quiet for prime time. Could mean a big event\u2019s pulling attention elsewhere.';
    return 'Late night, scene winding down. A few stragglers might pop back on.';
  }

  // ============================================================
  // ERROR STATE
  // ============================================================
  function renderError() {
    root.dataset.state = 'error';
    headline.innerHTML = '<span class="cl-desk-hl-verb">Briefly offline</span>';
    metaEl.innerHTML = '';
    heroEl.innerHTML = '';
    rowsEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = true;
  }

  // ============================================================
  // Utilities
  // ============================================================
  function formatUptime(mins) {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  function formatCount(n) {
    if (n === null || n === undefined) return '\u2014';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(n);
  }

  function truncate(s, n) {
    if (!s) return '';
    if (s.length <= n) return s;
    return s.substring(0, n - 1).trimEnd() + '\u2026';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();

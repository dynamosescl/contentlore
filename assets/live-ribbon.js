// ================================================================
// /assets/live-ribbon.js
// Populates the live ribbon at the top of /discover/.
// Pulls /api/live-now every 90 seconds. Falls back gracefully if
// nothing is live right now.
// ================================================================

(function() {
  'use strict';

  const ribbon = document.getElementById('cl-live-ribbon');
  const scroll = document.getElementById('cl-live-ribbon-scroll');
  const countEl = document.getElementById('cl-live-ribbon-count');
  if (!ribbon || !scroll) return;

  const POLL_INTERVAL_MS = 90 * 1000;

  async function refresh() {
    try {
      const res = await fetch('/api/live-now');
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'not ok');
      render(data);
    } catch (err) {
      console.error('Live ribbon failed:', err);
      if (scroll) scroll.innerHTML = '<div class="cl-live-ribbon-empty">Unable to check live state. Retrying\u2026</div>';
    }
  }

  function render(data) {
    const live = data.live || [];

    if (countEl) {
      countEl.textContent = live.length === 0
        ? 'Nobody\u2019s on'
        : `${live.length} UK creator${live.length === 1 ? '' : 's'} streaming`;
    }

    if (live.length === 0) {
      scroll.innerHTML = `
        <div class="cl-live-ribbon-empty">
          No UK creators live right now. Check back shortly \u2014
          the scene kicks off most evenings around 6pm UK time.
        </div>`;
      ribbon.classList.add('is-empty');
      return;
    }

    ribbon.classList.remove('is-empty');
    scroll.innerHTML = live.map(cardHtml).join('');
  }

  function cardHtml(c) {
    const platformClass = c.platform ? 'platform-' + c.platform : '';
    const game = c.game_name
      ? `<div class="cl-lr-game">${escapeHtml(c.game_name)}</div>`
      : '';
    const title = c.stream_title
      ? `<div class="cl-lr-title">${escapeHtml(truncate(c.stream_title, 70))}</div>`
      : '';
    const uptime = c.uptime_mins != null
      ? formatUptime(c.uptime_mins)
      : '';

    return `
      <a class="cl-lr-card ${platformClass}" href="${c.profile_url}">
        <div class="cl-lr-head">
          <div class="cl-lr-name">${escapeHtml(c.display_name)}</div>
          <div class="cl-lr-viewers">${formatCount(c.viewers)}</div>
        </div>
        <div class="cl-lr-handle">
          <i class="platform-square ${c.platform}"></i>
          ${escapeHtml(c.handle || '')}
          ${uptime ? `<span class="cl-lr-uptime">\u00b7 ${uptime}</span>` : ''}
        </div>
        ${game}
        ${title}
      </a>
    `;
  }

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

  // Initial load + poll
  refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
})();

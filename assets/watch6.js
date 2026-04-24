// ================================================================
// /assets/watch6.js
// Homepage "Watch 6 Live" fast-launch deck.
// Fetches /api/live-now and renders up to 6 live creators.
// ================================================================

(function () {
  const grid = document.getElementById('watch6-grid');
  if (!grid) return;

  const platformLabel = (p) => String(p || '').toLowerCase();

  function render(rows) {
    if (!rows || rows.length === 0) {
      grid.innerHTML = '<div class="cl-watch6-loading">No live creators right now — check back in a minute.</div>';
      return;
    }

    grid.innerHTML = rows.slice(0, 6).map((r) => {
      const platform = platformLabel(r.platform);
      const viewers = Number(r.viewers || 0).toLocaleString('en-GB');
      const href = streamUrlFor(r) || r.profile_url || '#';
      const avatar = r.avatar_url
        ? `<img src="${escapeHtml(r.avatar_url)}" alt="" loading="lazy">`
        : `<span class="cl-watch6-initial">${escapeHtml((r.display_name || '?').charAt(0).toUpperCase())}</span>`;

      return `
        <a class="cl-watch6-card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
          <span class="cl-watch6-platform ${escapeHtml(platform)}">${escapeHtml((platform || 'live').toUpperCase())}</span>
          <div class="cl-watch6-identity">
            <span class="cl-watch6-avatar">${avatar}</span>
            <div>
              <div class="cl-watch6-name">${escapeHtml(r.display_name || r.id || 'Unknown')}</div>
              <div class="cl-watch6-handle">@${escapeHtml(r.handle || r.id || '')}</div>
            </div>
          </div>
          <div class="cl-watch6-meta">
            <span>${viewers} watching</span>
            <span>${escapeHtml((r.game_name || 'Live').slice(0, 36))}</span>
          </div>
          <span class="cl-watch6-cta">Watch now →</span>
        </a>
      `;
    }).join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/live-now');
      if (!res.ok) throw new Error('live-now failed: ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'live-now not ok');
      render(data.live || []);
    } catch (err) {
      console.error('Watch6 load failed', err);
      grid.innerHTML = '<div class="cl-watch6-loading">Watch deck is reconnecting…</div>';
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function streamUrlFor(row) {
    const platform = platformLabel(row.platform);
    const handle = String(row.handle || '').replace(/^@/, '');
    if (!handle) return row.profile_url || '#';
    if (platform === 'twitch') return `https://www.twitch.tv/${encodeURIComponent(handle)}`;
    if (platform === 'kick') return `https://kick.com/${encodeURIComponent(handle)}`;
    if (platform === 'youtube') return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
    return row.profile_url || '#';
  }

  load();
  setInterval(load, 60 * 1000);
})();

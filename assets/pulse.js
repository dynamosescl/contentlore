// ================================================================
// /assets/pulse.js
// Scene Pulse — fetch /api/momentum and render tile row on homepage.
// ================================================================

(function () {
  const container = document.getElementById('pulse-scroll');
  if (!container) return;

  const render = (movers) => {
    if (!movers || movers.length === 0) {
      container.innerHTML = `
        <div class="cl-tile" style="opacity: 0.5;">
          <div class="cl-tile-top"><div class="cl-tile-rank">—</div></div>
          <div class="cl-tile-name">No movers yet</div>
          <div class="cl-tile-handle">not enough follower history</div>
        </div>`;
      return;
    }

    container.innerHTML = movers.map((m, i) => {
      const rank = String(i + 1).padStart(2, '0');
      const top3 = i < 3 ? 'top3' : '';
      const platform = (m.primary_platform || '').toLowerCase();
      const platformClass = ['twitch','kick','youtube','tiktok'].includes(platform) ? platform : '';
      const platformLabel = (m.primary_platform || '').toUpperCase();
      const delta = m.follower_delta || 0;
      const deltaText = (delta > 0 ? '+' : '') + delta.toLocaleString();
      const currentText = formatK(m.current_followers);
      const sparklinePoints = generateSparklinePoints();

      return `
        <a href="${escapeHtml(m.profile_url || '#')}" class="cl-tile">
          <div class="cl-tile-top">
            <div class="cl-tile-rank ${top3}">${rank}</div>
            ${platformClass ? `<span class="cl-platform-chip ${platformClass}">${escapeHtml(platformLabel)}</span>` : ''}
          </div>
          <div class="cl-tile-name">${escapeHtml(m.display_name || m.id)}</div>
          <div class="cl-tile-handle">@${escapeHtml(m.primary_handle || m.id)}</div>
          <div class="cl-tile-stats">
            <div class="cl-tile-delta">${deltaText}</div>
            <div class="cl-tile-delta-meta">
              Followers gained
              <strong>${currentText} total</strong>
            </div>
          </div>
          <svg class="cl-spark" viewBox="0 0 300 52" preserveAspectRatio="none">
            <polyline class="fill" points="${sparklinePoints} 300,52 0,52"/>
            <polyline points="${sparklinePoints}"/>
          </svg>
        </a>
      `;
    }).join('');
  };

  const fetchMovers = async () => {
    try {
      const res = await fetch('/api/momentum?limit=7');
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      if (data.ok && data.movers) {
        render(data.movers);

        // Update refresh timestamp
        const refreshEl = document.getElementById('pulse-refresh');
        if (refreshEl) {
          refreshEl.textContent = 'Live · just refreshed';
        }
      }
    } catch (e) {
      console.error('Pulse fetch failed:', e);
      container.innerHTML = `
        <div class="cl-tile" style="opacity: 0.5;">
          <div class="cl-tile-top"><div class="cl-tile-rank">—</div></div>
          <div class="cl-tile-name">Pulse offline</div>
          <div class="cl-tile-handle">unable to fetch live data</div>
        </div>`;
    }
  };

  // Kick off fetch
  fetchMovers();

  // ==========================================================
  // Helpers
  // ==========================================================

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatK(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 10_000) return Math.round(n / 1000) + 'K';
    if (n >= 1_000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // Generate a rising sparkline (deterministic look, no real data yet)
  // — visual placeholder. Real version will come from /api/creator/[slug].
  function generateSparklinePoints() {
    const width = 300;
    const height = 52;
    const points = [];
    const count = 8;
    const startY = height - 10;
    const endY = 8;
    const jitter = () => (Math.random() - 0.5) * 6;
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * width;
      const baseY = startY - (i / (count - 1)) * (startY - endY);
      const y = Math.max(4, Math.min(height - 4, baseY + jitter()));
      points.push(`${x.toFixed(0)},${y.toFixed(1)}`);
    }
    return points.join(' ');
  }
})();

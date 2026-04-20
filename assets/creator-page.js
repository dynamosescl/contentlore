// ================================================================
// /creator-page.js
// Client logic for /creator/:slug pages.
// Fetches 30-day snapshots and renders an inline SVG sparkline.
// ================================================================

(function () {
  const box = document.getElementById('cl-sparkline');
  if (!box) return;
  const creatorEl = document.querySelector('[data-creator-id]');
  const creatorId = creatorEl?.dataset?.creatorId;
  if (!creatorId) return;

  (async () => {
    try {
      const res = await fetch(`/api/creator/${encodeURIComponent(creatorId)}`);
      const data = await res.json();
      if (!data.ok || !data.snapshots || data.snapshots.length === 0) {
        box.innerHTML = '<p class="cl-muted">No 30-day follower data yet. Check back in a few days.</p>';
        return;
      }

      // Group snapshots by platform
      const byPlatform = {};
      for (const s of data.snapshots) {
        if (!byPlatform[s.platform]) byPlatform[s.platform] = [];
        if (s.followers != null) byPlatform[s.platform].push(s);
      }

      const platforms = Object.keys(byPlatform);
      if (platforms.length === 0) {
        box.innerHTML = '<p class="cl-muted">No follower series available yet.</p>';
        return;
      }

      box.innerHTML = platforms
        .map((platform) => renderSparkline(platform, byPlatform[platform]))
        .join('');
    } catch (e) {
      box.innerHTML = '<p class="cl-muted">Unable to load momentum data.</p>';
    }
  })();

  function renderSparkline(platform, series) {
    if (series.length < 2) {
      return `<div class="cl-sparkline-row">
        <span class="cl-platform-tag ${platform}">${platform.toUpperCase()}</span>
        <span class="cl-muted">${series[0]?.followers?.toLocaleString() || '—'} followers (not enough history for sparkline)</span>
      </div>`;
    }
    const w = 600;
    const h = 80;
    const pad = 4;
    const vals = series.map((s) => s.followers);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = Math.max(max - min, 1);
    const points = series.map((s, i) => {
      const x = pad + (i / (series.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((s.followers - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const first = series[0].followers;
    const last = series[series.length - 1].followers;
    const delta = last - first;
    const deltaClass = delta >= 0 ? 'up' : 'down';
    const deltaSign = delta >= 0 ? '+' : '';

    return `<div class="cl-sparkline-row">
      <div class="cl-sparkline-meta">
        <span class="cl-platform-tag ${platform}">${platform.toUpperCase()}</span>
        <span class="cl-spark-current">${last.toLocaleString()}</span>
        <span class="cl-spark-delta ${deltaClass}">${deltaSign}${delta.toLocaleString()}</span>
      </div>
      <svg viewBox="0 0 ${w} ${h}" class="cl-sparkline" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--creator-accent, #D4A574)" stroke-width="2" points="${points}"/>
      </svg>
    </div>`;
  }
})();

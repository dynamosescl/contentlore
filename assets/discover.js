// ================================================================
// /assets/discover.js
// Powers the Discovery Engine filter UI.
// Talks to /api/discover, renders results, keeps filters in sync.
// ================================================================

(function() {
  'use strict';

  const grid = document.getElementById('cl-discover-grid');
  const metaEl = document.getElementById('cl-discover-meta');
  const emptyEl = document.getElementById('cl-discover-empty');
  const catInput = document.getElementById('cl-df-category');

  if (!grid) return;

  // State
  const state = {
    platform: '',
    live: '',
    tier: '',
    min_followers: 0,
    max_followers: 0,
    sort: 'momentum',
    category: '',
  };

  // Pill groups
  document.querySelectorAll('.cl-df-pills').forEach((group) => {
    const filterName = group.dataset.filter;
    group.addEventListener('click', (e) => {
      const pill = e.target.closest('.cl-df-pill');
      if (!pill) return;
      // Set active
      group.querySelectorAll('.cl-df-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      // Update state
      if (filterName === 'tier') {
        state.tier = pill.dataset.value;
        state.min_followers = parseInt(pill.dataset.min || '0', 10);
        state.max_followers = parseInt(pill.dataset.max || '0', 10);
      } else {
        state[filterName] = pill.dataset.value;
      }
      fetchAndRender();
    });
  });

  // Category search \u2014 debounced
  let catTimer = null;
  if (catInput) {
    catInput.addEventListener('input', () => {
      clearTimeout(catTimer);
      catTimer = setTimeout(() => {
        state.category = catInput.value.trim();
        fetchAndRender();
      }, 220);
    });
  }

  // Initial load
  fetchAndRender();

  async function fetchAndRender() {
    const params = new URLSearchParams();
    if (state.platform) params.set('platform', state.platform);
    if (state.live) params.set('live', state.live);
    if (state.category) params.set('category', state.category);
    if (state.min_followers) params.set('min_followers', state.min_followers);
    if (state.max_followers) params.set('max_followers', state.max_followers);
    if (state.sort) params.set('sort', state.sort);
    params.set('limit', '120');

    metaEl.textContent = 'Loading\u2026';
    emptyEl.style.display = 'none';

    try {
      const res = await fetch('/api/discover?' + params.toString());
      if (!res.ok) throw new Error('API returned ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'unknown error');

      render(data);
    } catch (err) {
      console.error('Discover fetch failed:', err);
      grid.innerHTML = '';
      metaEl.textContent = 'Something went wrong loading creators. Try refreshing.';
    }
  }

  function render(data) {
    const { creators, total_matches, live_count } = data;

    if (creators.length === 0) {
      grid.innerHTML = '';
      metaEl.textContent = 'No matches';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';

    // Meta line
    let metaText = '';
    if (total_matches === creators.length) {
      metaText = `${total_matches} creator${total_matches === 1 ? '' : 's'}`;
    } else {
      metaText = `Showing ${creators.length} of ${total_matches}`;
    }
    if (live_count > 0) {
      metaText += ` \u00b7 ${live_count} live now`;
    }
    metaEl.textContent = metaText;

    // Cards
    grid.innerHTML = creators.map(cardHtml).join('');
  }

  function cardHtml(c) {
    const platformClass = c.platform ? 'platform-' + c.platform : '';
    const liveBadge = c.is_live
      ? `<span class="cl-card-live"><span class="cl-live-dot"></span>Live \u00b7 ${formatCount(c.current_viewers)}</span>`
      : '';

    const momentumHtml = renderMomentum(c.momentum_pct);
    const followersHtml = c.followers
      ? `<span class="cl-card-stat">${formatCount(c.followers)} followers</span>`
      : '';

    const categoriesHtml = c.categories && c.categories.length > 0
      ? `<div class="cl-card-cats">${c.categories.slice(0, 3).map(cat => `<span class="cl-card-cat">${escapeHtml(cat)}</span>`).join('')}</div>`
      : '';

    const bioHtml = c.bio
      ? `<p class="cl-card-bio">${escapeHtml(truncate(c.bio, 120))}</p>`
      : '';

    return `
      <a class="cl-card ${platformClass}" href="${c.profile_url}">
        <div class="cl-card-head">
          <div class="cl-card-name">${escapeHtml(c.display_name)}</div>
          ${liveBadge}
        </div>
        <div class="cl-card-handle">
          ${c.platform ? `<i class="platform-square ${c.platform}"></i>` : ''}
          ${c.handle ? escapeHtml(c.handle) : ''}
        </div>
        ${bioHtml}
        ${categoriesHtml}
        <div class="cl-card-footer">
          ${followersHtml}
          ${momentumHtml}
        </div>
      </a>
    `;
  }

  function renderMomentum(pct) {
    if (pct === null || pct === undefined) return '';
    const rounded = Math.round(pct * 10) / 10;
    if (rounded === 0) return `<span class="cl-card-momentum flat">0.0%</span>`;
    const sign = rounded > 0 ? '+' : '';
    const cls = rounded > 0 ? 'up' : 'down';
    const arrow = rounded > 0 ? '\u2191' : '\u2193';
    return `<span class="cl-card-momentum ${cls}">${arrow} ${sign}${rounded}%</span>`;
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

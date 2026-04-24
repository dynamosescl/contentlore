// ================================================================
// /assets/homepage-stats.js
// Fetches /api/stats and updates the live headline numbers on the
// homepage (Paper section + hero aside Vault card).
// ================================================================

(function() {
  'use strict';

  const fmtCompact = (n) => {
    if (n === null || n === undefined) return '\u2014';
    return Number(n).toLocaleString('en-GB');
  };

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const setCreatorsEverywhere = (value) => {
    setText('stat-creators', value);
    setText('vault-creators', value);
    setText('pulse-count', value);
    setText('sidebar-people-count', value);
    setText('hero-creators', value);
  };

  const setPlatformsEverywhere = (value) => {
    setText('stat-platforms', value);
    setText('sidebar-platforms-count', value);
  };

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('stats API ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'stats not ok');

      const creators = fmtCompact(data.creators);
      const snapshots = fmtCompact(data.snapshots);
      const platforms = String(data.platforms).padStart(2, '0');

      setCreatorsEverywhere(creators);
      setText('stat-snapshots', snapshots);
      setText('vault-snapshots', snapshots);
      setPlatformsEverywhere(platforms);
    } catch (err) {
      // Silent \u2014 the hard-coded fallback numbers remain in place.
      console.error('Stats load failed:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStats);
  } else {
    loadStats();
  }
})();

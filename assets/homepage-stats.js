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

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('stats API ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'stats not ok');

      // Paper section stats
      const c = document.getElementById('stat-creators');
      const s = document.getElementById('stat-snapshots');
      const p = document.getElementById('stat-platforms');
      if (c) c.textContent = fmtCompact(data.creators);
      if (s) s.textContent = fmtCompact(data.snapshots);
      if (p) p.textContent = String(data.platforms).padStart(2, '0');

      // Hero aside Vault card
      const vc = document.getElementById('vault-creators');
      const vs = document.getElementById('vault-snapshots');
      if (vc) vc.textContent = fmtCompact(data.creators);
      if (vs) vs.textContent = fmtCompact(data.snapshots);

      // Pulse meta counter
      const pc = document.getElementById('pulse-count');
      if (pc) pc.textContent = fmtCompact(data.creators);

      // Sidebar nav counts
      const sp = document.getElementById('sidebar-people-count');
      const sPlat = document.getElementById('sidebar-platforms-count');
      if (sp) sp.textContent = fmtCompact(data.creators);
      if (sPlat) sPlat.textContent = String(data.platforms).padStart(2, '0');
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

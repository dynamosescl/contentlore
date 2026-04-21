// ================================================================
// /assets/graph-strip.js
// Populates the "Who raided whom this week" strip on the homepage.
// Hides the whole section if there are zero edges in the 7-day window.
// ================================================================

(function() {
  'use strict';

  const section = document.getElementById('cl-graph-strip');
  const list = document.getElementById('cl-graph-list');
  if (!section || !list) return;

  fetch('/api/top-edges?window=7&limit=8')
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('status ' + r.status)))
    .then((data) => {
      if (!data.ok) throw new Error(data.error || 'not ok');
      render(data);
    })
    .catch((err) => {
      console.error('Graph strip failed:', err);
      section.style.display = 'none';
    });

  function render(data) {
    const edges = data.edges || [];

    if (edges.length === 0) {
      // Gracefully hide the section if the graph is empty.
      // Early days \u2014 the cron needs time to accumulate edges.
      section.style.display = 'none';
      return;
    }

    list.innerHTML = edges.map(edgeRow).join('');
  }

  function edgeRow(e) {
    const verb = edgeVerb(e.edge_type, e.weight);
    return `
      <div class="cl-graph-row">
        <a class="cl-graph-node from ${e.from.platform ? 'platform-' + e.from.platform : ''}" href="${e.from.url}">
          <i class="platform-square ${e.from.platform || ''}"></i>
          <span class="cl-graph-node-name">${escapeHtml(e.from.display_name)}</span>
        </a>
        <span class="cl-graph-arrow">
          <span class="cl-graph-verb ${e.edge_type}">${verb}</span>
        </span>
        <a class="cl-graph-node to ${e.to.platform ? 'platform-' + e.to.platform : ''}" href="${e.to.url}">
          <i class="platform-square ${e.to.platform || ''}"></i>
          <span class="cl-graph-node-name">${escapeHtml(e.to.display_name)}</span>
        </a>
      </div>
    `;
  }

  function edgeVerb(type, weight) {
    const countSuffix = weight > 1 ? ` \u00d7${weight}` : '';
    switch (type) {
      case 'raid':     return `\u2192 raided${countSuffix}`;
      case 'host':     return `\u2192 hosted${countSuffix}`;
      case 'shoutout': return `\u2192 shouted out${countSuffix}`;
      case 'co_stream': return `\u2192 co-streamed${countSuffix}`;
      default:         return `\u2192 mentioned${countSuffix}`;
    }
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

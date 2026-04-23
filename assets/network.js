// ================================================================
// /assets/network.js
// Populates the Network sidebar on creator profile pages.
// Reads data-creator-id from #cl-network-sidebar.
// ================================================================

(function() {
  'use strict';

  const SAFE_EDGE_TYPES = new Set(['raid', 'host', 'shoutout', 'co_stream', 'mention']);
  const SAFE_PLATFORMS = new Set(['twitch', 'kick', 'youtube', 'tiktok']);

  const wrap = document.getElementById('cl-network-sidebar');
  if (!wrap) return;

  const creatorId = wrap.dataset.creatorId;
  if (!creatorId) return;

  const inboundEl  = document.getElementById('cl-net-inbound');
  const outboundEl = document.getElementById('cl-net-outbound');
  const listEl     = document.getElementById('cl-network-list');

  fetch('/api/network/' + encodeURIComponent(creatorId))
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('status ' + r.status)))
    .then((data) => {
      if (!data.ok) throw new Error(data.error || 'not ok');
      render(data);
    })
    .catch((err) => {
      console.error('Network load failed:', err);
      if (listEl) listEl.innerHTML = '<div class="cl-network-empty">Network data unavailable.</div>';
    });

  function render(data) {
    const { inbound, outbound, stats } = data;

    if (inboundEl)  inboundEl.textContent  = stats.inbound_30d || '0';
    if (outboundEl) outboundEl.textContent = stats.outbound_30d || '0';

    const parts = [];

    if (inbound.length > 0) {
      parts.push(`<div class="cl-network-group-label">Recently connected in</div>`);
      parts.push(inbound.slice(0, 6).map(edgeHtml).join(''));
    }

    if (outbound.length > 0) {
      parts.push(`<div class="cl-network-group-label">Recently connected out</div>`);
      parts.push(outbound.slice(0, 6).map(edgeHtml).join(''));
    }

    if (parts.length === 0) {
      parts.push(`<div class="cl-network-empty">No connections logged yet. Check back as the graph grows.</div>`);
    }

    if (listEl) listEl.innerHTML = parts.join('');

    // Also populate the inline edge row in the main content column
    populateInlineEdges(inbound, outbound, stats);
  }

  function populateInlineEdges(inbound, outbound, stats) {
    const inlineSection = document.getElementById('cl-creator-edges');
    const inlineBody    = document.getElementById('cl-creator-edges-body');
    const inlineMeta    = document.getElementById('cl-creator-edges-meta');
    if (!inlineSection || !inlineBody) return;

    // Combine inbound + outbound, most recent first, cap at 8
    const combined = [];
    for (const e of inbound)  combined.push({ ...e, direction: 'in'  });
    for (const e of outbound) combined.push({ ...e, direction: 'out' });
    combined.sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0));
    const top = combined.slice(0, 8);

    if (top.length === 0) {
      inlineSection.style.display = 'none';
      return;
    }

    inlineSection.style.display = 'block';
    if (inlineMeta) {
      inlineMeta.textContent = `${stats.inbound_30d + stats.outbound_30d} connections in the last 30 days`;
    }
    inlineBody.innerHTML = top.map(inlineEdgeChip).join('');
  }

  function inlineEdgeChip(e) {
    const arrow = e.direction === 'in' ? '\u2190' : '\u2192';
    const edgeType = normaliseEdgeType(e.edge_type);
    const platform = normalisePlatform(e.platform);
    const profileUrl = safeProfileUrl(e.profile_url, e.creator_id);
    const verbMap = {
      raid: 'raided', host: 'hosted', shoutout: 'shoutout',
      co_stream: 'co-streamed', mention: 'mentioned',
    };
    const verb = verbMap[edgeType] || edgeType;
    return `
      <a class="cl-edge-chip ${edgeType}" href="${escapeAttr(profileUrl)}">
        <span class="cl-edge-chip-arrow">${arrow}</span>
        <span class="cl-edge-chip-verb">${escapeHtml(verb)}</span>
        <i class="platform-square ${platform}"></i>
        <span class="cl-edge-chip-name">${escapeHtml(e.display_name || e.creator_id)}</span>
      </a>
    `;
  }

  function edgeHtml(e) {
    const edgeType = normaliseEdgeType(e.edge_type);
    const platform = normalisePlatform(e.platform);
    const profileUrl = safeProfileUrl(e.profile_url, e.creator_id);
    return `
      <a class="cl-network-edge" href="${escapeAttr(profileUrl)}">
        <div class="cl-network-edge-left">
          <i class="platform-square ${platform}"></i>
          <span class="cl-network-edge-name">${escapeHtml(e.display_name || e.creator_id)}</span>
        </div>
        <span class="cl-network-edge-type ${edgeType}">${escapeHtml(edgeType)}${e.weight > 1 ? ' \u00d7' + Number(e.weight) : ''}</span>
      </a>
    `;
  }


  function normaliseEdgeType(raw) {
    const v = String(raw || '').toLowerCase();
    return SAFE_EDGE_TYPES.has(v) ? v : 'mention';
  }

  function normalisePlatform(raw) {
    const v = String(raw || '').toLowerCase();
    return SAFE_PLATFORMS.has(v) ? v : '';
  }

  function safeProfileUrl(url, creatorId) {
    const candidate = String(url || '').trim();
    if (candidate.startsWith('/creator/')) return candidate;
    return `/creator/${encodeURIComponent(creatorId || '')}`;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
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

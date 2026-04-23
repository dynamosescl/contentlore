async function loadMoments() {
  const list = document.getElementById('moments-list');
  const empty = document.getElementById('moments-empty');
  if (!list || !empty) return;

  try {
    const res = await fetch('/api/moments');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const moments = Array.isArray(data?.moments) ? data.moments : [];

    if (!moments.length) {
      empty.hidden = false;
      list.innerHTML = '';
      return;
    }

    empty.hidden = true;
    list.innerHTML = moments.slice(0, 12).map((m) => {
      const dominant = m?.dominant || {};
      const creators = Array.isArray(m?.creators) ? m.creators : [];
      const dominantName = dominant.display_name || 'No dominant creator';
      const dominantHandle = dominant.handle ? `@${dominant.handle}` : '';
      const platform = (dominant.platform || '').toLowerCase();
      const game = m?.title || 'Unknown';
      const watchUrl = streamUrl(platform, dominant.handle);

      return `
        <article class="cl-paper-card">
          <div class="cl-tag">Moment</div>
          <h3>${escapeHtml(game)}</h3>
          <div style="display:flex; align-items:center; gap:10px; margin:10px 0 8px;">
            ${avatarHtml(dominant, platform)}
            <div style="min-width:0;">
              <div style="font-family:var(--font-mono); font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--text-3);">Dominant stream</div>
              <div style="display:flex; align-items:center; gap:8px; font-weight:600;">
                ${platform ? `<i class="platform-square ${escapeHtml(platform)}"></i>` : ''}
                <span>${escapeHtml(dominantName)}</span>
              </div>
              <div style="color:var(--text-3); font-size:13px;">${escapeHtml(dominantHandle)}</div>
            </div>
          </div>
          <p>${formatCount(m?.total_viewers || 0)} viewers in this cluster · ${creators.length} creator${creators.length === 1 ? '' : 's'}.</p>
          <p>Momentum ${formatSigned(m?.momentum_score || 0)} · Edge activity ${Math.round(Number(m?.edge_activity || 0))}.</p>
          ${watchUrl ? `<a href="${watchUrl}" target="_blank" rel="noopener" style="font-family:var(--font-mono); font-size:12px;">Watch dominant stream →</a>` : ''}
        </article>
      `;
    }).join('');
  } catch (err) {
    console.error('moments load failed', err);
    empty.hidden = false;
  }
}

function avatarHtml(streamer, platform) {
  const name = streamer?.display_name || streamer?.id || '?';
  const initial = escapeHtml(name.charAt(0).toUpperCase());
  const platformClass = platform ? `platform-${escapeHtml(platform)}` : '';

  if (streamer?.avatar_url) {
    return `<span class="cl-avatar cl-avatar--sm ${platformClass}" style="width:28px;height:28px;min-width:28px;">
      <img src="${escapeAttr(streamer.avatar_url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <span class="cl-avatar-fallback" style="display:none;">${initial}</span>
    </span>`;
  }

  return `<span class="cl-avatar cl-avatar--sm cl-avatar--initial ${platformClass}" style="width:28px;height:28px;min-width:28px;">
    <span class="cl-avatar-fallback">${initial}</span>
  </span>`;
}

function streamUrl(platform, handle) {
  if (!platform || !handle) return null;
  if (platform === 'twitch') return `https://twitch.tv/${encodeURIComponent(handle)}`;
  if (platform === 'kick') return `https://kick.com/${encodeURIComponent(handle)}`;
  return null;
}

function formatCount(n) {
  const val = Number(n) || 0;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(Math.round(val));
}

function formatSigned(n) {
  const val = Math.round(Number(n) || 0);
  return val > 0 ? `+${val}` : `${val}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

document.addEventListener('DOMContentLoaded', loadMoments);

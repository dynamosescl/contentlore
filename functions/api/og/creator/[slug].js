// ================================================================
// functions/api/og/creator/[slug].js
// GET /api/og/creator/:slug
// Dynamic SVG OG card rendered from D1 data.
// Now includes the creator's avatar embedded as base64 so Twitter,
// Discord, Slack, iMessage previews all show it reliably.
// Dimensions: 1200x630 (OG standard).
// ================================================================

import { escapeHtml } from '../../../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return new Response('Slug required', { status: 400 });

  try {
    const creator = await env.DB
      .prepare(
        `SELECT c.display_name, c.bio, c.categories, c.accent_colour, c.avatar_url,
                cp.platform AS primary_platform
         FROM creators c
         LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
         WHERE c.id = ?`
      )
      .bind(slug)
      .first();

    const displayName = creator?.display_name || slug;
    const bio = creator?.bio || 'UK streaming creator';
    const platform = (creator?.primary_platform || '').toUpperCase();
    const accent = creator?.accent_colour || '#D4A574';

    const platformColour = creator?.primary_platform === 'twitch' ? '#9146FF'
                        : creator?.primary_platform === 'kick'   ? '#53FC18'
                        : accent;

    // Fetch + base64-encode avatar, fallback silently if it fails
    let avatarDataUri = null;
    if (creator?.avatar_url) {
      try {
        const avRes = await fetch(creator.avatar_url, { cf: { cacheTtl: 3600 } });
        if (avRes.ok) {
          const buf = await avRes.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);
          const ct = avRes.headers.get('content-type') || 'image/jpeg';
          avatarDataUri = `data:${ct};base64,${b64}`;
        }
      } catch (e) {
        // Silently skip avatar — the card will still render without it
      }
    }

    // Wrap bio to roughly 3 lines (~40 chars each now that text shifts right)
    const wrappedBio = wrapText(bio, 44, 3);

    // Text x-offset: 300 when avatar present, 60 when absent
    const textX = avatarDataUri ? 320 : 60;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#131316"/>
    </linearGradient>
    <clipPath id="avatarClip">
      <rect x="60" y="205" width="220" height="220"/>
    </clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Accent bar -->
  <rect x="0" y="0" width="8" height="630" fill="${escapeHtml(platformColour)}"/>

  <!-- Wordmark top-left -->
  <text x="60" y="80" font-family="Georgia, serif" font-style="italic" font-size="36" fill="#EEE7DC" font-weight="600">
    ContentLore<tspan fill="${escapeHtml(accent)}">.</tspan>
  </text>

  <!-- Platform chip top-right -->
  ${platform ? `
  <rect x="990" y="45" width="160" height="40" rx="20" fill="#22242A" stroke="${escapeHtml(platformColour)}" stroke-width="2"/>
  <text x="1070" y="72" font-family="'Courier New', monospace" font-size="16" fill="${escapeHtml(platformColour)}" text-anchor="middle" letter-spacing="2">${escapeHtml(platform)}</text>
  ` : ''}

  <!-- Avatar with platform-coloured border -->
  ${avatarDataUri ? `
  <rect x="56" y="201" width="228" height="228" fill="none" stroke="${escapeHtml(platformColour)}" stroke-width="4"/>
  <image xlink:href="${avatarDataUri}" x="60" y="205" width="220" height="220" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>
  ` : ''}

  <!-- Creator name hero -->
  <text x="${textX}" y="270" font-family="Georgia, serif" font-size="${displayName.length > 18 ? 68 : 84}" fill="#F5EEE0" font-weight="700">${escapeHtml(displayName)}</text>

  <!-- Bio -->
  ${wrappedBio.map((line, i) => `
  <text x="${textX}" y="${340 + i * 40}" font-family="'Helvetica Neue', sans-serif" font-size="26" fill="#B8B2A4">${escapeHtml(line)}</text>
  `).join('')}

  <!-- Footer URL -->
  <text x="60" y="580" font-family="'Courier New', monospace" font-size="18" fill="#7A7568" letter-spacing="1">contentlore.com/creator/${escapeHtml(slug)}</text>
</svg>`;

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=3600', // 1 hour — avatars rarely change
      },
    });
  } catch (err) {
    return new Response(`Error: ${err?.message || err}`, { status: 500 });
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // chunked to avoid stack overflow on large images
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function wrapText(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s\S+$/, '…');
  }
  return lines;
}

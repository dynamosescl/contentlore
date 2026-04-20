// ================================================================
// functions/api/og/creator/[slug].js
// GET /api/og/creator/:slug
// Dynamic SVG OG card rendered from D1 data.
// Returned as image/svg+xml — Discord/Slack/X will render it inline.
// Dimensions: 1200x630 (OG standard).
// ================================================================

import { escapeHtml } from '../../../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return new Response('Slug required', { status: 400 });

  try {
    const creator = await env.DB
      .prepare(
        `SELECT c.display_name, c.bio, c.categories, c.accent_colour,
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

    // Wrap bio to roughly 3 lines (~50 chars each)
    const wrappedBio = wrapText(bio, 50, 3);

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#131316"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Accent bar -->
  <rect x="0" y="0" width="8" height="630" fill="${escapeHtml(accent)}"/>

  <!-- Wordmark top-left -->
  <text x="60" y="80" font-family="Georgia, serif" font-style="italic" font-size="36" fill="#EEE7DC" font-weight="600">
    ContentLore<tspan fill="${escapeHtml(accent)}">.</tspan>
  </text>

  <!-- Platform chip top-right -->
  ${platform ? `
  <rect x="990" y="45" width="160" height="40" rx="20" fill="#22242A" stroke="${escapeHtml(accent)}" stroke-width="1"/>
  <text x="1070" y="72" font-family="'Courier New', monospace" font-size="16" fill="${escapeHtml(accent)}" text-anchor="middle" letter-spacing="2">${escapeHtml(platform)}</text>
  ` : ''}

  <!-- Creator name hero -->
  <text x="60" y="300" font-family="Georgia, serif" font-size="88" fill="#F5EEE0" font-weight="700">${escapeHtml(displayName)}</text>

  <!-- Bio -->
  ${wrappedBio.map((line, i) => `
  <text x="60" y="${380 + i * 40}" font-family="'Helvetica Neue', sans-serif" font-size="28" fill="#B8B2A4">${escapeHtml(line)}</text>
  `).join('')}

  <!-- Footer URL -->
  <text x="60" y="580" font-family="'Courier New', monospace" font-size="18" fill="#7A7568" letter-spacing="1">contentlore.com/creator/${escapeHtml(slug)}</text>
</svg>`;

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=300', // 5 min cache is fine for OG
      },
    });
  } catch (err) {
    return new Response(`Error: ${err?.message || err}`, { status: 500 });
  }
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

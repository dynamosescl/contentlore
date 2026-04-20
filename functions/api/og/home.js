// ================================================================
// functions/api/og/home.js
// GET /api/og/home
// OG card for the homepage / root URL shares.
// ================================================================

export async function onRequestGet() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#131316"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="8" height="630" fill="#D4A574"/>

  <text x="60" y="280" font-family="Georgia, serif" font-style="italic" font-size="130" fill="#F5EEE0" font-weight="700">
    ContentLore<tspan fill="#D4A574">.</tspan>
  </text>

  <text x="60" y="360" font-family="Georgia, serif" font-size="32" fill="#B8B2A4">The home of UK streaming culture.</text>

  <text x="60" y="430" font-family="'Helvetica Neue', sans-serif" font-size="24" fill="#7A7568">People · Places · Platforms · Community</text>

  <circle cx="72" cy="490" r="8" fill="#B7F400"/>
  <text x="96" y="496" font-family="'Courier New', monospace" font-size="20" fill="#EEE7DC" letter-spacing="1">LIVE · creator intelligence · UK-first</text>

  <text x="60" y="580" font-family="'Courier New', monospace" font-size="18" fill="#7A7568" letter-spacing="1">contentlore.com</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

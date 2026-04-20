// ================================================================
// functions/api/og/claim.js
// GET /api/og/claim
// OG card for the self-claim page.
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

  <text x="60" y="80" font-family="Georgia, serif" font-style="italic" font-size="36" fill="#EEE7DC" font-weight="600">
    ContentLore<tspan fill="#D4A574">.</tspan>
  </text>

  <text x="60" y="300" font-family="Georgia, serif" font-size="100" fill="#F5EEE0" font-weight="700">
    Claim <tspan font-style="italic" fill="#D4A574">your</tspan>
  </text>
  <text x="60" y="410" font-family="Georgia, serif" font-size="100" fill="#F5EEE0" font-weight="700">profile.</text>

  <text x="60" y="500" font-family="'Helvetica Neue', sans-serif" font-size="24" fill="#B8B2A4">For UK creators on Twitch and Kick.</text>

  <text x="60" y="580" font-family="'Courier New', monospace" font-size="18" fill="#7A7568" letter-spacing="1">contentlore.com/claim</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

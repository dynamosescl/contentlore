// ================================================================
// functions/claim/index.js
// GET /claim
// Server-renders the self-claim portal page with OG meta.
// The actual claim flow runs client-side via /claim.js.
// ================================================================

import { htmlResponse } from '../_lib.js';

export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claim your profile · ContentLore</title>
<meta name="description" content="Claim your ContentLore creator profile. For UK streamers on Twitch and Kick.">
<meta name="theme-color" content="#0A0A0B">

<meta property="og:title" content="Claim your ContentLore profile">
<meta property="og:description" content="For UK streamers on Twitch and Kick. Two-minute verification via your platform bio.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://contentlore.com/claim">
<meta property="og:image" content="https://contentlore.com/api/og/claim">
<meta property="og:site_name" content="ContentLore">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Claim your ContentLore profile">
<meta name="twitter:image" content="https://contentlore.com/api/og/claim">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<nav class="cl-nav">
  <a href="/" class="cl-nav-brand">
    <span class="cl-wordmark">ContentLore<span class="dot">.</span></span>
  </a>
  <div class="cl-nav-links">
    <a href="/gta-rp/">GTA RP</a>
    <a href="/the-platform/">The Platform</a>
    <a href="/claim" class="active">Claim</a>
    <a href="/ethics/">Ethics</a>
    <a href="/ledger/">Ledger</a>
  </div>
</nav>

<main class="cl-claim-page">
  <section class="cl-claim-hero">
    <span class="cl-kicker">For UK creators</span>
    <h1>Claim <em>your</em> profile.</h1>
    <p class="cl-claim-lede">For UK streamers on Twitch and Kick. Two-minute bio-code verification. No email required.</p>
  </section>

  <section class="cl-claim-form-wrap" id="claim-form-section">
    <form id="claim-form" class="cl-claim-form">
      <label class="cl-claim-label">
        <span>Platform</span>
        <div class="cl-claim-platform-toggle">
          <label><input type="radio" name="platform" value="twitch" checked> Twitch</label>
          <label><input type="radio" name="platform" value="kick"> Kick</label>
        </div>
      </label>

      <label class="cl-claim-label">
        <span>Your handle</span>
        <input type="text" name="handle" required minlength="2" maxlength="60" 
               placeholder="e.g. dynamoses" autocomplete="off">
      </label>

      <label class="cl-claim-label">
        <span>Email (optional)</span>
        <input type="email" name="email" placeholder="for editorial contact, not published">
      </label>

      <button type="submit" class="cl-claim-submit">Get verification code</button>
    </form>

    <div id="claim-step-2" class="cl-claim-step-2 hidden">
      <h2>Step 2 — paste this code into your bio</h2>
      <div class="cl-claim-code-display" id="claim-code"></div>
      <p class="cl-muted">Paste the code above into your <span id="claim-platform-label"></span> bio, save it, then click Verify. You can remove the code as soon as you're approved.</p>
      <button id="claim-verify-btn" class="cl-claim-submit">I've pasted it — Verify now</button>
    </div>

    <div id="claim-result" class="cl-claim-result hidden"></div>
  </section>
</main>

<footer class="cl-footer">
  <p>ContentLore · The home of UK streaming culture.</p>
  <p><a href="/about/">About</a> · <a href="/ethics/">Ethics</a> · <a href="/ledger/">Ledger</a> · <a href="/contact/">Contact</a></p>
</footer>

<script src="/assets/claim.js" defer></script>
</body>
</html>`;

  return htmlResponse(html);
}

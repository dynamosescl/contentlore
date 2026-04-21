// ================================================================
// functions/claim/index.js
// GET /claim
// v2 design — left sidebar, magazine-spread hero for claim portal.
// Flow logic remains client-side via /assets/claim.js.
// ================================================================

import { htmlResponse } from '../_lib.js';

export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claim your profile · ContentLore</title>
<meta name="description" content="Claim your ContentLore creator profile. For UK streamers on Twitch and Kick. Two-minute verification via platform bio.">
<meta name="theme-color" content="#0A0A0B">

<meta property="og:title" content="Claim your ContentLore profile">
<meta property="og:description" content="For UK streamers on Twitch and Kick. Two-minute verification.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://contentlore.com/claim">
<meta property="og:image" content="https://contentlore.com/api/og/claim">
<meta property="og:site_name" content="ContentLore">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Claim your ContentLore profile">
<meta name="twitter:image" content="https://contentlore.com/api/og/claim">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">

<style>
.cl-claim {
  padding: 80px var(--gutter) 120px;
  max-width: 720px;
  position: relative;
}
.cl-claim::before {
  content: "Claim";
  position: absolute;
  top: 20px;
  right: -40px;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 220px;
  font-weight: 300;
  color: var(--bg-elev);
  letter-spacing: -0.05em;
  line-height: 1;
  pointer-events: none;
  z-index: 0;
  opacity: 0.5;
  font-variation-settings: "opsz" 144;
}
.cl-claim > * { position: relative; z-index: 1; }

.cl-claim h1 {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: clamp(56px, 8vw, 120px);
  line-height: 0.9;
  letter-spacing: -0.04em;
  color: var(--text);
  margin-bottom: 32px;
  font-variation-settings: "opsz" 144;
}
.cl-claim h1 em { font-style: italic; color: var(--signal); font-weight: 400; }
.cl-claim-dek {
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1.45;
  color: var(--text-2);
  margin-bottom: 56px;
}

.cl-claim-form { display: flex; flex-direction: column; gap: 28px; }
.cl-claim-form label > span {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 10px;
}
.cl-claim-form input[type="text"], .cl-claim-form input[type="email"] {
  width: 100%;
  padding: 16px 18px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  color: var(--text);
  font-family: var(--font-serif);
  font-size: 18px;
  transition: border-color 0.15s;
}
.cl-claim-form input:focus { outline: none; border-color: var(--signal); }
.cl-claim-radio-group { display: flex; gap: 12px; flex-wrap: wrap; }
.cl-claim-radio-group label {
  flex: 1;
  min-width: 140px;
  padding: 14px 20px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  cursor: pointer;
  font-family: var(--font-serif);
  font-size: 17px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: border-color 0.15s, background 0.15s;
}
.cl-claim-radio-group label:has(input:checked) { border-color: var(--signal); background: var(--bg-card); }
.cl-claim-radio-group input { margin: 0; accent-color: var(--signal); }

.cl-claim-submit {
  padding: 18px 32px;
  background: var(--signal);
  color: var(--bg);
  border: none;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.2s;
  align-self: flex-start;
}
.cl-claim-submit:hover { background: var(--signal-bright); transform: translateY(-1px); }
.cl-claim-submit:disabled { opacity: 0.5; cursor: default; transform: none; }

.cl-claim-step-2 h2 {
  font-family: var(--font-serif);
  font-size: 36px;
  font-weight: 500;
  letter-spacing: -0.025em;
  margin-bottom: 20px;
}
.cl-claim-code-display {
  font-family: var(--font-mono);
  font-size: 44px;
  letter-spacing: 0.12em;
  font-weight: 600;
  background: var(--bg-elev);
  border: 1px solid var(--signal);
  padding: 40px;
  text-align: center;
  color: var(--signal);
  margin: 28px 0;
  user-select: all;
}

.cl-claim-result {
  margin-top: 40px;
  padding: 28px;
  border: 1px solid var(--line);
  border-left-width: 3px;
  font-family: var(--font-serif);
  font-size: 18px;
  line-height: 1.5;
}
.cl-claim-result.success { border-left-color: var(--signal); }
.cl-claim-result.error { border-left-color: var(--red); color: var(--red); }
.hidden { display: none !important; }
.cl-muted { color: var(--text-3); font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
</style>

</head>
<body>

<div class="cl-app">

  <aside class="cl-sidebar">
    <a href="/" class="cl-masthead">Content<em>Lore</em><span class="cl-mark"></span></a>
    <div class="cl-masthead-sub">The UK Streaming Desk · Est. 2026</div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Sections</div>
      <ul class="cl-nav-list">
        <li><a href="/people/">People <span class="cl-count">285</span></a></li>
        <li><a href="/places/">Places <span class="cl-count">soon</span></a></li>
        <li><a href="/platforms/">Platforms <span class="cl-count">04</span></a></li>
        <li><a href="/community/">Community <span class="cl-count">soon</span></a></li>
      </ul>
    </div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Read</div>
      <ul class="cl-nav-list">
        <li><a href="/discover/" class="small">Discover</a></li>
        <li><a href="/the-platform/" class="small">The Platform</a></li>
        <li><a href="/ledger/" class="small">The Ledger</a></li>
        <li><a href="/gta-rp/" class="small">GTA RP</a></li>
      </ul>
    </div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">You</div>
      <ul class="cl-nav-list">
        <li><a href="/claim" class="small active">Claim profile</a></li>
      </ul>
    </div>

    <div class="cl-signoff">
      <a href="/about/">About</a> · <a href="/ethics/">Ethics</a><br>
      <a href="/contact/">Contact</a><br><br>
      © ContentLore 2026<br>
      Independent UK publication
    </div>
  </aside>

  <main class="cl-main">

    <div class="cl-topbar">
      <div class="cl-topbar-left">
        <span><a href="/" style="color: inherit; text-decoration: none;">← Home</a></span>
        <span>Self-claim portal</span>
      </div>
      <div>For UK creators</div>
    </div>

    <section class="cl-claim">
      <h1>Claim <em>your</em> profile.</h1>
      <p class="cl-claim-dek">For UK streamers on Twitch and Kick. Two-minute verification by pasting a code into your platform bio. No email required.</p>

      <form id="claim-form" class="cl-claim-form">
        <label>
          <span>Platform</span>
          <div class="cl-claim-radio-group">
            <label><input type="radio" name="platform" value="twitch" checked> Twitch</label>
            <label><input type="radio" name="platform" value="kick"> Kick</label>
          </div>
        </label>
        <label>
          <span>Your handle</span>
          <input type="text" name="handle" required minlength="2" maxlength="60" placeholder="e.g. dynamoses" autocomplete="off">
        </label>
        <label>
          <span>Email (optional, not published)</span>
          <input type="email" name="email" placeholder="for editorial contact only">
        </label>
        <button type="submit" class="cl-claim-submit">Get verification code</button>
      </form>

      <div id="claim-step-2" class="cl-claim-step-2 hidden">
        <h2>Paste this code into your bio.</h2>
        <div class="cl-claim-code-display" id="claim-code"></div>
        <p class="cl-muted">Paste the code above into your <span id="claim-platform-label"></span> bio exactly as shown, save it, then click Verify. You can remove the code as soon as you're approved.</p>
        <button id="claim-verify-btn" class="cl-claim-submit">I've pasted it — Verify now</button>
      </div>

      <div id="claim-result" class="cl-claim-result hidden"></div>

    </section>

  </main>
</div>

<script src="/assets/claim.js" defer></script>
</body>
</html>`;

  return htmlResponse(html);
}

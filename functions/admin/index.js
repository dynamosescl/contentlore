// ================================================================
// functions/admin/index.js
// GET /admin
// v2 design — left sidebar, admin control centre.
// ================================================================

import { htmlResponse } from '../_lib.js';

export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin · ContentLore</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0A0A0B">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">

<style>
.cl-admin {
  padding: 48px var(--gutter) 120px;
}
.cl-admin h1 {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: clamp(40px, 5vw, 64px);
  letter-spacing: -0.03em;
  margin-bottom: 8px;
}
.cl-admin h1 em { font-style: italic; color: var(--signal); }
.cl-admin-sub {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--text-3);
  text-transform: uppercase;
  margin-bottom: 40px;
}

.cl-admin-auth {
  max-width: 440px;
  padding: 40px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  margin-top: 80px;
}
.cl-admin-auth h2 {
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 500;
  margin-bottom: 8px;
}
.cl-admin-auth p {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.15em;
  color: var(--text-3);
  text-transform: uppercase;
  margin-bottom: 24px;
}
.cl-admin-auth input {
  width: 100%;
  padding: 14px 16px;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 15px;
  margin-bottom: 16px;
}
.cl-admin-auth input:focus { outline: none; border-color: var(--signal); }
.cl-admin-auth button {
  width: 100%;
  padding: 14px;
  background: var(--signal);
  color: var(--bg);
  border: none;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  font-weight: 600;
  cursor: pointer;
}

.cl-admin-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 40px;
  flex-wrap: wrap;
}
.cl-admin-tab {
  padding: 14px 24px;
  background: none;
  border: none;
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.cl-admin-tab:hover { color: var(--text); }
.cl-admin-tab.active { color: var(--signal); border-bottom-color: var(--signal); }
.cl-admin-tab-body.hidden { display: none; }

.cl-admin-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 32px;
  padding: 20px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  flex-wrap: wrap;
}
.cl-admin-toolbar > span:first-child {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
  letter-spacing: 0.1em;
}

.cl-admin-btn-primary, .cl-admin-btn-secondary, .cl-admin-btn-danger {
  padding: 10px 18px;
  border: none;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, background 0.15s;
}
.cl-admin-btn-primary { background: var(--signal); color: var(--bg); }
.cl-admin-btn-primary:hover { background: var(--signal-bright); transform: translateY(-1px); }
.cl-admin-btn-secondary { background: var(--bg-deep); color: var(--text); border: 1px solid var(--signal); }
.cl-admin-btn-danger { background: transparent; color: var(--red); border: 1px solid var(--red); }
.cl-admin-btn-danger:hover { background: rgba(230, 57, 70, 0.1); }

.cl-pending-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.cl-pending-card {
  padding: 24px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
}
.cl-pending-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  align-items: center;
}
.cl-pending-card h3 {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 22px;
  line-height: 1.15;
  margin-bottom: 10px;
}
.cl-pending-bio {
  font-family: var(--font-serif);
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.5;
  margin-bottom: 12px;
}
.cl-pending-card .cl-muted {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--text-3);
  margin-bottom: 6px;
}
.cl-pending-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.cl-handle {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
}
.cl-verified-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--signal);
  text-transform: uppercase;
  font-weight: 600;
}
.cl-source-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.15em;
  color: var(--text-3);
  padding: 2px 6px;
  background: var(--bg);
  text-transform: uppercase;
}

.cl-admin-log {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-elev);
  padding: 20px;
  border: 1px solid var(--line);
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin-top: 20px;
}

.cl-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0;
  border: 1px solid var(--line);
}
.cl-stat-box {
  padding: 32px 24px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  text-align: center;
}
.cl-stat-num {
  font-family: var(--font-serif);
  font-size: 56px;
  font-weight: 500;
  color: var(--signal);
  letter-spacing: -0.03em;
  display: block;
  margin-bottom: 8px;
  font-variation-settings: "opsz" 144;
}

.cl-flash {
  position: fixed;
  bottom: 32px;
  right: 32px;
  padding: 16px 24px;
  background: var(--bg-elev);
  border: 1px solid var(--signal);
  font-family: var(--font-serif);
  font-size: 15px;
  z-index: 1000;
  animation: clFlash 4s ease-out forwards;
}
.cl-flash-success { border-color: var(--signal); color: var(--signal); }
.cl-flash-error { border-color: var(--red); color: var(--red); }
@keyframes clFlash {
  0% { opacity: 0; transform: translateY(20px); }
  10%, 85% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-10px); }
}
.hidden { display: none !important; }
.cl-error { color: var(--red); font-family: var(--font-mono); font-size: 12px; margin-top: 12px; }
</style>
</head>
<body>

<div class="cl-app">

  <aside class="cl-sidebar">
    <a href="/" class="cl-masthead">Content<em>Lore</em><span class="cl-mark"></span></a>
    <div class="cl-masthead-sub">Admin · Editorial desk</div>

    <div class="cl-nav-section">
      <div class="cl-nav-section-label">Control</div>
      <ul class="cl-nav-list">
        <li><a href="/admin" class="small active">Pending review</a></li>
        <li><a href="/people/" class="small">People directory</a></li>
        <li><a href="/" class="small">Back to public</a></li>
      </ul>
    </div>

    <div class="cl-signoff">
      © ContentLore 2026<br>
      Admin zone · noindex
    </div>
  </aside>

  <main class="cl-main">

    <div class="cl-topbar">
      <div class="cl-topbar-left">
        <span><strong>ADMIN</strong></span>
        <span>Editorial control</span>
      </div>
      <div>
        <a href="/" style="color: var(--text-3); text-decoration: none;">← Public site</a>
      </div>
    </div>

    <section class="cl-admin">

      <div id="auth-wall" class="cl-admin-auth">
        <h2>Admin access</h2>
        <p>Password required</p>
        <form id="auth-form">
          <input type="password" id="admin-password-input" placeholder="Admin password" autocomplete="current-password" required>
          <button type="submit">Unlock</button>
        </form>
        <p id="auth-error" class="cl-error hidden"></p>
      </div>

      <div id="admin-panel" class="hidden">
        <h1>Editorial <em>desk.</em></h1>
        <div class="cl-admin-sub">Pending review · Bio enrichment · Catalogue stats</div>

        <div class="cl-admin-tabs">
          <button class="cl-admin-tab active" data-tab="pending">Pending review</button>
          <button class="cl-admin-tab" data-tab="enrich">Bio enrichment</button>
          <button class="cl-admin-tab" data-tab="stats">Catalogue stats</button>
        </div>

        <section id="tab-pending" class="cl-admin-tab-body">
          <div class="cl-admin-toolbar">
            <span id="pending-count">Loading pending…</span>
            <button id="bulk-approve-all" class="cl-admin-btn-secondary">Approve ALL</button>
            <button id="bulk-reject-all" class="cl-admin-btn-danger">Reject ALL</button>
          </div>
          <div id="pending-list" class="cl-pending-list"></div>
        </section>

        <section id="tab-enrich" class="cl-admin-tab-body hidden">
          <p style="font-family: var(--font-serif); font-size: 18px; line-height: 1.5; color: var(--text-2); margin-bottom: 24px; max-width: 640px;">Run Claude Haiku over creators with empty or short bios. Rewrites in editorial voice, UK English, no profanity.</p>
          <button id="enrich-btn" class="cl-admin-btn-primary">Enrich next 10 creators</button>
          <pre id="enrich-result" class="cl-admin-log"></pre>
        </section>

        <section id="tab-stats" class="cl-admin-tab-body hidden">
          <div id="stats-grid" class="cl-stats-grid"></div>
        </section>
      </div>

    </section>

  </main>
</div>

<script src="/assets/admin.js" defer></script>
</body>
</html>`;

  return htmlResponse(html);
}

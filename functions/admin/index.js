// ================================================================
// functions/admin/index.js
// GET /admin
// Admin panel shell. The password prompt happens client-side,
// the actual API calls send X-Admin-Password with every request.
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
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<nav class="cl-nav">
  <a href="/" class="cl-nav-brand">
    <span class="cl-wordmark">ContentLore<span class="dot">.</span></span>
    <span class="cl-admin-badge">Admin</span>
  </a>
</nav>

<main class="cl-admin">
  <div id="auth-wall" class="cl-admin-auth">
    <h1>Admin access</h1>
    <p class="cl-muted">Password required.</p>
    <form id="auth-form">
      <input type="password" id="admin-password-input" placeholder="Admin password" 
             autocomplete="current-password" required>
      <button type="submit">Unlock</button>
    </form>
    <p id="auth-error" class="cl-error hidden"></p>
  </div>

  <div id="admin-panel" class="cl-admin-panel hidden">
    <div class="cl-admin-tabs">
      <button class="cl-admin-tab active" data-tab="pending">Pending review</button>
      <button class="cl-admin-tab" data-tab="enrich">Bio enrichment</button>
      <button class="cl-admin-tab" data-tab="stats">Catalogue stats</button>
    </div>

    <section id="tab-pending" class="cl-admin-tab-body active">
      <div class="cl-admin-toolbar">
        <span id="pending-count">Loading…</span>
        <button id="bulk-approve-all" class="cl-admin-btn-secondary">Approve ALL</button>
        <button id="bulk-reject-all" class="cl-admin-btn-danger">Reject ALL</button>
      </div>
      <div id="pending-list" class="cl-pending-list"></div>
    </section>

    <section id="tab-enrich" class="cl-admin-tab-body hidden">
      <p>Run Claude Haiku over creators with empty or short bios.</p>
      <button id="enrich-btn" class="cl-admin-btn-primary">✨ Enrich next 10 creators</button>
      <pre id="enrich-result" class="cl-admin-log"></pre>
    </section>

    <section id="tab-stats" class="cl-admin-tab-body hidden">
      <div id="stats-grid" class="cl-stats-grid">Loading…</div>
    </section>
  </div>
</main>

<script src="/assets/admin.js" defer></script>
</body>
</html>`;

  return htmlResponse(html);
}

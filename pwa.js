// ================================================================
// pwa.js — service-worker registration + install-prompt banner
//
// Loaded with `defer` from every hub page. Two responsibilities:
//
// 1. Register /sw.js. Quiet failures — SW is progressive
//    enhancement; the site works without it.
// 2. Track repeat visits in localStorage, capture the
//    `beforeinstallprompt` event on Chromium browsers, and show
//    a small dismissable banner on the user's 2nd-or-later visit
//    inviting them to install the app.
//
// iOS doesn't fire beforeinstallprompt; for Safari users we show
// the banner with manual instructions instead.
// ================================================================

(function () {
  if (!('serviceWorker' in navigator)) return;

  // --- 1. Register the SW. ---
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });

  // --- 2. Visit counter. ---
  const VISIT_KEY = 'cl:visits:v1';
  const DISMISS_KEY = 'cl:install-dismissed:v1';
  const INSTALLED_KEY = 'cl:installed:v1';

  let visits = 0;
  try { visits = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) || 0; } catch {}
  visits += 1;
  try { localStorage.setItem(VISIT_KEY, String(visits)); } catch {}

  // Don't pester users who installed or already dismissed.
  let dismissed = false, installed = false;
  try {
    dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    installed = localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {}

  // Already running as installed PWA? Mark and bail.
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
    return;
  }
  if (installed || dismissed) return;
  if (visits < 2) return; // Wait for second-or-later visit.

  // --- 3. Capture the prompt event (Chromium). ---
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });
  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
    hideBanner();
  });

  // --- 4. iOS Safari — no beforeinstallprompt; surface manual hint. ---
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS && isSafari) {
    // Defer to next tick so the rest of the page paints first.
    setTimeout(showBanner, 1500);
  }

  // --- 5. Banner UI. ---
  function showBanner() {
    if (document.getElementById('cl-pwa-banner')) return;
    const el = document.createElement('div');
    el.id = 'cl-pwa-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Install ContentLore as an app');
    el.innerHTML = `
      <style>
        #cl-pwa-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);
          z-index:9999;display:flex;align-items:center;gap:12px;
          background:oklch(0.14 0.05 190);color:oklch(0.97 0.02 320);
          border:1px solid oklch(0.28 0.06 190);padding:12px 14px;
          font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:1px;
          box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:calc(100vw - 32px);
          clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
        #cl-pwa-banner img{width:32px;height:32px;flex:none}
        #cl-pwa-banner .cl-pwa-text{flex:1;line-height:1.4}
        #cl-pwa-banner .cl-pwa-text strong{color:oklch(0.85 0.18 200);font-family:'Bebas Neue',Impact,sans-serif;font-size:16px;letter-spacing:1.5px;display:block}
        #cl-pwa-banner button{font-family:inherit;font-size:11px;letter-spacing:1px;
          text-transform:uppercase;border:1px solid oklch(0.82 0.20 195);
          background:oklch(0.82 0.20 195/.12);color:oklch(0.85 0.18 200);
          padding:7px 12px;cursor:pointer;transition:background .15s}
        #cl-pwa-banner button:hover{background:oklch(0.82 0.20 195/.22)}
        #cl-pwa-banner button.cl-pwa-secondary{border-color:oklch(0.28 0.06 190);
          background:transparent;color:oklch(0.55 0.06 190)}
        @media(max-width:520px){#cl-pwa-banner{flex-wrap:wrap;font-size:11px}}
      </style>
      <img src="/logo.png" alt="">
      <div class="cl-pwa-text">
        <strong>Install ContentLore</strong>
        <span id="cl-pwa-message">Add to your home screen for quicker access.</span>
      </div>
      <button id="cl-pwa-install" type="button">Install</button>
      <button id="cl-pwa-dismiss" class="cl-pwa-secondary" type="button" aria-label="Dismiss">×</button>
    `;
    document.body.appendChild(el);

    if (isIOS && isSafari) {
      el.querySelector('#cl-pwa-message').textContent =
        'Tap the share icon, then "Add to Home Screen".';
      const installBtn = el.querySelector('#cl-pwa-install');
      installBtn.style.display = 'none';
    }

    el.querySelector('#cl-pwa-install').addEventListener('click', async () => {
      if (!deferredPrompt) { hideBanner(); return; }
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
        } else {
          try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
        }
      } catch {}
      deferredPrompt = null;
      hideBanner();
    });
    el.querySelector('#cl-pwa-dismiss').addEventListener('click', () => {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
      hideBanner();
    });
  }
  function hideBanner() {
    const el = document.getElementById('cl-pwa-banner');
    if (el) el.remove();
  }
})();

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

// ----------------------------------------------------------------
// Mobile nav drawer — inject a hamburger + slide-out menu on every
// hub page that has a `.nav > .nav-links` structure. Active under
// <=900px (matches the chat-drawer breakpoint so the nav and chat
// don't fight for horizontal space at the same viewport sizes).
// ----------------------------------------------------------------
(function () {
  const STYLE = `
    .cl-mn-btn{display:none}
    @media(max-width:900px){
      .nav .nav-links{display:none !important}
      .cl-mn-btn{display:inline-flex;align-items:center;justify-content:center;
        width:36px;height:36px;background:none;border:1px solid oklch(0.28 0.06 190);
        color:oklch(0.97 0.02 320);cursor:pointer;font-size:18px;line-height:1;
        margin-left:auto;margin-right:0;flex:none;padding:0}
      .cl-mn-btn:hover{border-color:oklch(0.82 0.20 195);color:oklch(0.85 0.18 200)}
      .cl-mn-btn .bars{display:flex;flex-direction:column;gap:4px}
      .cl-mn-btn .bars span{display:block;width:18px;height:2px;background:currentColor;border-radius:2px;transition:transform .2s,opacity .2s}
      body.cl-mn-open .cl-mn-btn .bars span:nth-child(1){transform:translateY(6px) rotate(45deg)}
      body.cl-mn-open .cl-mn-btn .bars span:nth-child(2){opacity:0}
      body.cl-mn-open .cl-mn-btn .bars span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
    }
    .cl-mn-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:198;opacity:0;
      pointer-events:none;transition:opacity .2s}
    body.cl-mn-open .cl-mn-overlay{opacity:1;pointer-events:auto}
    .cl-mn-drawer{position:fixed;top:0;right:0;bottom:0;width:min(280px,82vw);z-index:199;
      background:oklch(0.14 0.05 190);border-left:1px solid oklch(0.28 0.06 190);
      transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;
      box-shadow:-12px 0 32px rgba(0,0,0,.45);font-family:'JetBrains Mono',monospace}
    body.cl-mn-open .cl-mn-drawer{transform:translateX(0)}
    .cl-mn-drawer header{display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px;border-bottom:1px solid oklch(0.28 0.06 190);flex:none}
    .cl-mn-drawer header .ttl{font-family:'Bebas Neue',Impact,sans-serif;font-size:22px;
      letter-spacing:2px;color:oklch(0.97 0.02 320)}
    .cl-mn-drawer header .ttl .cl{color:oklch(0.82 0.20 195)}
    .cl-mn-drawer header .x{background:none;border:1px solid oklch(0.28 0.06 190);color:oklch(0.78 0.05 320);
      width:34px;height:34px;cursor:pointer;font:inherit;font-size:16px}
    .cl-mn-drawer header .x:hover{border-color:oklch(0.82 0.20 195);color:oklch(0.85 0.18 200)}
    .cl-mn-drawer nav{flex:1;overflow-y:auto;padding:8px 0}
    .cl-mn-drawer nav a{display:flex;align-items:center;gap:10px;padding:14px 18px;font-size:13px;
      letter-spacing:2px;text-transform:uppercase;color:oklch(0.78 0.05 320);text-decoration:none;
      border-left:3px solid transparent;transition:background .15s,color .15s,border-color .15s}
    .cl-mn-drawer nav a:hover{background:oklch(0.10 0.04 190);color:oklch(0.97 0.02 320);
      border-left-color:oklch(0.65 0.18 195)}
    .cl-mn-drawer nav a.active{color:oklch(0.85 0.18 200);border-left-color:oklch(0.82 0.20 195);
      background:oklch(0.82 0.20 195/.08)}
    .cl-mn-drawer footer{padding:14px 18px;border-top:1px solid oklch(0.28 0.06 190);
      font-size:11px;letter-spacing:2px;text-transform:uppercase;color:oklch(0.55 0.06 190);flex:none}
  `;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    const nav = document.querySelector('nav.nav');
    const links = document.querySelector('nav.nav .nav-links');
    if (!nav || !links) return;
    if (document.getElementById('cl-mn-btn')) return; // idempotent

    // Inject style.
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    // Hamburger button. Inserted as the last child of nav so it sits
    // on the right, with `margin-left:auto` shoving it past the brand.
    const btn = document.createElement('button');
    btn.id = 'cl-mn-btn';
    btn.type = 'button';
    btn.className = 'cl-mn-btn';
    btn.setAttribute('aria-label', 'Open navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="bars"><span></span><span></span><span></span></span>';
    nav.appendChild(btn);

    // Drawer + overlay (live in body so they're not constrained by
    // any nav z-index/overflow).
    const overlay = document.createElement('div');
    overlay.className = 'cl-mn-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const drawer = document.createElement('aside');
    drawer.className = 'cl-mn-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'ContentLore navigation');
    drawer.innerHTML = `
      <header>
        <div class="ttl"><span class="cl">CL</span> · MENU</div>
        <button class="x" type="button" aria-label="Close menu">✕</button>
      </header>
      <nav></nav>
      <footer>ContentLore · UK GTA RP</footer>
    `;

    // Mirror the existing nav-link items into the drawer. We don't
    // reuse the same DOM nodes so the desktop nav stays intact.
    const drawerNav = drawer.querySelector('nav');
    const items = links.querySelectorAll('a.nav-link');
    items.forEach(a => {
      const clone = document.createElement('a');
      clone.href = a.getAttribute('href') || '#';
      clone.textContent = a.textContent.trim();
      if (a.classList.contains('active') || a.classList.contains('nav-live')) {
        clone.classList.add('active');
      }
      drawerNav.appendChild(clone);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function open() {
      document.body.classList.add('cl-mn-open');
      btn.setAttribute('aria-expanded', 'true');
      overlay.setAttribute('aria-hidden', 'false');
      drawer.querySelector('.x').focus();
    }
    function close() {
      document.body.classList.remove('cl-mn-open');
      btn.setAttribute('aria-expanded', 'false');
      overlay.setAttribute('aria-hidden', 'true');
    }
    function toggle() {
      document.body.classList.contains('cl-mn-open') ? close() : open();
    }

    btn.addEventListener('click', toggle);
    overlay.addEventListener('click', close);
    drawer.querySelector('.x').addEventListener('click', close);
    drawer.querySelectorAll('nav a').forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('cl-mn-open')) close();
    });
  });
})();

// ----------------------------------------------------------------
// Notify-me button — opt-in browser push notifications.
//
// A page that wants the button drops <span data-cl-notify> (or
// any element with that data-attribute) into the DOM. This module
// hydrates each match into a working subscribe/unsubscribe button.
//
// Talks to:
//   GET  /api/push/vapid-public-key
//   POST /api/push/subscribe       { uuid, subscription, filter_handles? }
//   POST /api/push/unsubscribe     { endpoint }
//
// Anon UUID stored in localStorage as 'cl:user-uuid:v1'.
// ----------------------------------------------------------------
(function () {
  const NOTIFY_STYLE = `
    .cl-notify-btn{display:inline-flex;align-items:center;gap:6px;background:oklch(0.14 0.05 190);
      color:oklch(0.78 0.05 320);border:1px solid oklch(0.28 0.06 190);padding:8px 14px;
      cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;
      text-transform:uppercase;transition:all .15s;line-height:1;font-weight:500}
    .cl-notify-btn:hover{border-color:oklch(0.82 0.20 195);color:oklch(0.97 0.02 320)}
    .cl-notify-btn[data-state="on"]{border-color:oklch(0.82 0.20 195);color:oklch(0.85 0.18 200);
      background:oklch(0.82 0.20 195/.12);box-shadow:0 0 8px oklch(0.82 0.20 195/.3)}
    .cl-notify-btn[data-state="busy"]{cursor:wait;opacity:.7}
    .cl-notify-btn[data-state="denied"]{cursor:not-allowed;opacity:.6;border-color:oklch(0.68 0.27 25/.4);color:oklch(0.68 0.27 25)}
    .cl-notify-btn[data-state="unsupported"]{display:none}
    .cl-notify-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);
      background:oklch(0.14 0.05 190);color:oklch(0.97 0.02 320);
      border:1px solid oklch(0.82 0.20 195/.4);padding:10px 16px;
      font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:1px;
      box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:9999;opacity:0;pointer-events:none;
      transition:opacity .2s,transform .2s;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)}
    .cl-notify-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
  `;

  const UUID_KEY = 'cl:user-uuid:v1';
  const STATE_KEY = 'cl:push:endpoint:v1';

  function genUUID() {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'cl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function getUUID() {
    try {
      let u = localStorage.getItem(UUID_KEY);
      if (!u) { u = genUUID(); localStorage.setItem(UUID_KEY, u); }
      return u;
    } catch { return genUUID(); }
  }

  function urlBase64ToUint8(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function showToast(msg) {
    let t = document.getElementById('cl-notify-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cl-notify-toast';
      t.className = 'cl-notify-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => t.classList.remove('show'), 3400);
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    const mounts = document.querySelectorAll('[data-cl-notify]');
    if (!mounts.length) return;

    // Inject style once.
    if (!document.getElementById('cl-notify-style')) {
      const style = document.createElement('style');
      style.id = 'cl-notify-style';
      style.textContent = NOTIFY_STYLE;
      document.head.appendChild(style);
    }

    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    mounts.forEach(mount => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cl-notify-btn';
      btn.dataset.state = supported ? 'off' : 'unsupported';
      btn.innerHTML = '<span class="ic">🔔</span><span class="lbl">Notify me</span>';
      mount.appendChild(btn);

      if (!supported) return;
      if (Notification.permission === 'denied') {
        btn.dataset.state = 'denied';
        btn.title = 'Notifications blocked by browser settings.';
        btn.querySelector('.lbl').textContent = 'Blocked';
        btn.addEventListener('click', () => {
          showToast('Notifications are blocked — enable them in browser settings.');
        });
        return;
      }

      // Reflect current subscribed state on load.
      reflectState(btn);

      btn.addEventListener('click', () => onClick(btn, mount));
    });
  });

  async function reflectState(btn) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        btn.dataset.state = 'on';
        btn.querySelector('.lbl').textContent = 'Notifications on';
      }
    } catch { /* ignore */ }
  }

  async function onClick(btn, mount) {
    if (btn.dataset.state === 'busy') return;
    btn.dataset.state = 'busy';

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      if (existing) {
        // Unsubscribe path.
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        }).catch(() => {});
        await existing.unsubscribe().catch(() => {});
        btn.dataset.state = 'off';
        btn.querySelector('.lbl').textContent = 'Notify me';
        try { localStorage.removeItem(STATE_KEY); } catch {}
        showToast('Notifications turned off.');
        return;
      }

      // Subscribe path.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        btn.dataset.state = perm === 'denied' ? 'denied' : 'off';
        if (perm === 'denied') btn.querySelector('.lbl').textContent = 'Blocked';
        showToast(perm === 'denied' ? 'Notifications blocked — change in browser settings.' : 'Notifications not enabled.');
        return;
      }

      // Fetch the VAPID public key.
      const keyRes = await fetch('/api/push/vapid-public-key');
      const keyJson = await keyRes.json();
      if (!keyJson?.ok || !keyJson.key) {
        btn.dataset.state = 'off';
        showToast('Push not yet configured server-side.');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8(keyJson.key),
      });

      // Filter — `data-cl-notify="<handle>"` opts into one creator;
      // empty value (or `all`) opts into the whole curated 26.
      const raw = (mount.getAttribute('data-cl-notify') || '').trim().toLowerCase();
      const filter_handles = (!raw || raw === 'all') ? 'all' : [raw];

      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: getUUID(),
          subscription: sub.toJSON(),
          filter_handles,
        }),
      });
      const subJson = await subRes.json();
      if (!subJson?.ok) {
        // Roll back the browser-side sub if server rejected.
        await sub.unsubscribe().catch(() => {});
        btn.dataset.state = 'off';
        showToast('Subscription failed — try again later.');
        return;
      }

      try { localStorage.setItem(STATE_KEY, sub.endpoint); } catch {}
      btn.dataset.state = 'on';
      btn.querySelector('.lbl').textContent = 'Notifications on';
      showToast(filter_handles === 'all' ? "You'll get a ping when any curated creator goes live." : "You'll get a ping when this creator goes live.");
    } catch (err) {
      console.error('[push] subscribe error', err);
      btn.dataset.state = 'off';
      showToast('Something went wrong — try again.');
    }
  }
})();

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
          font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:1px;
          box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:calc(100vw - 32px);
          clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
        #cl-pwa-banner img{width:32px;height:32px;flex:none}
        #cl-pwa-banner .cl-pwa-text{flex:1;line-height:1.4}
        #cl-pwa-banner .cl-pwa-text strong{color:oklch(0.85 0.18 200);font-family:'Bebas Neue',Impact,sans-serif;font-size:16px;letter-spacing:1.5px;display:block}
        #cl-pwa-banner button{font-family:inherit;font-size:12px;letter-spacing:1px;
          text-transform:uppercase;border:1px solid oklch(0.82 0.20 195);
          background:oklch(0.82 0.20 195/.12);color:oklch(0.85 0.18 200);
          padding:7px 12px;cursor:pointer;transition:background .15s}
        #cl-pwa-banner button:hover{background:oklch(0.82 0.20 195/.22)}
        #cl-pwa-banner button.cl-pwa-secondary{border-color:oklch(0.28 0.06 190);
          background:transparent;color:oklch(0.55 0.06 190)}
        @media(max-width:520px){#cl-pwa-banner{flex-wrap:wrap;font-size:12px}}
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

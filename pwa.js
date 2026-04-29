// ================================================================
// pwa.js — site-wide visual layer + service-worker + install banner
//
// Loaded with `defer` from every hub page. Responsibilities:
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
// Background FX layer — perspective city grid + floating particles
// + vignette. Injected once as a fixed wrapper at z-index:2 so it
// sits above the per-page scanline (z:1) and below page content
// (z:3+). All three layers are pure CSS in cl-theme.css; this
// function only inserts the DOM scaffolding.
// ----------------------------------------------------------------
(function injectBgFx() {
  const PARTICLE_COUNT = 18;
  function mount() {
    if (document.getElementById('cl-bg-fx')) return;
    if (!document.body) return;
    const fx = document.createElement('div');
    fx.id = 'cl-bg-fx';
    fx.setAttribute('aria-hidden', 'true');
    let particles = '';
    for (let i = 0; i < PARTICLE_COUNT; i++) particles += '<span class="cl-p"></span>';
    fx.innerHTML =
      '<div class="cl-grid"></div>' +
      '<div class="cl-particles">' + particles + '</div>' +
      '<div class="cl-vignette"></div>';
    document.body.insertBefore(fx, document.body.firstChild);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();

// ----------------------------------------------------------------
// Nav restructure — desktop primary 4 + "More" dropdown, mobile
// hamburger drawer with grouped sections.
//
// The site originally had 11+ flat links across the top. This
// hides everything except the four primary destinations, drops the
// rest into a "More ▾" popover on desktop, and groups them into
// labelled sections in the mobile drawer.
//
// Source-of-truth lists below; existing per-page <a class="nav-link">
// items are matched by href and either kept, hidden (folded into
// the dropdown), or surfaced in their mobile group. Items not in any
// group (e.g. legacy "Now") fall through to the dropdown's tail so
// nothing becomes unreachable.
// ----------------------------------------------------------------
(function () {
  // Primary desktop links — always visible at >900px.
  const PRIMARY = [
    { href: '/gta-rp/',          label: 'Live' },
    { href: '/gta-rp/multi/',    label: 'Multi-View' },
    { href: '/gta-rp/rankings/', label: 'Rankings' },
    { href: '/gta-rp/clips/',    label: 'Clips' },
    { href: '/gta-rp/servers/',  label: 'Servers' },
  ];
  // Desktop "More" dropdown contents (in order shown).
  const MORE = [
    { href: '/gta-rp/timeline/',  label: 'Timeline' },
    { href: '/gta-rp/analytics/', label: 'Analytics' },
    { href: '/gta-rp/network/',   label: 'Network' },
    { href: '/gta-rp/health/',    label: 'Health' },
    { href: '/gta-rp/compare/',   label: 'Compare' },
    { href: '/gta-rp/streaks/',   label: 'Streaks' },
    { href: '/gta-rp/party/',     label: 'Party' },
    { href: '/gta-rp/now/',       label: 'Now' },
  ];
  // Mobile drawer groups.
  const MOBILE_GROUPS = [
    { label: 'Watch', items: [
      { href: '/gta-rp/',        label: 'Live' },
      { href: '/gta-rp/multi/',  label: 'Multi-View' },
      { href: '/gta-rp/party/',  label: 'Party' },
    ]},
    { label: 'Explore', items: [
      { href: '/gta-rp/clips/',    label: 'Clips' },
      { href: '/gta-rp/servers/',  label: 'Servers' },
      { href: '/gta-rp/compare/',  label: 'Compare' },
      { href: '/gta-rp/timeline/', label: 'Timeline' },
    ]},
    { label: 'Intelligence', items: [
      { href: '/gta-rp/rankings/',  label: 'Rankings' },
      { href: '/gta-rp/analytics/', label: 'Analytics' },
      { href: '/gta-rp/health/',    label: 'Health' },
      { href: '/gta-rp/network/',   label: 'Network' },
    ]},
    { label: 'Community', items: [
      { href: '/gta-rp/streaks/', label: 'Streaks' },
      { href: '/moderators/',     label: 'Mod Tools' },
      { href: '/submit/',         label: 'Submit' },
    ]},
  ];

  const STYLE = `
    /* ---------- Desktop "More" dropdown ---------- */
    .cl-more-wrap{position:relative;display:inline-flex;align-items:stretch}
    .cl-more-btn{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;
      text-transform:uppercase;color:oklch(0.78 0.05 320);background:transparent;border:0;
      padding:14px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;
      transition:color .15s}
    .cl-more-btn:hover,.cl-more-btn[aria-expanded="true"]{color:oklch(0.85 0.18 200)}
    .cl-more-btn .caret{display:inline-block;width:0;height:0;border-left:4px solid transparent;
      border-right:4px solid transparent;border-top:5px solid currentColor;
      transition:transform .15s}
    .cl-more-btn[aria-expanded="true"] .caret{transform:rotate(180deg)}
    .cl-more-pop{position:absolute;top:calc(100% + 6px);right:0;min-width:200px;z-index:120;
      background:oklch(0.10 0.04 195 / .92);backdrop-filter:blur(16px) saturate(1.1);
      -webkit-backdrop-filter:blur(16px) saturate(1.1);
      border:1px solid oklch(0.95 0.02 195 / .08);box-shadow:0 12px 36px rgba(0,0,0,.45);
      padding:6px 0;display:none;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)}
    .cl-more-pop[data-open="1"]{display:block}
    .cl-more-pop a{display:block;padding:10px 16px;font-family:'JetBrains Mono',monospace;
      font-size:12px;letter-spacing:2px;text-transform:uppercase;color:oklch(0.78 0.05 320);
      text-decoration:none;border-left:3px solid transparent;
      transition:background .12s,color .12s,border-left-color .12s}
    .cl-more-pop a:hover{background:oklch(0.82 0.20 195 / .10);color:oklch(0.97 0.02 320);
      border-left-color:oklch(0.65 0.18 195)}
    .cl-more-pop a.active{color:oklch(0.85 0.18 200);border-left-color:oklch(0.82 0.20 195);
      background:oklch(0.82 0.20 195 / .12)}

    /* ---------- Hamburger button (mobile only) ---------- */
    .cl-mn-btn{display:none}
    @media(max-width:900px){
      .nav .nav-links{display:none !important}
      .cl-more-wrap{display:none !important}
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

    /* ---------- Mobile drawer ---------- */
    .cl-mn-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:198;opacity:0;
      pointer-events:none;transition:opacity .2s}
    body.cl-mn-open .cl-mn-overlay{opacity:1;pointer-events:auto}
    .cl-mn-drawer{position:fixed;top:0;right:0;bottom:0;width:min(300px,84vw);z-index:199;
      background:oklch(0.10 0.04 195 / .96);backdrop-filter:blur(20px) saturate(1.1);
      -webkit-backdrop-filter:blur(20px) saturate(1.1);
      border-left:1px solid oklch(0.95 0.02 195 / .08);
      transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;
      box-shadow:-12px 0 32px rgba(0,0,0,.5);font-family:'JetBrains Mono',monospace}
    body.cl-mn-open .cl-mn-drawer{transform:translateX(0)}
    .cl-mn-drawer header{display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px;border-bottom:1px solid oklch(0.95 0.02 195 / .06);flex:none}
    .cl-mn-drawer header .ttl{font-family:'Bebas Neue',Impact,sans-serif;font-size:22px;
      letter-spacing:2px;color:oklch(0.97 0.02 320)}
    .cl-mn-drawer header .ttl .cl{color:oklch(0.82 0.20 195)}
    .cl-mn-drawer header .x{background:none;border:1px solid oklch(0.28 0.06 190);color:oklch(0.78 0.05 320);
      width:34px;height:34px;cursor:pointer;font:inherit;font-size:16px}
    .cl-mn-drawer header .x:hover{border-color:oklch(0.82 0.20 195);color:oklch(0.85 0.18 200)}
    .cl-mn-drawer nav{flex:1;overflow-y:auto;padding:8px 0 16px}
    .cl-mn-group{padding:14px 18px 6px;font-size:11px;letter-spacing:3px;text-transform:uppercase;
      color:oklch(0.55 0.06 195);font-weight:600}
    .cl-mn-drawer nav a{display:flex;align-items:center;gap:10px;padding:12px 18px;font-size:13px;
      letter-spacing:2px;text-transform:uppercase;color:oklch(0.78 0.05 320);text-decoration:none;
      border-left:3px solid transparent;transition:background .15s,color .15s,border-color .15s}
    .cl-mn-drawer nav a:hover{background:oklch(0.10 0.04 190);color:oklch(0.97 0.02 320);
      border-left-color:oklch(0.65 0.18 195)}
    .cl-mn-drawer nav a.active{color:oklch(0.85 0.18 200);border-left-color:oklch(0.82 0.20 195);
      background:oklch(0.82 0.20 195/.08)}
    .cl-mn-drawer footer{padding:14px 18px;border-top:1px solid oklch(0.95 0.02 195 / .06);
      font-size:11px;letter-spacing:2px;text-transform:uppercase;color:oklch(0.55 0.06 190);flex:none}
  `;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Normalise an href for matching: lowercase + ensure trailing slash on
  // gta-rp paths so '/gta-rp/multi' and '/gta-rp/multi/' both match.
  function norm(h) {
    if (!h) return '';
    let s = h.split('?')[0].split('#')[0].toLowerCase();
    if (s.endsWith('/index.html')) s = s.slice(0, -10);
    if (!s.endsWith('/') && !s.includes('.')) s += '/';
    return s;
  }
  const HERE = norm(location.pathname);

  ready(() => {
    const nav = document.querySelector('nav.nav');
    const links = document.querySelector('nav.nav .nav-links');
    if (!nav || !links) return;
    if (document.getElementById('cl-mn-btn')) return; // idempotent

    // Inject style.
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    // ---- Desktop: hide non-primary, inject "More" dropdown. -------
    // Index existing nav-links by normalised href so we can preserve
    // any inline content (e.g., the live-dot span on the Live link).
    const existing = new Map();
    links.querySelectorAll('a.nav-link').forEach(a => {
      existing.set(norm(a.getAttribute('href')), a);
    });

    const primaryHrefs = new Set(PRIMARY.map(p => norm(p.href)));

    // Hide every link that isn't in the primary 4. They get cloned
    // into the dropdown below.
    existing.forEach((a, h) => {
      if (!primaryHrefs.has(h)) a.style.display = 'none';
    });

    // Make sure every primary link exists in the desktop nav. If
    // missing (older page that hadn't updated), append it.
    PRIMARY.forEach(p => {
      const hn = norm(p.href);
      if (!existing.has(hn)) {
        const a = document.createElement('a');
        a.href = p.href;
        a.className = 'nav-link';
        a.textContent = p.label;
        if (HERE === hn) a.classList.add('active');
        links.appendChild(a);
        existing.set(hn, a);
      }
    });

    // Build the More dropdown.
    const moreWrap = document.createElement('div');
    moreWrap.className = 'cl-more-wrap';
    moreWrap.innerHTML = `
      <button class="cl-more-btn" type="button" aria-haspopup="true" aria-expanded="false">
        More <span class="caret"></span>
      </button>
      <div class="cl-more-pop" role="menu"></div>`;
    const moreBtn = moreWrap.querySelector('.cl-more-btn');
    const morePop = moreWrap.querySelector('.cl-more-pop');
    MORE.forEach(m => {
      const a = document.createElement('a');
      a.href = m.href;
      a.textContent = m.label;
      a.setAttribute('role', 'menuitem');
      if (HERE === norm(m.href)) a.classList.add('active');
      morePop.appendChild(a);
    });
    links.appendChild(moreWrap);

    function closeMore() {
      morePop.removeAttribute('data-open');
      moreBtn.setAttribute('aria-expanded', 'false');
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = morePop.getAttribute('data-open') === '1';
      if (open) closeMore();
      else { morePop.setAttribute('data-open', '1'); moreBtn.setAttribute('aria-expanded', 'true'); }
    });
    document.addEventListener('click', (e) => {
      if (!moreWrap.contains(e.target)) closeMore();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMore();
    });

    // ---- Mobile: hamburger button + grouped drawer. ---------------
    const btn = document.createElement('button');
    btn.id = 'cl-mn-btn';
    btn.type = 'button';
    btn.className = 'cl-mn-btn';
    btn.setAttribute('aria-label', 'Open navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="bars"><span></span><span></span><span></span></span>';
    nav.appendChild(btn);

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
    const drawerNav = drawer.querySelector('nav');
    MOBILE_GROUPS.forEach(group => {
      const lbl = document.createElement('div');
      lbl.className = 'cl-mn-group';
      lbl.textContent = group.label;
      drawerNav.appendChild(lbl);
      group.items.forEach(item => {
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        if (HERE === norm(item.href)) a.classList.add('active');
        drawerNav.appendChild(a);
      });
    });

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function openDrawer() {
      document.body.classList.add('cl-mn-open');
      btn.setAttribute('aria-expanded', 'true');
      overlay.setAttribute('aria-hidden', 'false');
      drawer.querySelector('.x').focus();
    }
    function closeDrawer() {
      document.body.classList.remove('cl-mn-open');
      btn.setAttribute('aria-expanded', 'false');
      overlay.setAttribute('aria-hidden', 'true');
    }
    btn.addEventListener('click', () => {
      document.body.classList.contains('cl-mn-open') ? closeDrawer() : openDrawer();
    });
    overlay.addEventListener('click', closeDrawer);
    drawer.querySelector('.x').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('cl-mn-open')) closeDrawer();
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
      showToast(filter_handles === 'all' ? "You'll get a ping when any tracked streamer goes live." : "You'll get a ping when this streamer goes live.");
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

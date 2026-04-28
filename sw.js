// ================================================================
// sw.js — ContentLore service worker
//
// Strategy:
//   - Static shell (logo, favicons, manifest, fonts, /pwa.js):
//     cache-first, falling back to network. Updated via cache name
//     bump on each new release.
//   - HTML pages: network-first with cache fallback so offline users
//     see the last-good page rather than nothing.
//   - /api/*: network-first, no cache fallback (live data must be
//     fresh; an offline API response is worse than a clear failure).
//
// Cache name embeds a version stamp so deploys evict the previous
// shell cleanly. Bump SW_VERSION when shipping shell changes.
// ================================================================

const SW_VERSION = 'cl-2026-04-28-3';
const SHELL_CACHE = `shell-${SW_VERSION}`;
const HTML_CACHE  = `html-${SW_VERSION}`;

const SHELL_ASSETS = [
  '/manifest.json',
  '/logo.png',
  '/favicon.png',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/pwa.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Best-effort precache; if any single asset fails (404 etc.) we
    // still install so SW activation isn't blocked.
    await Promise.allSettled(SHELL_ASSETS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== SHELL_CACHE && k !== HTML_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin only — don't intercept Twitch/Kick/CDN requests.
  if (url.origin !== self.location.origin) return;

  // /api/* → network-first, no offline fallback.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // HTML navigation → network-first, fall back to cached page.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirstHtml(req));
    return;
  }

  // Static shell → cache-first.
  event.respondWith(cacheFirst(req));
});

async function networkFirstHtml(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cache = await caches.open(HTML_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Offline + no cached version — serve any cached HTML so users at
    // least see something from the app shell.
    const fallback = await cache.match('/gta-rp/') || await cache.match('/');
    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    return cached || new Response('', { status: 504 });
  }
}

// ----------------------------------------------------------------
// Push notification handler — Phase 5 PWA #4 wiring.
// Receives encrypted payload from the scheduler's web-push call,
// shows a native browser notification with a click-through to the
// streamer's profile (or stream URL).
// ----------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* malformed */ }

  const title = data.title || 'ContentLore';
  const options = {
    body: data.body || 'A creator just went live on the UK GTA RP scene.',
    icon: data.icon || '/logo.png',
    badge: data.badge || '/favicon.png',
    tag: data.tag || 'cl-go-live',
    renotify: !!data.renotify,
    data: { url: data.url || '/gta-rp/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/gta-rp/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an existing window if one is already on contentlore.com
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) {
        c.navigate(url);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

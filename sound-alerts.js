// ContentLore — sound alerts when a curated creator goes live.
// Toggleable, off by default, all client-side. State in localStorage.
// Plays a synthesised two-note chime via Web Audio — no asset to ship.
//
// Wire up by adding `<script src="/sound-alerts.js" defer></script>` to
// any page that should announce go-live transitions.
(function () {
  if (typeof window === 'undefined') return;

  var LS_ENABLED = 'cl:sound:on';      // '1' | '0'
  var LS_LASTSET = 'cl:sound:lastset:v1'; // JSON array of currently-live handles
  var POLL_MS = 60_000;
  var ENDPOINT = '/api/uk-rp-live';

  // Skip on bots, on print, and when the user prefers reduced motion (proxy
  // for "don't bug me with sound either"). The opt-in toggle still wins —
  // we show the toggle even with reduced-motion, just keep alerts off by
  // default.
  if (/bot|crawl|spider/i.test(navigator.userAgent)) return;

  function isEnabled() {
    try { return localStorage.getItem(LS_ENABLED) === '1'; } catch (_) { return false; }
  }
  function setEnabled(v) {
    try { localStorage.setItem(LS_ENABLED, v ? '1' : '0'); } catch (_) {}
    updateButtons();
  }
  function readLast() {
    try {
      var raw = localStorage.getItem(LS_LASTSET);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function writeLast(arr) {
    try { localStorage.setItem(LS_LASTSET, JSON.stringify(arr)); } catch (_) {}
  }

  // ---------- Web Audio chime ----------
  var ctx = null;
  function getCtx() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
    return ctx;
  }
  function playChime() {
    var ac = getCtx();
    if (!ac) return;
    // Many browsers suspend the AudioContext until a user gesture has
    // happened. The first toggle click resumes it; subsequent chimes work.
    if (ac.state === 'suspended') { try { ac.resume(); } catch (_) {} }

    var now = ac.currentTime;
    function note(freq, t0, dur) {
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0, now + t0);
      gain.gain.linearRampToValueAtTime(0.22, now + t0 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + t0);
      osc.stop(now + t0 + dur + 0.05);
    }
    // Two-note chime: 880Hz then 1175Hz (A5 → D6). Short, bright.
    note(880, 0, 0.18);
    note(1175, 0.16, 0.30);
  }

  // ---------- Toggle button ----------
  var BTN_HTML = function (on) {
    return '<span class="cl-sound-icon" aria-hidden="true">' + (on ? '🔔' : '🔕') + '</span>'
         + '<span class="cl-sound-text">' + (on ? 'Sound on' : 'Sound off') + '</span>';
  };

  function injectStyle() {
    if (document.getElementById('cl-sound-style')) return;
    var s = document.createElement('style');
    s.id = 'cl-sound-style';
    s.textContent = ''
      + '.cl-sound-btn{display:inline-flex;align-items:center;gap:7px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding:7px 12px;background:transparent;border:1px solid currentColor;color:rgba(255,255,255,.55);cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent}'
      + '.cl-sound-btn:hover{color:oklch(0.85 0.18 200);border-color:oklch(0.85 0.18 200)}'
      + '.cl-sound-btn.on{color:oklch(0.82 0.20 195);border-color:oklch(0.82 0.20 195);background:oklch(0.82 0.20 195/.10)}'
      + '.cl-sound-btn .cl-sound-icon{font-size:14px;line-height:1}'
      + '.cl-sound-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:oklch(0.14 0.05 190);border:1px solid oklch(0.82 0.20 195);color:oklch(0.97 0.02 320);font-family:JetBrains Mono,monospace;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 16px;border-radius:2px;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);z-index:9998;opacity:0;pointer-events:none;transition:transform .25s,opacity .25s;display:flex;align-items:center;gap:8px;box-shadow:0 6px 24px rgba(0,0,0,.45)}'
      + '.cl-sound-toast.show{transform:translateX(-50%) translateY(0);opacity:1}';
    document.head.appendChild(s);
  }

  function updateButtons() {
    var on = isEnabled();
    document.querySelectorAll('.cl-sound-btn').forEach(function (b) {
      b.classList.toggle('on', on);
      b.innerHTML = BTN_HTML(on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function attachButton(btn) {
    btn.classList.add('cl-sound-btn');
    btn.type = 'button';
    btn.innerHTML = BTN_HTML(isEnabled());
    btn.setAttribute('aria-pressed', isEnabled() ? 'true' : 'false');
    btn.addEventListener('click', function () {
      var newState = !isEnabled();
      setEnabled(newState);
      if (newState) {
        // First user gesture — play a tiny test chime so they hear what
        // it sounds like and the AudioContext is unlocked for later.
        playChime();
        showToast('🔔 Sound alerts on — you\'ll hear a chime when a tracked creator goes live.');
      } else {
        showToast('🔕 Sound alerts off.');
      }
    });
  }

  function hydrate() {
    injectStyle();
    document.querySelectorAll('[data-cl-sound]').forEach(attachButton);
  }

  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'cl-sound-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 320);
    }, 2600);
  }

  // ---------- Polling go-live transitions ----------
  async function poll() {
    try {
      var res = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!res.ok) return;
      var json = await res.json();
      var live = (json.live || []).filter(function (c) { return c.is_live; });
      var nowSet = live.map(function (c) { return c.handle; }).sort();
      var prev = readLast();

      // First run on this device — record the current set without alerting.
      // Otherwise opening the page during a busy window would dump a chime
      // for every creator who happens to be on right now.
      if (!Array.isArray(prev)) {
        writeLast(nowSet);
        return;
      }

      if (isEnabled()) {
        var prevSet = new Set(prev);
        var fresh = nowSet.filter(function (h) { return !prevSet.has(h); });
        if (fresh.length) {
          playChime();
          var first = live.find(function (c) { return c.handle === fresh[0]; });
          var name = first?.display_name || fresh[0];
          var more = fresh.length > 1 ? ' +' + (fresh.length - 1) + ' more' : '';
          showToast('🔴 ' + name + ' went live' + more);
        }
      }
      writeLast(nowSet);
    } catch (_) { /* swallow */ }
  }

  // ---------- Boot ----------
  function start() {
    hydrate();
    // Initial state: just record the live set without chiming.
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

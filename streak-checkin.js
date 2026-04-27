// ContentLore — passive Watch Streak check-in.
// Loaded with `defer` on hub pages; fires once per session, only if the
// user has explicitly opted in via /gta-rp/streaks/. Silent on failure.
(function () {
  var KEY_OPT  = 'cl:streak:optin';
  var KEY_UID  = 'cl:streak:uid';
  var KEY_NAME = 'cl:streak:name';
  var SESS_FLAG = 'cl:streak:checked';

  try {
    if (localStorage.getItem(KEY_OPT) !== '1') return;
    var uid = localStorage.getItem(KEY_UID);
    if (!uid) return;
    if (sessionStorage.getItem(SESS_FLAG) === '1') return;
  } catch (_) { return; }

  // Defer until idle so we don't compete with first paint.
  var fire = function () {
    try {
      fetch('/api/streaks/check-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: uid,
          display_name: localStorage.getItem(KEY_NAME) || null,
        }),
        keepalive: true,
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.ok) {
            try { sessionStorage.setItem(SESS_FLAG, '1'); } catch (_) {}
          }
        })
        .catch(function () { /* silent */ });
    } catch (_) { /* silent */ }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(fire, { timeout: 4000 });
  } else {
    setTimeout(fire, 1500);
  }
})();

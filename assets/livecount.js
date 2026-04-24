// ================================================================
// /assets/livecount.js
// Updates sidebar "23 live right now" indicator.
// Fetches /api/live (implemented below) to get current live counts.
// Graceful fallback — if the endpoint 404s, hides the indicator.
// ================================================================

(function () {
  const stat = document.getElementById('live-stat');
  const countEl = document.getElementById('live-count');
  const twitchEl = document.getElementById('live-twitch');
  const kickEl = document.getElementById('live-kick');
  const youtubeEl = document.getElementById('live-youtube');
  if (!stat || !countEl) return;

  const fetchLive = async () => {
    try {
      const res = await fetch('/api/live');
      if (!res.ok) {
        // Gracefully degrade — just show total tracked count
        stat.style.display = 'none';
        return;
      }
      const data = await res.json();
      if (data.ok) {
        countEl.textContent = data.total || 0;
        if (twitchEl) twitchEl.textContent = `Twitch ${data.twitch || 0}`;
        if (kickEl) kickEl.textContent = `Kick ${data.kick || 0}`;
        if (youtubeEl) youtubeEl.textContent = `YouTube ${data.youtube || 0}`;
      }
    } catch (e) {
      stat.style.display = 'none';
    }
  };

  fetchLive();
  // Poll every 5 min
  setInterval(fetchLive, 5 * 60 * 1000);
})();

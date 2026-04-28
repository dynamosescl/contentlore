// ================================================================
// functions/api/hype.js
// GET /api/hype
//
// "Scene energy" gauge. Compares the current live state of the
// curated 26 against the rolling 7-day average for THIS hour-of-day
// (UTC). Returns a status band, a percentage, and the underlying
// numbers so the client can render a meter without re-deriving them.
//
// Driven by /api/uk-rp-live for the "current" half (so we agree with
// the hero stats) and a hand-rolled D1 query for the "average" half
// over the trailing 7 days. 60s Cache API hit.
// ================================================================

import { jsonResponse } from '../_lib.js';

const ALLOWED_HANDLES = new Set([
  'tyrone', 'lbmm', 'reeclare', 'stoker', 'samham', 'deggyuk',
  'megsmary', 'tazzthegeeza', 'wheelydev', 'rexality', 'steeel',
  'justj0hnnyhd', 'cherish_remedy', 'lorddorro', 'jck0__', 'absthename',
  'essellz', 'lewthescot', 'angels365', 'fantasiasfantasy',
  'kavsual', 'shammers', 'bags', 'dynamoses', 'dcampion', 'elliewaller',
]);

const CACHE_TTL = 60;

function bandFor(pct) {
  if (pct == null) return { id: 'unknown', label: 'Building data', emoji: '📡', color: 'var(--ink-faint)' };
  if (pct >= 200) return { id: 'fire',    label: 'Scene on fire',  emoji: '🔥', color: 'oklch(0.68 0.27 25)' };
  if (pct >= 100) return { id: 'heating', label: 'Heating up',     emoji: '⚡', color: 'oklch(0.78 0.22 50)' };
  if (pct >= 50)  return { id: 'normal',  label: 'Normal energy',  emoji: '✅', color: 'oklch(0.82 0.20 195)' };
  return            { id: 'quiet',   label: 'Scene quiet',     emoji: '😴', color: 'oklch(0.65 0.18 245)' };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/hype/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;
    const currentHour = new Date().getUTCHours();

    // Use the same source-of-truth as the homepage hero — direct
    // platform APIs, not D1 — so the meter never disagrees with the
    // creators-on count rendered next to it.
    const liveRes = await fetch(new URL('/api/uk-rp-live', request.url).toString());
    const liveJson = await liveRes.json().catch(() => ({}));
    const liveList = Array.isArray(liveJson?.live) ? liveJson.live.filter(s => s.is_live) : [];
    const currentLiveCount = liveList.length;
    const currentViewers = liveList.reduce((s, c) => s + (Number(c.viewers) || 0), 0);

    // Average viewers + average distinct-creators-live for this
    // hour-of-day across the trailing 7 days. Bucket by full hour
    // (UTC) so we can take a clean per-hour mean.
    const hourRes = await env.DB.prepare(`
      SELECT
        (s.captured_at / 3600) AS hour_bucket,
        SUM(s.viewers) AS total_viewers,
        COUNT(DISTINCT s.creator_id) AS unique_live
      FROM snapshots s
      INNER JOIN creator_platforms cp ON cp.creator_id = s.creator_id AND cp.is_primary = 1
      WHERE s.captured_at >= ?
        AND s.is_live = 1
      GROUP BY hour_bucket
      ORDER BY hour_bucket ASC
    `).bind(sevenDaysAgo).all();

    let viewerSum = 0, viewerSamples = 0;
    let liveSum = 0, liveSamples = 0;
    for (const r of (hourRes.results || [])) {
      const ts = Number(r.hour_bucket) * 3600;
      const hod = new Date(ts * 1000).getUTCHours();
      if (hod !== currentHour) continue;
      viewerSum += Number(r.total_viewers || 0);
      viewerSamples += 1;
      liveSum += Number(r.unique_live || 0);
      liveSamples += 1;
    }
    const avgViewers = viewerSamples > 0 ? Math.round(viewerSum / viewerSamples) : null;
    const avgLive = liveSamples > 0 ? Math.round((liveSum / liveSamples) * 10) / 10 : null;

    // Composite ratio: blend creator count and viewer count 50/50.
    // Anchors the meter to "scene volume" rather than just one
    // streamer pulling a huge crowd, which would otherwise jump the
    // viewer ratio without the scene actually being busier.
    let ratio = null;
    if (avgViewers != null && avgLive != null && avgViewers > 0 && avgLive > 0) {
      const viewerRatio = (currentViewers / avgViewers) * 100;
      const liveRatio = (currentLiveCount / avgLive) * 100;
      ratio = Math.round((viewerRatio + liveRatio) / 2);
    } else if (avgViewers != null && avgViewers > 0) {
      ratio = Math.round((currentViewers / avgViewers) * 100);
    }

    const band = bandFor(ratio);

    const payload = {
      ok: true,
      current: { live_count: currentLiveCount, viewers: currentViewers },
      average: { live_count: avgLive, viewers: avgViewers, samples: viewerSamples },
      ratio_pct: ratio,
      band,
      hour_utc: currentHour,
      fetched_at: new Date().toISOString(),
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, s-maxage=${CACHE_TTL}`,
      },
    });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

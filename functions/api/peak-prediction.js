// ================================================================
// functions/api/peak-prediction.js
// GET /api/peak-prediction
//
// Predicts tonight's peak total scene viewer count and the hour it's
// likely to land in. Uses the last 30 days of `snapshots` aggregated
// at the (UK day-of-week × UK hour-of-day) level.
//
// Algorithm:
//   1. SUM viewers per snapshot poll (≈ every 15 minutes) — that's
//      "total scene viewers at moment T".
//   2. Bucket each poll into (uk_dow, uk_hod).
//   3. For today's UK dow, take the avg of each hour's poll-totals.
//   4. Pick the hour with the highest avg as the predicted peak hour;
//      use the average of the top 25% of poll-totals in that hour as
//      the predicted peak count (more robust than mean alone).
//
// 1h Cache API hit at /cache/peak-prediction/v1.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

const CACHE_TTL = 3600;
const WINDOW_DAYS = 30;
const POLL_BUCKET_SECONDS = 600; // round timestamps to 10-minute slots so curators sharing the same tick collapse to one "moment"

function ukDowHod(unixSec) {
  const m = new Date(unixSec * 1000).getUTCMonth();
  const offset = (m >= 2 && m <= 9) ? 1 : 0; // BST approx
  const d = new Date((unixSec + offset * 3600) * 1000);
  // Mon=0..Sun=6
  const dow = (d.getUTCDay() + 6) % 7;
  return { dow, hod: d.getUTCHours() };
}

function formatHour(h) {
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request('https://contentlore.com/cache/peak-prediction/v1');
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const allowed = await getHandlesSet(env);
    const now = Math.floor(Date.now() / 1000);
    const since = now - WINDOW_DAYS * 86400;

    const res = await env.DB.prepare(`
      SELECT cp.handle, ss.viewers, ss.captured_at
        FROM snapshots ss
        INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
       WHERE ss.is_live = 1
         AND ss.captured_at >= ?
         AND ss.viewers > 0
    `).bind(since).all();

    const rows = (res.results || []).filter(r =>
      allowed.has(String(r.handle).toLowerCase())
    );

    // Step 1 — collapse polls onto a 10-minute time grid so we get
    // "scene total at moment T" rather than per-creator counts.
    const slotTotals = new Map(); // bucket -> total viewers
    for (const r of rows) {
      const t = Number(r.captured_at);
      const bucket = Math.floor(t / POLL_BUCKET_SECONDS) * POLL_BUCKET_SECONDS;
      slotTotals.set(bucket, (slotTotals.get(bucket) || 0) + Number(r.viewers || 0));
    }

    // Step 2 — group bucket totals by (uk_dow, uk_hod).
    const byDowHod = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
    for (const [bucket, total] of slotTotals) {
      const { dow, hod } = ukDowHod(bucket);
      byDowHod[dow][hod].push(total);
    }

    // Step 3 — for today's UK dow, build hour averages and a global
    // upper-quartile estimate for "peak count".
    const tnow = ukDowHod(now);
    const todayHours = byDowHod[tnow.dow];
    const hourAvg = todayHours.map(arr => {
      if (!arr.length) return { avg: 0, samples: 0 };
      const sum = arr.reduce((a, b) => a + b, 0);
      return { avg: sum / arr.length, samples: arr.length };
    });

    // Step 4 — pick the predicted peak hour for today.
    let peakIdx = 0;
    for (let h = 1; h < 24; h++) {
      if (hourAvg[h].avg > hourAvg[peakIdx].avg) peakIdx = h;
    }
    const peakHour = peakIdx;
    const peakHourSamples = hourAvg[peakIdx].samples;

    // Robust peak-count estimate: top-quartile mean of polls inside the peak hour
    // bucket. Falls back to the overall avg if there aren't enough samples.
    const peakHourPolls = todayHours[peakHour].slice().sort((a, b) => b - a);
    const topQuartileLen = Math.max(1, Math.floor(peakHourPolls.length * 0.25));
    const predictedPeak = peakHourPolls.length
      ? Math.round(peakHourPolls.slice(0, topQuartileLen).reduce((a, b) => a + b, 0) / topQuartileLen)
      : 0;

    // Confidence: how many samples we had for today's full hour-of-day
    // distribution. <40 = thin baseline, ~120+ = strong.
    const totalSamples = hourAvg.reduce((s, x) => s + x.samples, 0);
    const confidence =
      totalSamples >= 120 ? 'high' :
      totalSamples >= 40  ? 'moderate' :
      totalSamples > 0    ? 'thin' : 'building';

    // Hour-by-hour distribution for the chart on the client side.
    // Each entry: { h: 0..23, avg: number, samples: number }
    const distribution = hourAvg.map((x, h) => ({ h, avg: Math.round(x.avg), samples: x.samples }));

    // "Right now" actual scene total — pulled from the freshest live cache
    // can be inferred client-side instead. Keep this endpoint pure-D1 to stay cacheable.

    const dows = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const payload = {
      ok: true,
      today_dow_label: dows[tnow.dow],
      now_uk_hour: tnow.hod,
      peak: {
        hour: peakHour,
        hour_label: formatHour(peakHour),
        viewers: predictedPeak,
        samples: peakHourSamples,
      },
      confidence,
      total_samples: totalSamples,
      window_days: WINDOW_DAYS,
      distribution,
      generated_at: new Date().toISOString(),
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

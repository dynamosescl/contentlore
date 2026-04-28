// ================================================================
// functions/api/scene-recap.js
// GET /api/scene-recap
//
// Auto-generated narrative summary of the UK GTA RP scene's last
// 7 days, written by Claude in the voice of a sports match reporter.
// Pulls structured data from /api/digest + /api/analytics, hands it
// to the Anthropic API, returns the prose plus the raw inputs so
// readers can verify.
//
// Cached for 6h via Cache API keyed on a 6-hour time bucket so the
// recap stays stable through a working session but refreshes on
// its own. Falls back to a deterministic prose template if the
// Anthropic call fails — never blocks the digest page.
// ================================================================

import { jsonResponse } from '../_lib.js';

const CACHE_TTL = 6 * 3600;
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 500;

function bucketKey() {
  // 6h bucket: 0,1,2,3 per UTC day. Combined with the date this
  // makes the cache key tick every 6h on its own.
  const now = new Date();
  const bucket = Math.floor(now.getUTCHours() / 6);
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${bucket}`;
}

function fmtN(n) {
  if (n == null) return 'unknown';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Deterministic fallback if the Anthropic call fails (no key, rate
// limit, network error). Better than a stack trace on the page.
function fallbackRecap(d) {
  const parts = [];
  parts.push(`Over the last seven days, the curated UK GTA RP scene logged ${fmtN(d.totalHours)} streamed hours across ${d.creatorsLive} creators.`);
  if (d.peak) {
    parts.push(`The peak moment came from ${d.peak.who}, pulling ${fmtN(d.peak.viewers)} viewers on ${d.peak.platform}.`);
  }
  if (d.topServer) {
    parts.push(`${d.topServer.name} was the busiest server in the rotation, with ${fmtN(d.topServer.viewer_hours)} viewer-hours.`);
  }
  if (d.topCreators?.length) {
    const lead = d.topCreators[0];
    parts.push(`${lead.display_name} led the hours leaderboard with ${lead.hours}h streamed.`);
  }
  parts.push('Auto-generated fallback — Claude wasn\'t reachable for this report.');
  return parts.join(' ');
}

async function callAnthropic(env, data) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const dataLines = [];
  dataLines.push(`Window: last 7 days (rolling, UTC)`);
  dataLines.push(`Total hours streamed across the curated 26: ${data.totalHours}`);
  dataLines.push(`Creators who went live: ${data.creatorsLive} of 26`);
  dataLines.push(`Total stream sessions: ${data.sessionsCount}`);
  if (data.peak) {
    dataLines.push(`Peak viewership moment: ${data.peak.who} on ${data.peak.platform} with ${data.peak.viewers} viewers, stream titled "${data.peak.title || '(no title)'}"`);
  }
  if (data.topServer) {
    dataLines.push(`Most active server: ${data.topServer.name} with ${data.topServer.viewer_hours} viewer-hours`);
  }
  if (data.allServers?.length) {
    dataLines.push(`Server rotation (viewer-hours): ${data.allServers.slice(0, 6).map(s => `${s.name}=${s.viewer_hours}`).join(', ')}`);
  }
  if (data.topCreators?.length) {
    dataLines.push(`Hours leaderboard: ${data.topCreators.slice(0, 5).map(c => `${c.display_name} ${c.hours}h (peak ${c.peak})`).join('; ')}`);
  }
  if (data.topClips?.length) {
    dataLines.push(`Top clips: ${data.topClips.slice(0, 5).map(c => `"${c.title}" by ${c.creator_name} (${c.view_count} views)`).join('; ')}`);
  }
  if (data.newCreators?.length) {
    dataLines.push(`New creators discovered this week: ${data.newCreators.map(c => c.name).join(', ')}`);
  }
  if (data.fastestGrowing?.length) {
    dataLines.push(`Fastest growing creators (vs prior week): ${data.fastestGrowing.slice(0, 3).map(g => `${g.display_name} +${g.delta_pct}%`).join(', ')}`);
  }

  const userPrompt = `Here is the data from the last 7 days of the UK GTA RP streaming scene:\n\n${dataLines.join('\n')}\n\nWrite the recap now.`;

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: 'You are a UK GTA RP scene reporter writing for ContentLore, a streaming intelligence site. Your audience already follows the scene. Write a 200-word engaging summary of what happened in the UK GTA RP scene based on the data provided. Write like a sports match reporter covering the day\'s action: vivid, specific, energetic. Name creators, servers, and viewer counts directly. Don\'t hedge, don\'t list — narrate. Don\'t open with "Here\'s your recap" or restate the prompt. Don\'t mention that the data is from the last 7 days unless it\'s relevant to a callout. Use UK English spelling. Output plain prose only — no headings, no markdown, no bullet points.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: userPrompt },
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  const recap = j?.content?.[0]?.text?.trim();
  if (!recap) throw new Error('Anthropic returned empty content');
  return {
    text: recap,
    usage: j?.usage || null,
    model: j?.model || MODEL,
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(`https://contentlore.com/cache/scene-recap/${bucketKey()}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    // Pull the same data the digest page sees, plus a bit of extra
    // analytics colour. Both endpoints are themselves edge-cached so
    // this is cheap.
    const [digestRes, analyticsRes] = await Promise.all([
      fetch(new URL('/api/digest', request.url).toString()),
      fetch(new URL('/api/analytics', request.url).toString()),
    ]);
    const digest = await digestRes.json().catch(() => ({}));
    const analytics = await analyticsRes.json().catch(() => ({}));

    const data = {
      totalHours: digest?.stats?.total_hours ?? 0,
      creatorsLive: digest?.stats?.unique_creators_live ?? 0,
      sessionsCount: digest?.stats?.sessions_count ?? 0,
      peak: digest?.peak_moment ? {
        who: digest.peak_moment.display_name || digest.peak_moment.handle,
        platform: digest.peak_moment.platform,
        viewers: digest.peak_moment.viewers,
        title: digest.peak_moment.title,
        ts: digest.peak_moment.ts,
      } : null,
      topServer: digest?.stats?.most_active_server || null,
      allServers: analytics?.server_hours || [],
      topCreators: digest?.top_creators || [],
      topClips: digest?.top_clips || [],
      newCreators: digest?.new_creators || [],
      fastestGrowing: analytics?.growth?.fastest || [],
    };

    let recap = null;
    let source = 'anthropic';
    try {
      recap = await callAnthropic(env, data);
    } catch (err) {
      // Surface the failure but don't 500 — give the page something
      // useful to render.
      recap = { text: fallbackRecap(data), usage: null, model: 'fallback', error: String(err?.message || err) };
      source = 'fallback';
    }

    const payload = {
      ok: true,
      source,
      recap: recap.text,
      model: recap.model,
      data,
      generated_at: new Date().toISOString(),
      bucket: bucketKey(),
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

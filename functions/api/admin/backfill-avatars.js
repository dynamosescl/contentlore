// ================================================================
// functions/api/admin/backfill-avatars.js
// POST /api/admin/backfill-avatars
// Fetches profile image URLs directly from Twitch and Kick for creators
// missing an avatar_url. Idempotent.
//
// Auth: X-Admin-Password required.
// Body: { limit?: number (default 50, cap 100), debug?: bool }
//
// Bypasses _lib.js helpers (they return null on error, swallowing failures).
// Calls APIs inline and throws real errors so we can see what's going wrong.
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../_lib.js';

// Twitch app token, cached in KV for 55 min
async function getTwitchAppToken(env, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await env.KV.get('twitch:app_token');
    if (cached) return cached;
  }
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `client_id=${env.TWITCH_CLIENT_ID}&client_secret=${env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!res.ok) throw new Error('twitch_token_' + res.status);
  const data = await res.json();
  await env.KV.put('twitch:app_token', data.access_token, { expirationTtl: 3300 });
  return data.access_token;
}

async function twitchAvatar(env, login) {
  let token = await getTwitchAppToken(env);
  let res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    { headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` } }
  );
  // If 401, cached token is stale — purge and retry once with a fresh token
  if (res.status === 401) {
    await env.KV.delete('twitch:app_token');
    token = await getTwitchAppToken(env, true);
    res = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
      { headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` } }
    );
  }
  if (!res.ok) throw new Error('twitch_user_' + res.status);
  const data = await res.json();
  const user = data?.data?.[0];
  return user?.profile_image_url || null;
}

// Browser-like headers to dodge Kick's anti-bot layer
const KICK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://kick.com/',
  'Origin': 'https://kick.com',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Kick — primary: v1 API (when not WAF-blocked). Fallback: scrape og:image from HTML.
// Kick's WAF is intermittent — sometimes 403s our Worker, sometimes 200s it.
// We try v1 first (cheaper), fall through to HTML if API is blocked.
async function kickAvatar(env, slug) {
  // Try v1 API
  try {
    const res = await fetch(`https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`, { headers: KICK_HEADERS });
    if (res.ok) {
      const data = await res.json();
      if (!data?.error && data?.user?.profile_pic) {
        return data.user.profile_pic;
      }
    }
  } catch { /* fall through */ }

  // Fallback: scrape the HTML page
  try {
    const res = await fetch(`https://kick.com/${encodeURIComponent(slug)}`, {
      headers: {
        ...KICK_HEADERS,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error('kick_html_' + res.status);
    const html = await res.text();
    const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1] && !ogMatch[1].includes('/img/default') && !ogMatch[1].includes('og-default')) {
      return ogMatch[1];
    }
    const jsonMatch = html.match(/"profile_pic"\s*:\s*"([^"]+)"/);
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1].replace(/\\\//g, '/');
    }
  } catch { /* give up */ }

  return null;
}

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try { body = await request.json(); } catch { /* fine */ }
  const limit = Math.min(parseInt(body?.limit || 50, 10), 100);
  const debug = body?.debug === true;

  try {
    // DEBUG — show extraction result for one of each platform
    if (debug) {
      const twitchSample = await env.DB.prepare(`
        SELECT c.id, c.display_name, cp.handle
        FROM creators c
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE cp.platform = 'twitch' AND cp.handle IS NOT NULL
        LIMIT 1
      `).first();
      const kickSample = await env.DB.prepare(`
        SELECT c.id, c.display_name, cp.handle
        FROM creators c
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE cp.platform = 'kick' AND cp.handle IS NOT NULL
        LIMIT 1
      `).first();

      const result = {};
      if (twitchSample) {
        try {
          result.twitch = { handle: twitchSample.handle, url: await twitchAvatar(env, twitchSample.handle) };
        } catch (e) { result.twitch_error = String(e?.message || e); }
      }
      if (kickSample) {
        try {
          const res = await fetch(`https://kick.com/${encodeURIComponent(kickSample.handle)}`, {
            headers: {
              ...KICK_HEADERS,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          const html = await res.text();
          const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          const jsonMatch = html.match(/"profile_pic"\s*:\s*"([^"]+)"/);
          result.kick = {
            handle: kickSample.handle,
            status: res.status,
            html_size: html.length,
            html_preview: html.substring(0, 200),
            og_image: ogMatch ? ogMatch[1] : null,
            profile_pic_json: jsonMatch ? jsonMatch[1].replace(/\\\//g, '/') : null,
            extracted: await (async () => {
              try { return await kickAvatar(env, kickSample.handle); } catch (e) { return 'error: ' + String(e?.message || e); }
            })(),
          };
        } catch (e) { result.kick_error = String(e?.message || e); }
      }
      return jsonResponse({ ok: true, debug: true, samples: result });
    }

    // Pull creators without an avatar
    const targetsRes = await env.DB.prepare(`
      SELECT c.id, c.display_name, cp.platform, cp.handle
      FROM creators c
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE c.role = 'creator'
        AND (c.avatar_url IS NULL OR LENGTH(c.avatar_url) < 8)
        AND cp.handle IS NOT NULL
      ORDER BY c.updated_at ASC
      LIMIT ?
    `).bind(limit).all();

    const targets = targetsRes.results || [];
    if (targets.length === 0) {
      return jsonResponse({ ok: true, done: true, processed: 0, updated: 0, message: 'No creators missing avatars' });
    }

    let updated = 0;
    const errors = [];
    const errorCounts = { fetch_failed: 0, no_avatar_in_response: 0, db_update_failed: 0, unknown_platform: 0 };
    const samples = [];

    for (const t of targets) {
      let avatarUrl = null;
      try {
        if (t.platform === 'twitch')      avatarUrl = await twitchAvatar(env, t.handle);
        else if (t.platform === 'kick')   {
          avatarUrl = await kickAvatar(env, t.handle);
          // Gentle pacing on Kick to reduce WAF block risk
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        else {
          errorCounts.unknown_platform++;
          errors.push({ id: t.id, category: 'unknown_platform', platform: t.platform });
          continue;
        }
      } catch (e) {
        errorCounts.fetch_failed++;
        errors.push({ id: t.id, category: 'fetch_failed', platform: t.platform, handle: t.handle, error: String(e?.message || e) });
        continue;
      }

      if (!avatarUrl) {
        errorCounts.no_avatar_in_response++;
        errors.push({ id: t.id, category: 'no_avatar_in_response', platform: t.platform, handle: t.handle });
        continue;
      }

      try {
        await env.DB
          .prepare(`UPDATE creators SET avatar_url = ?, updated_at = unixepoch() WHERE id = ?`)
          .bind(avatarUrl, t.id)
          .run();
        updated++;
        if (samples.length < 3) {
          samples.push({ id: t.id, display_name: t.display_name, avatar_url: avatarUrl });
        }
      } catch (dbErr) {
        errorCounts.db_update_failed++;
        errors.push({ id: t.id, category: 'db_update_failed', error: String(dbErr?.message || dbErr) });
      }
    }

    return jsonResponse({
      ok: true,
      processed: targets.length,
      updated,
      error_counts: errorCounts,
      error_sample: errors.slice(0, 5),
      samples,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

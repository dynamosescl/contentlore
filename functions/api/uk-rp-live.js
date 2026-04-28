// ================================================================
// functions/api/uk-rp-live.js
// GET /api/uk-rp-live
//
// Returns the curated UK GTA RP allowlist with live state pulled
// directly from Twitch + Kick APIs (bypasses the DB / scheduler).
// 90s edge cache (Cache API) to keep latency down without hammering
// platform APIs. KV is reserved for genuine state (tokens, kick avatars).
// ================================================================

import { jsonResponse, getTwitchToken, getKickToken } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const CACHE_URL = 'https://contentlore.com/cache/uk-rp-live';
const CACHE_TTL = 90; // seconds
const THUMB_SIZE = { w: 1280, h: 720 };
const KICK_AVATAR_TTL = 86400 * 7; // 7 days

// `socials` carries a creator's whole multi-platform footprint. Each
// field is either a string handle (no @, no full URL — just the
// username, except `discord` which is a full invite URL) or null.
// The field set is fixed so consumers can iterate it predictably.
//
// Honesty rules:
//   - Only populate a handle when it's confirmed (the account exists,
//     and it's actually the same person). Don't guess.
//   - Cross-platform Twitch/Kick: confirmed today only for dynamoses
//     and bags (both have D1 platform rows on both sides per
//     migration 010_backfill_curated.sql).
//   - TikTok / YouTube / X / Instagram / Discord: leave null until
//     populated manually or via creator submissions.
//
// `platform` (top-level) is the *primary* platform — it drives which
// API the live-state lookup hits and which embed the multi-view tile
// uses. The full footprint goes in `socials`.
// Allowlist sourced from D1 via getCuratedList(env). Old hardcoded array
// replaced by migration 013_curated_creators.sql + per-isolate cache in
// functions/_curated.js.

export async function onRequestGet({ env, waitUntil }) {
  // 1. Cache API check (edge cache, unlimited writes vs KV's 1k/day cap)
  const cache = caches.default;
  const cacheKey = new Request(CACHE_URL);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const ALLOWLIST = await getCuratedList(env);
    const TWITCH_HANDLES = ALLOWLIST.filter(c => c.platform === 'twitch').map(c => c.handle);
    const KICK_HANDLES   = ALLOWLIST.filter(c => c.platform === 'kick').map(c => c.handle);

    // 2. Fetch live data from both platforms in parallel — single batched
    //    request per platform thanks to multi-value query params.
    const [twitchResult, kickResult] = await Promise.all([
      fetchTwitch(env, TWITCH_HANDLES),
      fetchKick(env, KICK_HANDLES),
    ]);

    // 3. Merge into allowlist-shaped response
    const live = ALLOWLIST.map(entry => {
      if (entry.platform === 'twitch') {
        return buildTwitchEntry(entry, twitchResult);
      }
      return buildKickEntry(entry, kickResult);
    });

    // 4. Sort: live (by viewers desc), then offline (alphabetical)
    live.sort((a, b) => {
      if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
      if (a.is_live && b.is_live) return (b.viewers || 0) - (a.viewers || 0);
      return a.display_name.localeCompare(b.display_name);
    });

    const payload = {
      ok: true,
      count: live.length,
      live_count: live.filter(s => s.is_live).length,
      fetched_at: new Date().toISOString(),
      live,
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

// ================================================================
// Twitch: batched /users + /streams calls (one round trip each)
// ================================================================
async function fetchTwitch(env, handles) {
  if (!handles.length) return { users: {}, streams: {} };
  const userParams   = handles.map(h => `login=${encodeURIComponent(h)}`).join('&');
  const streamParams = handles.map(h => `user_login=${encodeURIComponent(h)}`).join('&');

  const [usersData, streamsData] = await Promise.all([
    twitchFetch(env, `https://api.twitch.tv/helix/users?${userParams}`),
    twitchFetch(env, `https://api.twitch.tv/helix/streams?${streamParams}`),
  ]);

  const users = {};   // login(lower) → { id, display_name, profile_image_url }
  const streams = {}; // login(lower) → { viewer_count, title, game_name, started_at, thumbnail_url }
  for (const u of (usersData?.data || [])) {
    users[u.login.toLowerCase()] = {
      id: u.id,
      display_name: u.display_name,
      profile_image_url: u.profile_image_url,
    };
  }
  for (const s of (streamsData?.data || [])) {
    streams[s.user_login.toLowerCase()] = {
      viewer_count: s.viewer_count,
      title: s.title,
      game_name: s.game_name,
      started_at: s.started_at,
      thumbnail_url: s.thumbnail_url,
    };
  }
  return { users, streams };
}

// 401 auto-retry: purge KV-cached token and fetch a fresh one
async function twitchFetch(env, url) {
  let token = await getTwitchToken(env);
  let res = await fetch(url, {
    headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await env.KV.delete('twitch:app_token');
    token = await getTwitchToken(env);
    res = await fetch(url, {
      headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` },
    });
  }
  if (!res.ok) throw new Error(`twitch_api_${res.status}`);
  return res.json();
}

function buildTwitchEntry(entry, twitchResult) {
  const handle = entry.handle.toLowerCase();
  const user = twitchResult.users[handle];
  const stream = twitchResult.streams[handle];
  const display_name = user?.display_name || entry.name;
  const avatar_url = user?.profile_image_url || null;

  if (stream) {
    const startedAtSec = stream.started_at
      ? Math.floor(new Date(stream.started_at).getTime() / 1000)
      : null;
    const uptimeMins = startedAtSec
      ? Math.max(0, Math.round((Date.now() / 1000 - startedAtSec) / 60))
      : null;
    const socials = entrySocials(entry);
    return {
      handle: entry.handle,
      display_name,
      platform: 'twitch',
      profile_url: `/creator-profile/${entry.handle}`,
      avatar_url,
      is_live: true,
      viewers: stream.viewer_count || 0,
      stream_title: stream.title || null,
      game_name: stream.game_name || null,
      started_at: startedAtSec,
      uptime_mins: uptimeMins,
      thumbnail_url: resolveTwitchThumb(stream.thumbnail_url),
      socials,
      tiktok: socials.tiktok,   // back-compat top-level fields
      youtube: socials.youtube,
    };
  }
  return offlineStub(entry, display_name, avatar_url);
}

// Twitch returns thumbnail URLs containing literal `{width}` and `{height}`
// placeholders the client is expected to substitute. Doing it server-side
// means callers can drop straight into <img src> without string surgery.
function resolveTwitchThumb(url) {
  if (!url) return null;
  return url.replace('{width}', String(THUMB_SIZE.w)).replace('{height}', String(THUMB_SIZE.h));
}

// ================================================================
// Kick: official Public API at api.kick.com (OAuth client credentials).
//   • /public/v1/channels?slug=...   — channel + stream state, batched up to 50
//   • /public/v1/livestreams?...     — supplies profile_picture for live entries
//
// The unauthenticated kick.com/api/v1|v2 scrape paths have been retired.
// Avatar URLs for offline Kick creators are read from a long-lived KV cache
// (key: `kick:avatar:{slug}`) that is back-populated whenever the same slug
// shows up in /public/v1/livestreams.
// ================================================================
async function fetchKick(env, kickHandles) {
  if (!kickHandles || kickHandles.length === 0) {
    return { channelsBySlug: {}, avatarsBySlug: {} };
  }

  let token;
  try {
    token = await getKickToken(env);
  } catch {
    return { channelsBySlug: {}, avatarsBySlug: {}, _error: 'kick_token_failed' };
  }
  const authHeader = { authorization: `Bearer ${token}` };

  const slugQs = kickHandles.map(s => `slug=${encodeURIComponent(s)}`).join('&');
  const channelsPromise = fetch(`https://api.kick.com/public/v1/channels?${slugQs}`, { headers: authHeader })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  // Pull live streams in parallel — used purely to enrich avatars (and as a
  // sanity cross-check for is_live). Filter to broadcaster_user_ids we know
  // about *after* we've resolved them from the channels response.
  const livePromise = fetch('https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count', { headers: authHeader })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  // Read existing cached avatars FIRST so we can compare against any fresh
  // values from /livestreams. Without this we used to rewrite the same URL
  // every 30s — at ~3 live Kick creators that's 8.6k pointless KV writes/day.
  const avatarsBySlug = {};
  await Promise.all(kickHandles.map(async slug => {
    try {
      const v = await env.KV.get(`kick:avatar:${slug}`);
      if (v) avatarsBySlug[slug] = v;
    } catch { /* ignore */ }
  }));

  const [channelsJson, liveJson] = await Promise.all([channelsPromise, livePromise]);

  const channelsBySlug = {};
  const idToSlug = {};
  for (const ch of (channelsJson?.data || [])) {
    const slug = String(ch.slug || '').toLowerCase();
    if (!slug) continue;
    channelsBySlug[slug] = ch;
    if (ch.broadcaster_user_id != null) idToSlug[ch.broadcaster_user_id] = slug;
  }

  // Fold livestream data back into our channel shape (matches by user id).
  // Only write back to KV when the avatar URL has actually changed — Kick's
  // CDN URLs are stable so this is effectively zero writes after warmup.
  for (const ls of (liveJson?.data || [])) {
    const slug = idToSlug[ls.broadcaster_user_id] || String(ls.slug || '').toLowerCase();
    if (!slug || !channelsBySlug[slug]) continue;
    channelsBySlug[slug]._livestream = ls;
    if (ls.profile_picture && avatarsBySlug[slug] !== ls.profile_picture) {
      try {
        await env.KV.put(`kick:avatar:${slug}`, ls.profile_picture, { expirationTtl: KICK_AVATAR_TTL });
        avatarsBySlug[slug] = ls.profile_picture;
      } catch { /* ignore — cache is best-effort */ }
    }
  }

  return { channelsBySlug, avatarsBySlug };
}

function buildKickEntry(entry, kickResult) {
  const slug = entry.handle.toLowerCase();
  const ch = kickResult.channelsBySlug?.[slug];
  const display_name = entry.name;

  // Avatar precedence: fresh livestream profile_picture → cached KV → null.
  const avatar_url = ch?._livestream?.profile_picture || kickResult.avatarsBySlug?.[slug] || null;

  // The Channels endpoint returns a `stream` sub-object with is_live; when the
  // broadcaster is live the matching /livestreams entry gives us viewer_count
  // and thumbnail. Treat is_live conservatively — only mark live when both
  // channel.stream.is_live and a livestream record agree.
  const stream = ch?.stream;
  const ls = ch?._livestream;
  const isLive = !!(stream?.is_live);

  if (isLive) {
    const startIso = ls?.started_at || stream?.start_time;
    const startedAtSec = startIso ? Math.floor(new Date(startIso).getTime() / 1000) : null;
    const uptimeMins = startedAtSec
      ? Math.max(0, Math.round((Date.now() / 1000 - startedAtSec) / 60))
      : null;
    const socials = entrySocials(entry);
    return {
      handle: entry.handle,
      display_name,
      platform: 'kick',
      profile_url: `/creator-profile/${entry.handle}`,
      avatar_url,
      is_live: true,
      viewers: ls?.viewer_count ?? stream?.viewer_count ?? 0,
      stream_title: ls?.stream_title || ch?.stream_title || null,
      game_name: ls?.category?.name || ch?.category?.name || null,
      started_at: startedAtSec,
      uptime_mins: uptimeMins,
      thumbnail_url: ls?.thumbnail || stream?.thumbnail || null,
      socials,
      tiktok: socials.tiktok,   // back-compat top-level fields
      youtube: socials.youtube,
    };
  }
  return offlineStub(entry, display_name, avatar_url);
}

// Resolve socials from an entry, fully populating every key so consumers
// can iterate without null-guarding the object itself. Backfills the
// primary platform handle if `socials` was omitted (defensive against
// any future allowlist row that forgets to fill it in).
function entrySocials(entry) {
  const s = entry.socials || {};
  const out = {
    twitch:    s.twitch    || null,
    kick:      s.kick      || null,
    tiktok:    s.tiktok    || null,
    youtube:   s.youtube   || null,
    x:         s.x         || null,
    instagram: s.instagram || null,
    discord:   s.discord   || null,
  };
  if (entry.platform === 'twitch' && !out.twitch) out.twitch = entry.handle;
  if (entry.platform === 'kick'   && !out.kick)   out.kick   = entry.handle;
  return out;
}

function offlineStub(entry, display_name, avatar_url) {
  const socials = entrySocials(entry);
  return {
    handle: entry.handle,
    display_name,
    platform: entry.platform,
    profile_url: `/creator-profile/${entry.handle}`,
    avatar_url,
    is_live: false,
    viewers: null,
    stream_title: null,
    game_name: null,
    started_at: null,
    uptime_mins: null,
    thumbnail_url: null,
    socials,
    tiktok: socials.tiktok,
    youtube: socials.youtube,
  };
}

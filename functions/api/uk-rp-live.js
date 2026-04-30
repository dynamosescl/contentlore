// ================================================================
// functions/api/uk-rp-live.js
// GET /api/uk-rp-live
//
// Returns the curated UK GTA RP allowlist with live state pulled
// directly from Twitch + Kick APIs (bypasses the DB / scheduler).
// 90s edge cache (Cache API) to keep latency down without hammering
// platform APIs.
//
// Multi-platform handling: when a creator's `socials` object lists
// BOTH a twitch handle AND a kick handle, we poll BOTH platforms and
// surface whichever side is currently live. Their `platform` field
// in the response reflects the platform actually streaming right now
// (so the multi-view tile + roster card embed the correct player),
// falling back to the saved primary platform when offline. If both
// sides are simultaneously live we surface the higher-viewer side
// and expose the other under `also_live` so the UI can flag the
// multi-stream.
// ================================================================

import { jsonResponse, getTwitchToken, getKickToken } from '../_lib.js';
import { getCuratedList } from '../_curated.js';

const CACHE_URL = 'https://contentlore.com/cache/uk-rp-live';
const CACHE_TTL = 90; // seconds
const THUMB_SIZE = { w: 1280, h: 720 };
const KICK_AVATAR_TTL = 86400 * 7; // 7 days

export async function onRequestGet({ env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_URL);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const ALLOWLIST = await getCuratedList(env);

    // Build the union of every twitch + kick handle anyone in the
    // allowlist exposes via `socials`, not just primary platform.
    // Lowercased, deduped — one API call per platform regardless of
    // how many creators are in the list.
    const twitchSet = new Set();
    const kickSet   = new Set();
    for (const c of ALLOWLIST) {
      const tw = (c.socials?.twitch || (c.platform === 'twitch' ? c.handle : null) || '').toLowerCase();
      const kk = (c.socials?.kick   || (c.platform === 'kick'   ? c.handle : null) || '').toLowerCase();
      if (tw) twitchSet.add(tw);
      if (kk) kickSet.add(kk);
    }

    const [twitchResult, kickResult] = await Promise.all([
      fetchTwitch(env, [...twitchSet]),
      fetchKick(env, [...kickSet]),
    ]);

    const live = ALLOWLIST.map(entry => buildEntry(entry, twitchResult, kickResult));

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

// ----------------------------------------------------------------
// Per-entry builder — checks both Twitch and Kick live state,
// returns one entry with the live-side enriched, or a stub when
// neither side is live.
// ----------------------------------------------------------------
function buildEntry(entry, twitchResult, kickResult) {
  const socials = entrySocials(entry);
  const twHandle = (socials.twitch || '').toLowerCase();
  const kkHandle = (socials.kick   || '').toLowerCase();

  const twLive = twHandle ? buildTwitchLive(entry, twHandle, twitchResult, socials) : null;
  const kkLive = kkHandle ? buildKickLive(entry, kkHandle, kickResult, socials) : null;

  // Resolve avatar from whichever side has one (Twitch is always
  // available; Kick only when the broadcaster has been seen live).
  const twUser = twHandle ? twitchResult.users[twHandle] : null;
  const kkAvatar = kkHandle
    ? (kickResult.channelsBySlug?.[kkHandle]?._livestream?.profile_picture
       || kickResult.avatarsBySlug?.[kkHandle]
       || null)
    : null;
  const fallbackAvatar = twUser?.profile_image_url || kkAvatar || null;
  const fallbackDisplay = twUser?.display_name || entry.name;

  // Both live: pick the platform with more viewers as primary, surface
  // the other on `also_live`.
  if (twLive && kkLive) {
    const primaryIsTwitch = (twLive.viewers || 0) >= (kkLive.viewers || 0);
    const primary = primaryIsTwitch ? twLive : kkLive;
    const secondary = primaryIsTwitch ? kkLive : twLive;
    return {
      ...primary,
      also_live: {
        platform: secondary.platform,
        viewers: secondary.viewers,
        stream_title: secondary.stream_title,
        game_name: secondary.game_name,
      },
    };
  }
  if (twLive) return twLive;
  if (kkLive) return kkLive;
  return offlineStub(entry, fallbackDisplay, fallbackAvatar, socials);
}

// ================================================================
// Twitch: batched /users + /streams (one round trip each)
// ================================================================
async function fetchTwitch(env, handles) {
  if (!handles.length) return { users: {}, streams: {} };
  const userParams   = handles.map(h => `login=${encodeURIComponent(h)}`).join('&');
  const streamParams = handles.map(h => `user_login=${encodeURIComponent(h)}`).join('&');

  const [usersData, streamsData] = await Promise.all([
    twitchFetch(env, `https://api.twitch.tv/helix/users?${userParams}`),
    twitchFetch(env, `https://api.twitch.tv/helix/streams?${streamParams}`),
  ]);

  const users = {};
  const streams = {};
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

function buildTwitchLive(entry, twHandle, twitchResult, socials) {
  const user = twitchResult.users[twHandle];
  const stream = twitchResult.streams[twHandle];
  if (!stream) return null;

  const display_name = user?.display_name || entry.name;
  const avatar_url = user?.profile_image_url || null;
  const startedAtSec = stream.started_at
    ? Math.floor(new Date(stream.started_at).getTime() / 1000)
    : null;
  const uptimeMins = startedAtSec
    ? Math.max(0, Math.round((Date.now() / 1000 - startedAtSec) / 60))
    : null;
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
    live_handle: twHandle,
    socials,
    tiktok: socials.tiktok,
    youtube: socials.youtube,
  };
}

function resolveTwitchThumb(url) {
  if (!url) return null;
  return url.replace('{width}', String(THUMB_SIZE.w)).replace('{height}', String(THUMB_SIZE.h));
}

// ================================================================
// Kick: official Public API at api.kick.com (OAuth client credentials)
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

  const livePromise = fetch('https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count', { headers: authHeader })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

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

  for (const ls of (liveJson?.data || [])) {
    const slug = idToSlug[ls.broadcaster_user_id] || String(ls.slug || '').toLowerCase();
    if (!slug || !channelsBySlug[slug]) continue;
    channelsBySlug[slug]._livestream = ls;
    if (ls.profile_picture && avatarsBySlug[slug] !== ls.profile_picture) {
      try {
        await env.KV.put(`kick:avatar:${slug}`, ls.profile_picture, { expirationTtl: KICK_AVATAR_TTL });
        avatarsBySlug[slug] = ls.profile_picture;
      } catch { /* ignore */ }
    }
  }

  return { channelsBySlug, avatarsBySlug };
}

function buildKickLive(entry, kkHandle, kickResult, socials) {
  const ch = kickResult.channelsBySlug?.[kkHandle];
  if (!ch) return null;
  const stream = ch.stream;
  const ls = ch._livestream;
  if (!stream?.is_live) return null;

  const display_name = entry.name;
  const avatar_url = ls?.profile_picture || kickResult.avatarsBySlug?.[kkHandle] || null;
  const startIso = ls?.started_at || stream?.start_time;
  const startedAtSec = startIso ? Math.floor(new Date(startIso).getTime() / 1000) : null;
  const uptimeMins = startedAtSec
    ? Math.max(0, Math.round((Date.now() / 1000 - startedAtSec) / 60))
    : null;

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
    live_handle: kkHandle,
    socials,
    tiktok: socials.tiktok,
    youtube: socials.youtube,
  };
}

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

function offlineStub(entry, display_name, avatar_url, socials) {
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

// ================================================================
// functions/api/uk-rp-live.js
// GET /api/uk-rp-live
//
// Returns the curated UK GTA RP allowlist with live state pulled
// directly from Twitch + Kick APIs (bypasses the DB / scheduler).
// 30s KV cache to keep latency down without hammering platform APIs.
// ================================================================

import { jsonResponse, getTwitchToken, getKickToken } from '../_lib.js';

const CACHE_KEY = 'uk-rp-live:cache';
const CACHE_TTL = 90; // seconds
const CACHE_HEADERS = { 'cache-control': 'public, s-maxage=60' };
const THUMB_SIZE = { w: 1280, h: 720 };
const KICK_AVATAR_TTL = 86400 * 7; // 7 days

// Optional `tiktok` / `youtube` fields are surfaced in every entry so creator-
// profile pages and the multi-platform footprint card can light up without a
// schema change later. Populate as handles become known.
const ALLOWLIST = [
  { handle: 'tyrone',         platform: 'twitch', name: 'Tyrone' },
  { handle: 'lbmm',           platform: 'twitch', name: 'LBMM' },
  { handle: 'reeclare',       platform: 'twitch', name: 'Reeclare' },
  { handle: 'stoker',         platform: 'twitch', name: 'Stoker' },
  { handle: 'samham',         platform: 'twitch', name: 'SamHam' },
  { handle: 'deggyuk',        platform: 'twitch', name: 'DeggyUK' },
  { handle: 'megsmary',       platform: 'twitch', name: 'MegsMary' },
  { handle: 'tazzthegeeza',   platform: 'twitch', name: 'TaZzTheGeeza' },
  { handle: 'wheelydev',      platform: 'twitch', name: 'WheelyDev' },
  { handle: 'rexality',       platform: 'twitch', name: 'RexaliTy' },
  { handle: 'steeel',         platform: 'twitch', name: 'Steeel' },
  { handle: 'justj0hnnyhd',   platform: 'twitch', name: 'JustJ0hnnyHD' },
  { handle: 'cherish_remedy', platform: 'twitch', name: 'Cherish_Remedy' },
  { handle: 'lorddorro',      platform: 'twitch', name: 'LordDorro' },
  { handle: 'jck0__',         platform: 'twitch', name: 'JCK0__' },
  { handle: 'absthename',     platform: 'twitch', name: 'ABsTheName' },
  // Added 2026-04-27 via scheduler discovery + admin triage
  { handle: 'essellz',          platform: 'twitch', name: 'Essellz' },
  { handle: 'lewthescot',       platform: 'twitch', name: 'LewTheScot' },
  { handle: 'angels365',        platform: 'twitch', name: 'Angels365' },
  { handle: 'fantasiasfantasy', platform: 'twitch', name: 'FantasiasFantasy' },
  { handle: 'kavsual',        platform: 'kick',   name: 'Kavsual' },
  { handle: 'shammers',       platform: 'kick',   name: 'Shammers' },
  { handle: 'bags',           platform: 'kick',   name: 'Bags' },
  { handle: 'dynamoses',      platform: 'kick',   name: 'Dynamoses' },
  { handle: 'dcampion',       platform: 'kick',   name: 'DCampion' },
  { handle: 'elliewaller',    platform: 'kick',   name: 'EllieWaller' },
];

const TWITCH_HANDLES = ALLOWLIST.filter(c => c.platform === 'twitch').map(c => c.handle);
const KICK_HANDLES   = ALLOWLIST.filter(c => c.platform === 'kick').map(c => c.handle);

export async function onRequestGet({ env }) {
  // 1. KV cache check
  try {
    const cached = await env.KV.get(CACHE_KEY, 'json');
    if (cached) return jsonResponse(cached, 200, CACHE_HEADERS);
  } catch { /* fall through to fresh fetch */ }

  try {
    // 2. Fetch live data from both platforms in parallel — single batched
    //    request per platform thanks to multi-value query params.
    const [twitchResult, kickResult] = await Promise.all([
      fetchTwitch(env),
      fetchKick(env),
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

    // 5. Cache for 30s (non-fatal on failure)
    try {
      await env.KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: CACHE_TTL });
    } catch { /* ignore */ }

    return jsonResponse(payload, 200, CACHE_HEADERS);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// Twitch: batched /users + /streams calls (one round trip each)
// ================================================================
async function fetchTwitch(env) {
  const userParams   = TWITCH_HANDLES.map(h => `login=${encodeURIComponent(h)}`).join('&');
  const streamParams = TWITCH_HANDLES.map(h => `user_login=${encodeURIComponent(h)}`).join('&');

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
      tiktok: entry.tiktok || null,
      youtube: entry.youtube || null,
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
async function fetchKick(env) {
  if (KICK_HANDLES.length === 0) {
    return { channelsBySlug: {}, avatarsBySlug: {} };
  }

  let token;
  try {
    token = await getKickToken(env);
  } catch {
    return { channelsBySlug: {}, avatarsBySlug: {}, _error: 'kick_token_failed' };
  }
  const authHeader = { authorization: `Bearer ${token}` };

  const slugQs = KICK_HANDLES.map(s => `slug=${encodeURIComponent(s)}`).join('&');
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
  await Promise.all(KICK_HANDLES.map(async slug => {
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
      tiktok: entry.tiktok || null,
      youtube: entry.youtube || null,
    };
  }
  return offlineStub(entry, display_name, avatar_url);
}

function offlineStub(entry, display_name, avatar_url) {
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
    tiktok: entry.tiktok || null,
    youtube: entry.youtube || null,
  };
}

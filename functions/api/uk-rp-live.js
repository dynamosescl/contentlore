// ================================================================
// functions/api/uk-rp-live.js
// GET /api/uk-rp-live
//
// Returns the curated UK GTA RP allowlist with live state pulled
// directly from Twitch + Kick APIs (bypasses the DB / scheduler).
// 30s KV cache to keep latency down without hammering platform APIs.
// ================================================================

import { jsonResponse, getTwitchToken } from '../_lib.js';

const CACHE_KEY = 'uk-rp-live:cache';
const CACHE_TTL = 30; // seconds

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
  { handle: 'kavsual',        platform: 'kick',   name: 'Kavsual' },
  { handle: 'shammers',       platform: 'kick',   name: 'Shammers' },
  { handle: 'bags',           platform: 'kick',   name: 'Bags' },
  { handle: 'dynamoses',      platform: 'kick',   name: 'Dynamoses' },
  { handle: 'dcampion',       platform: 'kick',   name: 'DCampion' },
  { handle: 'elliewaller',    platform: 'kick',   name: 'EllieWaller' },
];

const TWITCH_HANDLES = ALLOWLIST.filter(c => c.platform === 'twitch').map(c => c.handle);
const KICK_HANDLES   = ALLOWLIST.filter(c => c.platform === 'kick').map(c => c.handle);

const KICK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://kick.com/',
  'Origin': 'https://kick.com',
};

export async function onRequestGet({ env }) {
  // 1. KV cache check
  try {
    const cached = await env.KV.get(CACHE_KEY, 'json');
    if (cached) return jsonResponse(cached);
  } catch { /* fall through to fresh fetch */ }

  try {
    // 2. Fetch live data from both platforms in parallel
    const [twitchResult, ...kickResults] = await Promise.all([
      fetchTwitch(env),
      ...KICK_HANDLES.map(h => fetchKick(h)),
    ]);

    // 3. Merge into allowlist-shaped response
    const live = ALLOWLIST.map(entry => {
      if (entry.platform === 'twitch') {
        return buildTwitchEntry(entry, twitchResult);
      }
      const kickData = kickResults[KICK_HANDLES.indexOf(entry.handle)];
      return buildKickEntry(entry, kickData);
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

    return jsonResponse(payload);
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
      avatar_url,
      is_live: true,
      viewers: stream.viewer_count || 0,
      stream_title: stream.title || null,
      game_name: stream.game_name || null,
      started_at: startedAtSec,
      uptime_mins: uptimeMins,
      thumbnail_url: stream.thumbnail_url || null,
    };
  }
  return offlineStub(entry, display_name, avatar_url);
}

// ================================================================
// Kick: v1 with v2 fallback. Both return the same shape; trying both
// gives us a different code path / edge-cache layer at Kick's CDN
// in case one is WAF-blocked from CF datacenter IPs.
//
// (HTML scrape fallback was removed — Kick moved to Next.js 13 App
// Router with self.__next_f.push streaming chunks. The old regex
// targets — "session_title", "viewer_count", "profile_pic" — no
// longer appear in the rendered HTML at all.)
// ================================================================
async function fetchKick(slug) {
  for (const version of ['v1', 'v2']) {
    try {
      const res = await fetch(`https://kick.com/api/${version}/channels/${encodeURIComponent(slug)}`, { headers: KICK_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (!data?.error) return { source: version, data };
      }
    } catch { /* try next version */ }
  }
  return { source: 'failed', data: null };
}

function buildKickEntry(entry, kickData) {
  const data = kickData?.data;
  const source = kickData?.source || 'failed';
  const display_name = entry.name;
  const avatar_url = data?.user?.profile_pic || null;

  if (data?.livestream) {
    const ls = data.livestream;
    const startedAtSec = ls.created_at
      ? Math.floor(new Date(ls.created_at).getTime() / 1000)
      : null;
    const uptimeMins = startedAtSec
      ? Math.max(0, Math.round((Date.now() / 1000 - startedAtSec) / 60))
      : null;
    return {
      handle: entry.handle,
      display_name,
      platform: 'kick',
      avatar_url,
      is_live: true,
      viewers: ls.viewer_count || 0,
      stream_title: ls.session_title || null,
      game_name: ls.categories?.[0]?.name || null,
      started_at: startedAtSec,
      uptime_mins: uptimeMins,
      thumbnail_url: null,
      _kick_source: source,
    };
  }
  return { ...offlineStub(entry, display_name, avatar_url), _kick_source: source };
}

function offlineStub(entry, display_name, avatar_url) {
  return {
    handle: entry.handle,
    display_name,
    platform: entry.platform,
    avatar_url,
    is_live: false,
    viewers: null,
    stream_title: null,
    game_name: null,
    started_at: null,
    uptime_mins: null,
    thumbnail_url: null,
  };
}

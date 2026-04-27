// ================================================================
// functions/api/clips.js
// GET /api/clips?range=24h|7d|30d
//
// Returns the top Twitch clips (sorted by view_count desc) for the 16
// curated UK GTA RP Twitch handles in the requested time window.
//
// Kick is intentionally skipped — the Kick Public API surface
// (docs.kick.com) does not currently expose a clips endpoint, so we
// can't pull Kick clips without scraping (and we already retired the
// scrape paths in Phase 1). Wire in when Kick ships /public/v1/clips.
//
// Cache: 5 min in KV (clips don't churn as fast as live state) plus
// edge cache via cache-control: public, s-maxage=120.
// ================================================================

import { jsonResponse, getTwitchToken } from '../_lib.js';

const RANGES = { '24h': 86400, '7d': 604800, '30d': 2592000 };
const DEFAULT_RANGE = '7d';
// Over-fetch then filter: Twitch returns the broadcaster's top N clips by views
// regardless of category, so we pull a wider slice and discard non-RP content
// below. Twitch caps `first` at 100; 20 is plenty for our 16 broadcasters.
const PER_CREATOR = 20;
const KV_TTL = 300;
const EDGE_TTL = 120;
const PARENT_DOMAINS = ['contentlore.com', 'localhost'];

// Keep the wall on-brand: only surface clips from GTA V or Just Chatting
// (RP streamers commonly switch to Just Chatting during downtime / lobby /
// behind-the-scenes moments while still talking RP).
//   32982  = Grand Theft Auto V
//   509658 = Just Chatting
const ALLOWED_GAME_IDS = new Set(['32982', '509658']);

const TWITCH_HANDLES = [
  'tyrone', 'lbmm', 'reeclare', 'stoker', 'samham', 'deggyuk',
  'megsmary', 'tazzthegeeza', 'wheelydev', 'rexality', 'steeel',
  'justj0hnnyhd', 'cherish_remedy', 'lorddorro', 'jck0__', 'absthename',
];

const HANDLE_TO_NAME = {
  tyrone: 'Tyrone', lbmm: 'LBMM', reeclare: 'Reeclare', stoker: 'Stoker',
  samham: 'SamHam', deggyuk: 'DeggyUK', megsmary: 'MegsMary',
  tazzthegeeza: 'TaZzTheGeeza', wheelydev: 'WheelyDev', rexality: 'RexaliTy',
  steeel: 'Steeel', justj0hnnyhd: 'JustJ0hnnyHD', cherish_remedy: 'Cherish_Remedy',
  lorddorro: 'LordDorro', jck0__: 'JCK0__', absthename: 'ABsTheName',
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get('range');
  const range = RANGES[rangeParam] ? rangeParam : DEFAULT_RANGE;
  const cacheKey = `clips:${range}:cache`;

  // KV cache check
  try {
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) return jsonResponse(cached, 200, { 'cache-control': `public, s-maxage=${EDGE_TTL}` });
  } catch { /* fall through */ }

  try {
    const startedAt = new Date(Date.now() - RANGES[range] * 1000).toISOString();
    const userIds = await resolveTwitchUserIds(env, TWITCH_HANDLES);

    // Fetch clips per broadcaster in parallel; one failure doesn't take down the whole response.
    const settled = await Promise.allSettled(
      TWITCH_HANDLES
        .filter(h => userIds[h])
        .map(h => fetchClipsForBroadcaster(env, h, userIds[h], startedAt))
    );
    const allClips = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // Enrich with game_name (single batched /helix/games call for unique IDs).
    const gameNames = await fetchGameNames(env, allClips);
    for (const c of allClips) c.game_name = gameNames[c._game_id] || null;
    for (const c of allClips) delete c._game_id;

    allClips.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));

    const payload = {
      ok: true,
      range,
      count: allClips.length,
      fetched_at: new Date().toISOString(),
      clips: allClips,
    };

    try {
      await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: KV_TTL });
    } catch { /* ignore */ }

    return jsonResponse(payload, 200, { 'cache-control': `public, s-maxage=${EDGE_TTL}` });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Resolve every handle to a Twitch user_id, preferring the existing KV cache
// (`twitch:user-id:{handle}`) which is already populated by uk-rp-live and
// the scheduler. Anything missing is batch-fetched via /helix/users.
async function resolveTwitchUserIds(env, handles) {
  const result = {};
  const missing = [];

  await Promise.all(handles.map(async h => {
    try {
      const cached = await env.KV.get(`twitch:user-id:${h}`);
      if (cached) result[h] = cached;
      else missing.push(h);
    } catch {
      missing.push(h);
    }
  }));

  if (missing.length === 0) return result;

  const params = missing.map(h => `login=${encodeURIComponent(h)}`).join('&');
  const data = await twitchFetch(env, `https://api.twitch.tv/helix/users?${params}`);
  for (const u of (data?.data || [])) {
    const h = u.login.toLowerCase();
    result[h] = u.id;
    try { await env.KV.put(`twitch:user-id:${h}`, u.id); } catch { /* ignore */ }
  }
  return result;
}

async function fetchClipsForBroadcaster(env, handle, broadcasterId, startedAt) {
  const url = `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&started_at=${encodeURIComponent(startedAt)}&first=${PER_CREATOR}`;
  const data = await twitchFetch(env, url);
  const clips = (data?.data || []).filter(c => c.game_id && ALLOWED_GAME_IDS.has(c.game_id));
  return clips.map(c => ({
    id: c.id,
    creator_handle: handle,
    creator_name: HANDLE_TO_NAME[handle] || handle,
    platform: 'twitch',
    title: c.title || '',
    url: c.url,
    embed_url: buildEmbedUrl(c.id),
    thumbnail_url: c.thumbnail_url,
    view_count: c.view_count || 0,
    duration: c.duration || 0,
    created_at: c.created_at,
    clipped_by: c.creator_name || null,
    _game_id: c.game_id || null,
  }));
}

// Twitch's `embed_url` field omits the `&parent=` param but the iframe will
// 403 without it. Build a self-contained URL that works on contentlore.com
// and localhost dev.
function buildEmbedUrl(clipId) {
  const parents = PARENT_DOMAINS.map(p => `parent=${encodeURIComponent(p)}`).join('&');
  return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&${parents}&autoplay=true`;
}

async function fetchGameNames(env, clips) {
  const ids = [...new Set(clips.map(c => c._game_id).filter(Boolean))];
  if (ids.length === 0) return {};
  // /helix/games accepts up to 100 ids; we'll never approach that with 16 broadcasters.
  const params = ids.map(id => `id=${encodeURIComponent(id)}`).join('&');
  try {
    const data = await twitchFetch(env, `https://api.twitch.tv/helix/games?${params}`);
    const map = {};
    for (const g of (data?.data || [])) map[g.id] = g.name;
    return map;
  } catch {
    return {};
  }
}

// Same auto-retry-on-401 pattern as uk-rp-live: purge the cached app token
// and re-grant once if the existing one has been revoked.
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
  if (!res.ok) throw new Error(`twitch_clips_${res.status}`);
  return res.json();
}

// ================================================================
// functions/_scheduled.js
// Cloudflare Pages Functions cron handler.
// Runs every 15 minutes (see wrangler.toml [triggers]).
//
// Each run:
//   1. Picks the next batch of 20 creators (round-robin via KV cursor)
//   2. For each, fetches current live state from Twitch or Kick
//   3. Writes a snapshot row with stream_title, game_name, started_at
//   4. Scans the title for raid/host/shoutout mentions
//   5. Upserts edges in creator_edges for every matched known handle
//
// Fail-soft: one creator failing doesn't stop the batch. All errors
// logged via console.log and surfaced in the final run summary.
// ================================================================

import {
  getTwitchToken,
  getKickToken,
  fetchTwitchUser,
  fetchTwitchStream,
  fetchKickChannel,
} from './_lib.js';

const BATCH_SIZE = 20;
const CURSOR_KEY = 'cron:live-scan:cursor';
const HANDLE_MAP_CACHE_KEY = 'cron:handle-map:v1';
const HANDLE_MAP_TTL = 3600; // 1 hour

// Regex catches: "raided by @alice", "big shoutout to bob", "hosted by carol"
const MENTION_PATTERN = /\b(?:raid(?:ed)?|host(?:ed)?|shout\s?out|shouting\s+out|thanks\s+(?:to\s+)?)\s+(?:by\s+)?@?([a-zA-Z0-9_]{3,30})/gi;

export async function onSchedule(event, env, ctx) {
  const startedAt = Date.now();
  const summary = {
    started_at: new Date(startedAt).toISOString(),
    batch_size: BATCH_SIZE,
    creators_processed: 0,
    snapshots_written: 0,
    edges_written: 0,
    live_count: 0,
    errors: [],
    error_counts: {
      fetch_failed: 0,
      no_user_id: 0,
      snapshot_failed: 0,
      edge_failed: 0,
    },
  };

  try {
    // 1. Load handle map (all known handles → creator_id) from KV or rebuild
    const handleMap = await loadHandleMap(env);

    // 2. Pull ALL active creators, ordered by id, then pick batch via cursor
    const creatorsRes = await env.DB.prepare(`
      SELECT c.id, c.display_name, cp.platform, cp.handle
      FROM creators c
      INNER JOIN creator_platforms cp 
        ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE c.role = 'creator' AND cp.handle IS NOT NULL
      ORDER BY c.id ASC
    `).all();

    const allCreators = creatorsRes.results || [];
    if (allCreators.length === 0) {
      summary.note = 'no creators to process';
      console.log('[scheduled]', JSON.stringify(summary));
      return;
    }

    // 3. Determine batch offset via KV cursor (round-robin)
    const cursorRaw = await env.KV.get(CURSOR_KEY);
    let cursor = parseInt(cursorRaw || '0', 10);
    if (Number.isNaN(cursor) || cursor >= allCreators.length) cursor = 0;

    const batch = allCreators.slice(cursor, cursor + BATCH_SIZE);
    const nextCursor = (cursor + BATCH_SIZE) % Math.max(allCreators.length, BATCH_SIZE);
    await env.KV.put(CURSOR_KEY, String(nextCursor));

    summary.cursor_start = cursor;
    summary.cursor_next = nextCursor;
    summary.total_creators = allCreators.length;

    const now = Math.floor(Date.now() / 1000);

    // 4. Process each creator in the batch
    for (const c of batch) {
      summary.creators_processed++;
      try {
        const result = await processCreator(env, c, handleMap, now);
        if (result.wrote_snapshot) summary.snapshots_written++;
        if (result.is_live) summary.live_count++;
        summary.edges_written += result.edges_written;
        if (result.error) {
          summary.errors.push({ id: c.id, ...result.error });
          summary.error_counts[result.error.category] = 
            (summary.error_counts[result.error.category] || 0) + 1;
        }
      } catch (e) {
        console.log(`[scheduled] uncaught for ${c.id}: ${e?.message || e}`);
        summary.errors.push({ id: c.id, category: 'uncaught', error: String(e?.message || e) });
      }
    }

    summary.duration_ms = Date.now() - startedAt;
    console.log('[scheduled] run complete', JSON.stringify(summary));

    // Store last run summary in KV for admin visibility
    await env.KV.put(
      'cron:last-run',
      JSON.stringify(summary),
      { expirationTtl: 86400 * 7 }
    );
  } catch (topErr) {
    summary.duration_ms = Date.now() - startedAt;
    summary.fatal = String(topErr?.message || topErr);
    console.log('[scheduled] FATAL', JSON.stringify(summary));
  }
}

// ================================================================
// Process a single creator: fetch live state, write snapshot, scrape edges
// ================================================================
async function processCreator(env, c, handleMap, now) {
  const result = {
    wrote_snapshot: false,
    is_live: false,
    edges_written: 0,
    error: null,
  };

  let streamTitle = null;
  let gameName = null;
  let viewers = 0;
  let followers = null;
  let startedAt = null;

  try {
    if (c.platform === 'twitch') {
      // Twitch needs user_id to query stream endpoint. Cache it in KV.
      const twitchUserId = await getTwitchUserId(env, c);
      if (!twitchUserId) {
        result.error = { category: 'no_user_id', error: 'could not resolve twitch user_id' };
        return result;
      }

      const stream = await fetchTwitchStream(env, twitchUserId);
      if (stream) {
        result.is_live = true;
        streamTitle = stream.title || null;
        gameName = stream.game_name || null;
        viewers = stream.viewer_count || 0;
        startedAt = stream.started_at
          ? Math.floor(new Date(stream.started_at).getTime() / 1000)
          : null;
      } else {
        // Not live — get current follower count separately
        const user = await fetchTwitchUser(env, c.handle);
        // Twitch helix users endpoint no longer returns follower count directly;
        // we skip follower update when offline to save requests.
        followers = null;
      }
    } else if (c.platform === 'kick') {
      const chan = await fetchKickChannel(env, c.handle);
      if (chan) {
        const ls = chan.livestream || chan.stream;
        if (ls && ls.is_live !== false) {
          result.is_live = true;
          streamTitle = ls.session_title || ls.stream_title || chan.session_title || null;
          gameName = (ls.categories && ls.categories[0]?.name) || chan.recent_categories?.[0]?.name || null;
          viewers = ls.viewer_count || 0;
          startedAt = ls.created_at
            ? Math.floor(new Date(ls.created_at).getTime() / 1000)
            : null;
        }
        followers = chan.followers_count || chan.followersCount || null;
      } else {
        result.error = { category: 'fetch_failed', error: 'kick channel null' };
        return result;
      }
    } else {
      result.error = { category: 'fetch_failed', error: `unknown platform: ${c.platform}` };
      return result;
    }
  } catch (e) {
    console.log(`[scheduled] fetch error for ${c.id}: ${e?.message || e}`);
    result.error = { category: 'fetch_failed', error: String(e?.message || e) };
    return result;
  }

  // Write snapshot row (even if offline — records the check happened)
  try {
    await env.DB.prepare(`
      INSERT INTO snapshots
        (creator_id, platform, viewers, followers, is_live, stream_title, stream_category, started_at, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      c.id,
      c.platform,
      viewers,
      followers,
      result.is_live ? 1 : 0,
      streamTitle,
      gameName,  // writes into existing stream_category column
      startedAt,
      now
    ).run();
    result.wrote_snapshot = true;
  } catch (dbErr) {
    console.log(`[scheduled] snapshot insert failed for ${c.id}: ${dbErr?.message || dbErr}`);
    result.error = { category: 'snapshot_failed', error: String(dbErr?.message || dbErr) };
    return result;
  }

  // If we got a title, scrape it for mentions and write edges
  if (streamTitle) {
    const matches = [...streamTitle.matchAll(MENTION_PATTERN)];
    for (const m of matches) {
      const mentionedHandle = (m[1] || '').toLowerCase();
      const targetCreatorId = handleMap.get(mentionedHandle);
      if (!targetCreatorId || targetCreatorId === c.id) continue;

      const phrase = m[0].toLowerCase();
      let edgeType = 'mention';
      if (phrase.includes('raid')) edgeType = 'raid';
      else if (phrase.includes('host')) edgeType = 'host';
      else if (phrase.includes('shout')) edgeType = 'shoutout';

      try {
        await env.DB.prepare(`
          INSERT INTO creator_edges
            (from_creator_id, to_creator_id, edge_type, weight, last_seen_at, first_seen_at, platform, source)
          VALUES (?, ?, ?, 1, ?, ?, ?, 'scheduled_scan')
          ON CONFLICT(from_creator_id, to_creator_id, edge_type)
          DO UPDATE SET
            weight = weight + 1,
            last_seen_at = excluded.last_seen_at
        `).bind(c.id, targetCreatorId, edgeType, now, now, c.platform).run();
        result.edges_written++;
      } catch (edgeErr) {
        console.log(`[scheduled] edge insert failed ${c.id}->${targetCreatorId}: ${edgeErr?.message || edgeErr}`);
        result.error = { category: 'edge_failed', error: String(edgeErr?.message || edgeErr) };
      }
    }
  }

  return result;
}

// ================================================================
// Handle map: handle (lowercase) → creator_id
// Cached in KV for 1 hour — handles are stable enough.
// ================================================================
async function loadHandleMap(env) {
  const cached = await env.KV.get(HANDLE_MAP_CACHE_KEY, 'json');
  if (cached && cached.ts && (Date.now() - cached.ts) < HANDLE_MAP_TTL * 1000) {
    return new Map(Object.entries(cached.map));
  }

  const res = await env.DB.prepare(`
    SELECT handle, creator_id FROM creator_platforms WHERE handle IS NOT NULL
  `).all();

  const map = new Map();
  const obj = {};
  for (const r of (res.results || [])) {
    if (r.handle) {
      const k = String(r.handle).toLowerCase();
      map.set(k, r.creator_id);
      obj[k] = r.creator_id;
    }
  }

  await env.KV.put(
    HANDLE_MAP_CACHE_KEY,
    JSON.stringify({ map: obj, ts: Date.now() }),
    { expirationTtl: HANDLE_MAP_TTL }
  );

  return map;
}

// ================================================================
// Twitch user_id resolver. Cached permanently in KV per handle
// (Twitch user IDs never change).
// ================================================================
async function getTwitchUserId(env, creator) {
  const cacheKey = `twitch:user-id:${creator.handle.toLowerCase()}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return cached;

  const user = await fetchTwitchUser(env, creator.handle);
  if (user?.id) {
    await env.KV.put(cacheKey, user.id); // permanent
    return user.id;
  }
  return null;
}

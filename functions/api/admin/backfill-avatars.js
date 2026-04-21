// ================================================================
// functions/api/admin/backfill-avatars.js
// POST /api/admin/backfill-avatars
// Fetches profile image URLs from Twitch and Kick for creators who
// don't have an avatar_url yet. Writes them straight to the creators
// table. Idempotent — skips creators who already have an avatar.
//
// Auth: X-Admin-Password required.
// Body: { limit?: number (default 50, cap 100) }
//
// Uses the same Twitch/Kick helpers as the rest of the site. Caches
// per-handle API results in memory for this run to avoid duplicate calls.
// ================================================================

import {
  jsonResponse,
  requireAdminAuth,
  fetchTwitchUser,
  fetchKickChannel,
} from '../../_lib.js';

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try { body = await request.json(); } catch { /* fine */ }
  const limit = Math.min(parseInt(body?.limit || 50, 10), 100);
  const debug = body?.debug === true;

  try {
    // DEBUG MODE — return raw API response for one Twitch and one Kick creator
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
          const tw = await fetchTwitchUser(env, twitchSample.handle);
          result.twitch = { handle: twitchSample.handle, response: tw, response_keys: tw ? Object.keys(tw) : null };
        } catch (e) {
          result.twitch = { handle: twitchSample.handle, error: String(e?.message || e) };
        }
      }
      if (kickSample) {
        try {
          const kk = await fetchKickChannel(env, kickSample.handle);
          result.kick = { handle: kickSample.handle, response: kk, response_keys: kk ? Object.keys(kk) : null };
        } catch (e) {
          result.kick = { handle: kickSample.handle, error: String(e?.message || e) };
        }
      }
      return jsonResponse({ ok: true, debug: true, samples: result });
    }

    // Pull creators without an avatar, joined with primary platform
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
      return jsonResponse({
        ok: true,
        done: true,
        processed: 0,
        updated: 0,
        message: 'No creators missing avatars',
      });
    }

    let updated = 0;
    const errors = [];
    const errorCounts = {
      fetch_failed: 0,
      no_avatar_in_response: 0,
      db_update_failed: 0,
      unknown_platform: 0,
    };
    const samples = [];

    console.log(`[backfill-avatars] starting batch of ${targets.length} creators`);

    for (const t of targets) {
      let avatarUrl = null;

      try {
        if (t.platform === 'twitch') {
          const user = await fetchTwitchUser(env, t.handle);
          // Twitch user object has profile_image_url
          avatarUrl = user?.profile_image_url || null;
        } else if (t.platform === 'kick') {
          const chan = await fetchKickChannel(env, t.handle);
          // Kick: profile_picture on v1, user.profile_pic on v2 fallback
          avatarUrl = chan?.profile_picture
            || chan?.user?.profile_pic
            || chan?.banner_image?.url
            || null;
        } else {
          errorCounts.unknown_platform++;
          errors.push({ id: t.id, category: 'unknown_platform', platform: t.platform });
          continue;
        }
      } catch (e) {
        console.log(`[backfill-avatars] fetch error for ${t.id}: ${e?.message || e}`);
        errorCounts.fetch_failed++;
        errors.push({ id: t.id, category: 'fetch_failed', error: String(e?.message || e) });
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
        console.log(`[backfill-avatars] db update failed for ${t.id}: ${dbErr?.message || dbErr}`);
        errorCounts.db_update_failed++;
        errors.push({ id: t.id, category: 'db_update_failed', error: String(dbErr?.message || dbErr) });
      }
    }

    console.log(`[backfill-avatars] complete: updated=${updated}, errors=${errors.length}`);

    return jsonResponse({
      ok: true,
      processed: targets.length,
      updated,
      remaining_unknown: Math.max(0, targets.length - updated),
      error_counts: errorCounts,
      error_sample: errors.slice(0, 5),
      samples,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

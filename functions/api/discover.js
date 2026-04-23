// ================================================================
// functions/api/discover.js
// GET /api/discover
// The Discovery Engine v0.1 — returns all creators enriched with
// filterable metadata: live status, primary platform, category tags,
// average viewers, momentum delta.
//
// Query params (all optional):
//   platform=twitch|kick   filter by primary platform
//   live=1                 only creators currently live (viewers > 0 in last hour)
//   category=gta-rp        filter by category substring
//   min_followers=1000     minimum follower count
//   max_followers=50000    maximum follower count
//   sort=momentum|followers|live|name  (default: momentum)
//   limit=100              default 100, max 500
// ================================================================

import { jsonResponse, parseBoundedInt } from '../_lib.js';

const ALLOWED_PLATFORMS = new Set(['twitch', 'kick']);
const ALLOWED_SORTS = new Set(['momentum', 'followers', 'live', 'name']);

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const liveOnly = url.searchParams.get('live') === '1';
  const category = url.searchParams.get('category');
  const minFollowers = parseBoundedInt(url.searchParams.get('min_followers'), 0, 0, 10_000_000_000);
  const maxFollowers = parseBoundedInt(url.searchParams.get('max_followers'), 0, 0, 10_000_000_000);
  const sort = url.searchParams.get('sort') || 'momentum';
  const limit = parseBoundedInt(url.searchParams.get('limit'), 100, 1, 500);

  if (platform && !ALLOWED_PLATFORMS.has(platform)) {
    return jsonResponse({ ok: false, error: 'invalid platform' }, 400);
  }
  if (!ALLOWED_SORTS.has(sort)) {
    return jsonResponse({ ok: false, error: 'invalid sort' }, 400);
  }

  try {
    const recentCutoff = Math.floor(Date.now() / 1000) - 3600; // 1 hour

    // Pull creators joined with their primary platform handle, latest snapshot,
    // and a 7-day-ago snapshot for momentum delta. All in one query.
    // Note: latest CTE is scoped to last 7 days — we only need the most recent
    // row per creator, and any creator with no snapshot in 7 days is effectively dormant.
    const sql = `
      WITH latest AS (
        SELECT creator_id, platform, viewers, followers, is_live, stream_title, stream_category, started_at, captured_at,
          ROW_NUMBER() OVER (PARTITION BY creator_id, platform ORDER BY captured_at DESC) AS rn
        FROM snapshots
        WHERE captured_at > unixepoch() - 604800
      ),
      seven_days_ago AS (
        SELECT creator_id, platform, followers, captured_at,
          ROW_NUMBER() OVER (PARTITION BY creator_id, platform ORDER BY ABS(captured_at - (unixepoch() - 604800)) ASC) AS rn
        FROM snapshots
        WHERE captured_at < unixepoch() - 518400
          AND captured_at > unixepoch() - 691200
      )
      SELECT 
        c.id,
        c.display_name,
        c.bio,
        c.categories,
        c.avatar_url,
        c.accent_colour,
        cp.platform AS primary_platform,
        cp.handle AS primary_handle,
        cp.verified AS primary_verified,
        l.viewers AS current_viewers,
        l.followers AS current_followers,
        l.stream_title AS current_stream_title,
        l.stream_category AS current_game_name,
        l.started_at AS current_started_at,
        l.captured_at AS last_snapshot_at,
        CASE 
          WHEN l.is_live = 1 AND l.captured_at > ? THEN 1
          ELSE 0
        END AS is_live,
        prev.followers AS followers_7d_ago
      FROM creators c
      LEFT JOIN creator_platforms cp 
        ON cp.creator_id = c.id AND cp.is_primary = 1
      LEFT JOIN latest l 
        ON l.creator_id = c.id AND l.platform = cp.platform AND l.rn = 1
      LEFT JOIN seven_days_ago prev 
        ON prev.creator_id = c.id AND prev.platform = cp.platform AND prev.rn = 1
      WHERE c.role = 'creator'
      ORDER BY c.display_name COLLATE NOCASE ASC
    `;

    const result = await env.DB.prepare(sql).bind(recentCutoff).all();
    let rows = result.results || [];

    // Post-process: filters that are easier to express in JS than SQL
    let creators = rows.map((r) => {
      const followers = r.current_followers || 0;
      const followers7d = r.followers_7d_ago || null;
      const hasHistory = followers7d !== null && followers7d !== undefined;
      const momentumDelta = hasHistory
        ? followers - followers7d
        : null;
      const momentumPct = (hasHistory && followers7d > 0)
        ? ((followers - followers7d) / followers7d) * 100
        : null;

      return {
        id: r.id,
        display_name: r.display_name,
        bio: r.bio,
        categories: r.categories ? r.categories.split(',').map((s) => s.trim()).filter(Boolean) : [],
        avatar_url: r.avatar_url,
        accent_colour: r.accent_colour,
        platform: r.primary_platform,
        handle: r.primary_handle,
        verified: r.primary_verified === 1,
        is_live: r.is_live === 1,
        current_viewers: r.current_viewers || 0,
        stream_title: r.current_stream_title || null,
        game_name: r.current_game_name || null,
        uptime_mins: r.current_started_at
          ? Math.max(0, Math.round((Date.now() / 1000 - r.current_started_at) / 60))
          : null,
        followers: followers,
        momentum_delta: momentumDelta,
        momentum_pct: momentumPct,
        profile_url: `/creator/${r.id}`,
      };
    });

    // Apply filters
    if (platform) {
      creators = creators.filter((c) => c.platform === platform);
    }
    if (liveOnly) {
      creators = creators.filter((c) => c.is_live);
    }
    if (category) {
      const catLower = category.toLowerCase();
      creators = creators.filter((c) => 
        c.categories.some((cat) => cat.toLowerCase().includes(catLower))
      );
    }
    if (minFollowers > 0) {
      creators = creators.filter((c) => c.followers >= minFollowers);
    }
    if (maxFollowers > 0) {
      creators = creators.filter((c) => c.followers <= maxFollowers);
    }

    // Apply sort
    switch (sort) {
      case 'followers':
        creators.sort((a, b) => b.followers - a.followers);
        break;
      case 'live':
        creators.sort((a, b) => {
          if (a.is_live !== b.is_live) return b.is_live - a.is_live;
          return b.current_viewers - a.current_viewers;
        });
        break;
      case 'name':
        // already sorted by name
        break;
      case 'momentum':
      default:
        creators.sort((a, b) => {
          const aM = a.momentum_pct === null ? -Infinity : a.momentum_pct;
          const bM = b.momentum_pct === null ? -Infinity : b.momentum_pct;
          return bM - aM;
        });
        break;
    }

    // Count aggregates BEFORE limit is applied, so the UI can show "X of Y match"
    const totalMatches = creators.length;
    const liveCount = creators.filter((c) => c.is_live).length;

    // Apply limit last
    creators = creators.slice(0, limit);

    return jsonResponse({
      ok: true,
      count: creators.length,
      total_matches: totalMatches,
      live_count: liveCount,
      filters_applied: { platform, live: liveOnly, category, min_followers: minFollowers || null, max_followers: maxFollowers || null, sort },
      creators,
    });
  } catch (err) {
    return jsonResponse({ 
      ok: false, 
      error: String(err?.message || err) 
    }, 500);
  }
}

// ================================================================
// functions/api/creator/[slug].js
// GET /api/creator/:slug
// Returns a creator's full profile data: platforms, lore, snapshot
// series for sparklines.
// ================================================================

import { jsonResponse } from '../../_lib.js';

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  if (!slug) return jsonResponse({ error: 'Slug required' }, 400);

  try {
    // 1. Core creator row
    const creator = await env.DB
      .prepare(`SELECT * FROM creators WHERE id = ?`)
      .bind(slug)
      .first();
    if (!creator) return jsonResponse({ error: 'Creator not found' }, 404);

    // 2. All platforms
    const platformsResult = await env.DB
      .prepare(
        `SELECT platform, handle, platform_id, is_primary, verified, verified_at
         FROM creator_platforms WHERE creator_id = ?
         ORDER BY is_primary DESC, platform ASC`
      )
      .bind(slug)
      .all();

    // 3. Recent lore entries
    const loreResult = await env.DB
      .prepare(
        `SELECT id, title, body, entry_type, entry_date, created_at
         FROM lore_entries WHERE creator_id = ?
         ORDER BY entry_date DESC, created_at DESC
         LIMIT 20`
      )
      .bind(slug)
      .all();

    // 4. Last 30 days of snapshots for sparkline
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
    const snapshotsResult = await env.DB
      .prepare(
        `SELECT platform, followers, viewers, captured_at
         FROM snapshots
         WHERE creator_id = ? AND captured_at > ?
         ORDER BY captured_at ASC`
      )
      .bind(slug, thirtyDaysAgo)
      .all();

    return jsonResponse({
      ok: true,
      creator: {
        id: creator.id,
        display_name: creator.display_name,
        role: creator.role,
        bio: creator.bio,
        categories: creator.categories
          ? creator.categories.split(',').map((s) => s.trim())
          : [],
        origin_story: creator.origin_story,
        avatar_url: creator.avatar_url,
        accent_colour: creator.accent_colour,
        created_at: creator.created_at,
        updated_at: creator.updated_at,
      },
      platforms: (platformsResult.results || []).map((p) => ({
        platform: p.platform,
        handle: p.handle,
        is_primary: p.is_primary === 1,
        verified: p.verified === 1,
        verified_at: p.verified_at,
      })),
      lore: loreResult.results || [],
      snapshots: snapshotsResult.results || [],
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

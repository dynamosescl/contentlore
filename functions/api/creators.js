// ================================================================
// functions/api/creators.js
// GET /api/creators
// Returns all creators with their primary platform handle merged in.
// Used by homepage directory, Rising panel, and client-side filters.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 500);
  const category = url.searchParams.get('category'); // optional filter

  try {
    let sql = `
      SELECT 
        c.id,
        c.display_name,
        c.role,
        c.bio,
        c.categories,
        c.avatar_url,
        c.accent_colour,
        c.created_at,
        c.updated_at,
        cp.platform AS primary_platform,
        cp.handle AS primary_handle,
        cp.verified AS primary_verified
      FROM creators c
      LEFT JOIN creator_platforms cp 
        ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE c.role = 'creator'
    `;
    const params = [];
    if (category) {
      sql += ` AND c.categories LIKE ?`;
      params.push(`%${category}%`);
    }
    sql += ` ORDER BY c.display_name COLLATE NOCASE ASC LIMIT ?`;
    params.push(limit);

    const result = await env.DB.prepare(sql).bind(...params).all();
    const creators = (result.results || []).map((r) => ({
      id: r.id,
      display_name: r.display_name,
      role: r.role,
      bio: r.bio,
      categories: r.categories ? r.categories.split(',').map((s) => s.trim()) : [],
      avatar_url: r.avatar_url,
      accent_colour: r.accent_colour,
      primary_platform: r.primary_platform,
      primary_handle: r.primary_handle,
      primary_verified: r.primary_verified === 1,
      profile_url: `/creator/${r.id}`,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return jsonResponse({
      ok: true,
      count: creators.length,
      creators,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/beef/[slug].js
// GET /api/beef/:slug
//
// Returns a single beef by slug with full detail.
// Also checks if participants are currently live (for "both sides live" feature).
// ================================================================

import { jsonResponse } from '../../_lib.js';

export async function onRequestGet({ env, params }) {
  try {
    const slug = params.slug;
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return jsonResponse({ ok: false, error: 'Invalid slug' }, 400);
    }

    const row = await env.DB.prepare(
      'SELECT * FROM beefs WHERE slug = ?'
    ).bind(slug).first();

    if (!row) {
      return jsonResponse({ ok: false, error: 'Beef not found' }, 404);
    }

    const beef = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      hook: row.hook,
      summary: row.summary,
      server_id: row.server_id,
      participants: safeParseJSON(row.participants, []),
      crews: safeParseJSON(row.crews, null),
      status: row.status,
      heat: row.heat,
      beats: safeParseJSON(row.beats, []),
      started: row.started,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    // Check if participants are currently live
    const handles = beef.participants;
    const liveStatus = {};

    if (handles.length > 0) {
      const placeholders = handles.map(() => '?').join(',');
      const liveRes = await env.DB.prepare(`
        SELECT cp.handle, cp.platform, ss.peak_viewers
        FROM stream_sessions ss
        INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id AND cp.is_primary = 1
        WHERE ss.is_ongoing = 1
          AND LOWER(cp.handle) IN (${placeholders})
      `).bind(...handles.map(h => h.toLowerCase())).all();

      for (const r of (liveRes.results || [])) {
        liveStatus[r.handle.toLowerCase()] = {
          is_live: true,
          platform: r.platform,
          viewers: r.peak_viewers,
        };
      }
    }

    beef.live_status = liveStatus;
    beef.both_sides_live = handles.length >= 2
      && handles.filter(h => liveStatus[h.toLowerCase()]?.is_live).length >= 2;

    return jsonResponse({ ok: true, beef });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function safeParseJSON(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

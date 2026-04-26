// ================================================================
// functions/api/lore/[slug].js
// GET /api/lore/:slug
//
// Returns a single lore arc by slug with full chapter detail.
// Also includes linked beefs and participant live status.
// ================================================================

import { jsonResponse } from '../../_lib.js';

export async function onRequestGet({ env, params }) {
  try {
    const slug = params.slug;
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return jsonResponse({ ok: false, error: 'Invalid slug' }, 400);
    }

    const row = await env.DB.prepare(
      'SELECT * FROM lore_arcs WHERE slug = ?'
    ).bind(slug).first();

    if (!row) {
      return jsonResponse({ ok: false, error: 'Arc not found' }, 404);
    }

    const arc = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      hook: row.hook,
      summary: row.summary,
      kind: row.kind,
      era: row.era,
      server_id: row.server_id,
      participants: safeParseJSON(row.participants, []),
      crews: safeParseJSON(row.crews, null),
      beef_ids: safeParseJSON(row.beef_ids, null),
      weight: row.weight,
      chapters: safeParseJSON(row.chapters, []),
      ai_summary: row.ai_summary,
      ai_summary_updated_at: row.ai_summary_updated_at,
      started: row.started,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    // Fetch linked beefs if any
    const beefIds = arc.beef_ids || [];
    if (beefIds.length > 0) {
      const placeholders = beefIds.map(() => '?').join(',');
      const beefRes = await env.DB.prepare(
        `SELECT id, slug, title, hook, status, heat FROM beefs WHERE slug IN (${placeholders})`
      ).bind(...beefIds).all();
      arc.linked_beefs = (beefRes.results || []).map(b => ({
        id: b.id,
        slug: b.slug,
        title: b.title,
        hook: b.hook,
        status: b.status,
        heat: b.heat,
      }));
    } else {
      arc.linked_beefs = [];
    }

    return jsonResponse({ ok: true, arc });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function safeParseJSON(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

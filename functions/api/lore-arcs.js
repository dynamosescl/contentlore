// ================================================================
// functions/api/lore-arcs.js
// GET /api/lore-arcs
//
// Returns all lore arcs, optionally filtered by server_id, kind, era.
// Sorted by weight DESC, then started DESC.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    const serverFilter = url.searchParams.get('server');
    const kindFilter = url.searchParams.get('kind');
    const eraFilter = url.searchParams.get('era');

    let sql = 'SELECT * FROM lore_arcs WHERE 1=1';
    const binds = [];

    if (serverFilter) {
      sql += ' AND server_id = ?';
      binds.push(serverFilter);
    }
    if (kindFilter) {
      sql += ' AND kind = ?';
      binds.push(kindFilter);
    }
    if (eraFilter) {
      sql += ' AND era = ?';
      binds.push(eraFilter);
    }

    sql += ' ORDER BY weight DESC, started DESC';

    const stmt = binds.length > 0
      ? env.DB.prepare(sql).bind(...binds)
      : env.DB.prepare(sql);

    const res = await stmt.all();
    const arcs = (res.results || []).map(parseArcRow);

    return jsonResponse({ ok: true, arcs, count: arcs.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function parseArcRow(row) {
  return {
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
}

function safeParseJSON(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

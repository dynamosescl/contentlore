// ================================================================
// functions/api/beefs.js
// GET /api/beefs
//
// Returns all beefs, optionally filtered by server_id and/or status.
// Sorted by heat DESC, then started DESC.
// ================================================================

import { jsonResponse } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    const serverFilter = url.searchParams.get('server');
    const statusFilter = url.searchParams.get('status');

    let sql = 'SELECT * FROM beefs WHERE 1=1';
    const binds = [];

    if (serverFilter) {
      sql += ' AND server_id = ?';
      binds.push(serverFilter);
    }
    if (statusFilter) {
      sql += ' AND status = ?';
      binds.push(statusFilter);
    }

    sql += ' ORDER BY heat DESC, started DESC';

    const stmt = binds.length > 0
      ? env.DB.prepare(sql).bind(...binds)
      : env.DB.prepare(sql);

    const res = await stmt.all();
    const beefs = (res.results || []).map(parseBeefRow);

    return jsonResponse({ ok: true, beefs, count: beefs.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function parseBeefRow(row) {
  return {
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
}

function safeParseJSON(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

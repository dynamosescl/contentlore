// ================================================================
// functions/api/admin/pending/reject-all.js
// POST /api/admin/pending/reject-all
// Bulk-rejects pending creators. Optionally filtered by source.
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth, parseBoundedInt } from '../../../_lib.js';

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body fine */
  }
  const max = parseBoundedInt(body?.max, 200, 1, 500);
  const sourceFilter = body?.source || null;
  const reason = body?.reason || 'bulk_reject';

  try {
    let sql = `
      UPDATE pending_creators 
      SET status = 'rejected', reviewed_at = unixepoch(), notes = ?
      WHERE id IN (
        SELECT id FROM pending_creators WHERE status = 'pending'
    `;
    const params = [reason];
    if (sourceFilter) {
      sql += ` AND source = ?`;
      params.push(sourceFilter);
    }
    sql += ` ORDER BY created_at ASC LIMIT ?)`;
    params.push(max);

    const result = await env.DB.prepare(sql).bind(...params).run();
    return jsonResponse({
      ok: true,
      rejected: result.meta?.changes ?? 0,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

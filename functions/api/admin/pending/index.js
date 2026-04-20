// ================================================================
// functions/api/admin/pending/index.js
// GET /api/admin/pending
// Lists pending creators awaiting review.
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../../_lib.js';

export async function onRequestGet({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);
  const source = url.searchParams.get('source'); // optional filter: auto_discovery, self_claim, manual

  try {
    let sql = `
      SELECT id, source, platform, handle, display_name, bio, profile_image,
             followers, category, email, verified, discovery_reason, status, notes,
             created_at, reviewed_at, referred_by
      FROM pending_creators
      WHERE status = ?
    `;
    const params = [status];
    if (source) {
      sql += ` AND source = ?`;
      params.push(source);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await env.DB.prepare(sql).bind(...params).all();
    return jsonResponse({
      ok: true,
      status,
      count: (result.results || []).length,
      pending: result.results || [],
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

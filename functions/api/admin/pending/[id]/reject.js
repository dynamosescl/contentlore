// ================================================================
// functions/api/admin/pending/[id]/reject.js
// POST /api/admin/pending/:id/reject
// Marks a pending creator as rejected (does not delete — audit trail).
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../../../_lib.js';

export async function onRequestPost({ env, request, params }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const pendingId = parseInt(params.id, 10);
  if (!pendingId) return jsonResponse({ error: 'Invalid id' }, 400);

  try {
    const pending = await env.DB
      .prepare(`SELECT id, status FROM pending_creators WHERE id = ?`)
      .bind(pendingId)
      .first();
    if (!pending) return jsonResponse({ error: 'Pending creator not found' }, 404);
    if (pending.status !== 'pending') {
      return jsonResponse({ error: `Already ${pending.status}` }, 409);
    }

    // Read optional reason from body
    let reason = null;
    try {
      const body = await request.json();
      reason = body?.reason || null;
    } catch {
      /* no body, fine */
    }

    await env.DB
      .prepare(
        `UPDATE pending_creators 
         SET status = 'rejected', 
             reviewed_at = unixepoch(),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .bind(reason, pendingId)
      .run();

    return jsonResponse({ ok: true, rejected: true, id: pendingId });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

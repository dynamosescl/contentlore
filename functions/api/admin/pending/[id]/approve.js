// ================================================================
// functions/api/admin/pending/[id]/approve.js
// POST /api/admin/pending/:id/approve
// Moves a pending creator into the live `creators` table.
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth, slugify } from '../../../../_lib.js';

export async function onRequestPost({ env, request, params }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  const pendingId = parseInt(params.id, 10);
  if (!pendingId) return jsonResponse({ error: 'Invalid id' }, 400);

  try {
    const pending = await env.DB
      .prepare(`SELECT * FROM pending_creators WHERE id = ?`)
      .bind(pendingId)
      .first();
    if (!pending) return jsonResponse({ error: 'Pending creator not found' }, 404);
    if (pending.status !== 'pending') {
      return jsonResponse({ error: `Already ${pending.status}` }, 409);
    }

    // Build creator ID: prefer the handle, slugified; for Kick prefix with kick-
    const baseId = slugify(pending.handle);
    const creatorId = pending.platform === 'kick' ? `kick-${baseId}` : baseId;

    // Check for collision
    const existing = await env.DB
      .prepare(`SELECT id FROM creators WHERE id = ?`)
      .bind(creatorId)
      .first();
    if (existing) {
      return jsonResponse(
        { error: `Creator ${creatorId} already exists in catalogue` },
        409
      );
    }

    // Insert into creators
    await env.DB
      .prepare(
        `INSERT INTO creators (id, display_name, role, bio, categories, avatar_url)
         VALUES (?, ?, 'creator', ?, ?, ?)`
      )
      .bind(
        creatorId,
        pending.display_name || pending.handle,
        pending.bio || null,
        pending.category || null,
        pending.profile_image || null
      )
      .run();

    // Insert primary platform link
    await env.DB
      .prepare(
        `INSERT INTO creator_platforms 
         (creator_id, platform, handle, is_primary, verified, verified_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
      .bind(
        creatorId,
        pending.platform,
        pending.handle,
        pending.source === 'self_claim' ? 1 : 0,
        pending.source === 'self_claim' ? Math.floor(Date.now() / 1000) : null
      )
      .run();

    // Mark pending as approved
    await env.DB
      .prepare(
        `UPDATE pending_creators 
         SET status = 'approved', reviewed_at = unixepoch() 
         WHERE id = ?`
      )
      .bind(pendingId)
      .run();

    return jsonResponse({
      ok: true,
      approved: true,
      creator_id: creatorId,
      display_name: pending.display_name || pending.handle,
      profile_url: `/creator/${creatorId}`,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

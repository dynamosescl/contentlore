// ================================================================
// functions/api/admin/pending/approve-all.js
// POST /api/admin/pending/approve-all
// Bulk-approves all pending creators in one call.
// Paged to max 50 per call for D1 batch safety.
// Body (optional): { max: N, source: 'auto_discovery' }
// Auth: X-Admin-Password header required.
// ================================================================

import { jsonResponse, requireAdminAuth, slugify, parseBoundedInt } from '../../../_lib.js';

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const max = parseBoundedInt(body?.max, 50, 1, 100);
  const sourceFilter = body?.source || null;

  try {
    let sql = `SELECT * FROM pending_creators WHERE status = 'pending'`;
    const params = [];
    if (sourceFilter) {
      sql += ` AND source = ?`;
      params.push(sourceFilter);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(max);

    const pendingResult = await env.DB.prepare(sql).bind(...params).all();
    const pending = pendingResult.results || [];
    if (pending.length === 0) {
      return jsonResponse({ ok: true, approved: 0, skipped: 0, errors: [] });
    }

    let approved = 0;
    let skipped = 0;
    const errors = [];

    for (const p of pending) {
      try {
        const baseId = slugify(p.handle);
        const creatorId = p.platform === 'kick' ? `kick-${baseId}` : baseId;

        // Check collision
        const existing = await env.DB
          .prepare(`SELECT id FROM creators WHERE id = ?`)
          .bind(creatorId)
          .first();
        if (existing) {
          // Already in catalogue, just mark pending as approved
          await env.DB
            .prepare(
              `UPDATE pending_creators SET status = 'approved', reviewed_at = unixepoch(),
               notes = COALESCE(notes, '') || ' [auto: creator already existed]'
               WHERE id = ?`
            )
            .bind(p.id)
            .run();
          skipped++;
          continue;
        }

        // Insert creator
        await env.DB
          .prepare(
            `INSERT INTO creators (id, display_name, role, bio, categories, avatar_url)
             VALUES (?, ?, 'creator', ?, ?, ?)`
          )
          .bind(
            creatorId,
            p.display_name || p.handle,
            p.bio || null,
            p.category || null,
            p.profile_image || null
          )
          .run();

        // Insert primary platform
        await env.DB
          .prepare(
            `INSERT INTO creator_platforms 
             (creator_id, platform, handle, is_primary, verified, verified_at)
             VALUES (?, ?, ?, 1, ?, ?)`
          )
          .bind(
            creatorId,
            p.platform,
            p.handle,
            p.source === 'self_claim' ? 1 : 0,
            p.source === 'self_claim' ? Math.floor(Date.now() / 1000) : null
          )
          .run();

        // Mark pending as approved
        await env.DB
          .prepare(
            `UPDATE pending_creators SET status = 'approved', reviewed_at = unixepoch() 
             WHERE id = ?`
          )
          .bind(p.id)
          .run();

        approved++;
      } catch (e) {
        errors.push({ id: p.id, handle: p.handle, error: String(e?.message || e) });
      }
    }

    return jsonResponse({ ok: true, approved, skipped, errors, processed: pending.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/admin/submissions.js
// GET  /api/admin/submissions          — list submissions
// POST /api/admin/submissions          — body { id, action, reviewer? }
//   action ∈ { 'approve', 'reject' }
//
// Submissions live in `pending_creators` rows whose `notes` column
// starts with the literal `SUBMITTED:` sentinel — that's how the
// public /api/submit form rows are distinguished from the
// auto-discovery rows. Same table, different origin marker.
//
// Bearer-authed via env.ADMIN_TOKEN. Approve currently moves the row
// to status='approved' and stamps reviewed_at — actually wiring it
// into `creators` + `creator_platforms` + bumping the curated 26
// allowlist is a manual follow-up (the allowlist is in code, not D1,
// so it needs a deploy). Reject just stamps status='rejected'.
// ================================================================

const NOTES_PREFIX = 'SUBMITTED:';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: corsHeaders(),
    });
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);

  try {
    const res = await env.DB.prepare(`
      SELECT id, name, platform, status, detected_server,
             discovered_title, first_seen, last_seen, reviewed_at,
             reviewed_by, notes
      FROM pending_creators
      WHERE notes LIKE ?
        AND status = ?
      ORDER BY first_seen DESC
      LIMIT ?
    `).bind(NOTES_PREFIX + '%', status, limit).all();

    const rows = (res.results || []).map(r => {
      // Parse the JSON tail of `notes`. Bad rows get nulled gracefully.
      let parsed = null;
      if (r.notes && r.notes.startsWith(NOTES_PREFIX)) {
        try { parsed = JSON.parse(r.notes.slice(NOTES_PREFIX.length)); }
        catch { parsed = null; }
      }
      return {
        id: r.id,
        name: r.name,
        primary_platform: r.platform,
        status: r.status,
        detected_server: r.detected_server,
        bio: r.discovered_title || (parsed?.bio) || null,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        reviewed_at: r.reviewed_at,
        reviewed_by: r.reviewed_by,
        socials: parsed?.socials || null,
        servers: parsed?.servers || null,
        submitted_at: parsed?.submitted_at || null,
        ip: parsed?.ip || null,
        user_agent: parsed?.user_agent || null,
      };
    });

    // Counts by status for the tab badge.
    const countsRes = await env.DB.prepare(`
      SELECT status, COUNT(*) AS n
      FROM pending_creators
      WHERE notes LIKE ?
      GROUP BY status
    `).bind(NOTES_PREFIX + '%').all();
    const counts = {};
    for (const c of (countsRes.results || [])) counts[c.status] = c.n;

    return new Response(JSON.stringify({
      ok: true, count: rows.length, status, counts, submissions: rows,
    }), { headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

export async function onRequestPost({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const id = parseInt(body.id, 10);
  const action = String(body.action || '').toLowerCase();
  const reviewer = String(body.reviewer || 'mod').slice(0, 64);
  if (!id || !['approve', 'reject'].includes(action)) {
    return new Response(JSON.stringify({ ok: false, error: 'id and action ∈ {approve,reject} required' }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  try {
    const res = await env.DB.prepare(`
      UPDATE pending_creators
         SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?
       WHERE id = ?
         AND notes LIKE ?
    `).bind(newStatus, reviewer, id, NOTES_PREFIX + '%').run();

    if (!res.meta?.changes) {
      return new Response(JSON.stringify({ ok: false, error: 'Submission not found' }), {
        status: 404, headers: corsHeaders(),
      });
    }
    return new Response(JSON.stringify({ ok: true, id, status: newStatus }), {
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

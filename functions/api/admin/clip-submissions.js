// ================================================================
// functions/api/admin/clip-submissions.js
// GET  /api/admin/clip-submissions?status=pending|approved|rejected|all
// POST /api/admin/clip-submissions  body: { id, action, note? }
//   action ∈ { 'approve', 'reject' }
//
// Lists and decides community-submitted clips. Bearer-authed via
// env.ADMIN_TOKEN. Approved rows surface on the clip wall via
// /api/clips with a community_pick:true flag.
// ================================================================

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}
function unauth() {
  return new Response(JSON.stringify({ ok: false, error: 'Unauthorised' }), {
    status: 401, headers: corsHeaders(),
  });
}
function authOk(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  if (!authOk(request, env)) return unauth();
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '60', 10) || 60));

  let where = '';
  let bind = [];
  if (status !== 'all') { where = 'WHERE status = ?'; bind = [status]; }

  try {
    const res = await env.DB.prepare(
      `SELECT id, url, platform, clip_id, creator_handle, description, submitted_by_ip,
              user_agent, status, decided_at, decided_note, submitted_at
         FROM clip_submissions
         ${where}
         ORDER BY submitted_at DESC
         LIMIT ?`
    ).bind(...bind, limit).all();

    const counts = {};
    const cRes = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM clip_submissions GROUP BY status`
    ).all();
    for (const r of (cRes.results || [])) counts[r.status] = Number(r.n);

    return new Response(JSON.stringify({
      ok: true, count: (res.results || []).length, counts, submissions: res.results || []
    }), { headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

export async function onRequestPost({ request, env }) {
  if (!authOk(request, env)) return unauth();
  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: corsHeaders() }); }

  const id = parseInt(body.id, 10);
  const action = String(body.action || '').toLowerCase();
  const note = String(body.note || '').slice(0, 240);
  if (!id || (action !== 'approve' && action !== 'reject')) {
    return new Response(JSON.stringify({ ok: false, error: 'bad_input' }), { status: 400, headers: corsHeaders() });
  }
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const now = Math.floor(Date.now() / 1000);
  try {
    const r = await env.DB.prepare(
      `UPDATE clip_submissions
         SET status = ?, decided_at = ?, decided_note = ?
       WHERE id = ?`
    ).bind(newStatus, now, note || null, id).run();
    if (!r.meta || r.meta.changes === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404, headers: corsHeaders() });
    }
    return new Response(JSON.stringify({ ok: true, id, status: newStatus }), { headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

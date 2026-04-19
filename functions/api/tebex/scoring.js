// GET /api/tebex/scoring?key=<admin>&period=<period> — list editorial scores
// POST /api/tebex/scoring?key=<admin> — upsert a score for a server+period

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const period = url.searchParams.get('period') || 'Q2 2026';
  const scores = await env.DB.prepare(
    `SELECT * FROM tebex_scoring WHERE audit_period = ? ORDER BY total_score DESC`
  ).bind(period).all();
  return new Response(JSON.stringify({ period, scores: scores.results || [] }, null, 2),
    { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await request.json();
  const { audit_period, server_name, catalogue_breadth, pricing_posture,
          pla_alignment, marketing_honesty, transparency, editorial_summary, scored_by } = body;
  if (!audit_period || !server_name) {
    return new Response('audit_period and server_name required', { status: 400 });
  }
  const scores = [catalogue_breadth, pricing_posture, pla_alignment, marketing_honesty, transparency]
    .map(s => parseInt(s, 10) || 0);
  const total = scores.reduce((a, b) => a + b, 0);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tebex_scoring
     (audit_period, server_name, catalogue_breadth, pricing_posture, pla_alignment,
      marketing_honesty, transparency, total_score, editorial_summary, scored_by, scored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(audit_period, server_name, ...scores, total, editorial_summary || '', scored_by || 'Fats').run();
  return new Response(JSON.stringify({ ok: true, total }), { headers: { 'Content-Type': 'application/json' } });
}

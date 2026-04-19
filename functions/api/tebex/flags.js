// GET /api/tebex/flags?key=<admin>&run=<runId> — list flags for a run
// POST /api/tebex/flags?key=<admin> — update a flag (disposition, response, notes)

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const runId = url.searchParams.get('run');
  const query = runId
    ? `SELECT * FROM tebex_flags WHERE run_id = ? ORDER BY severity DESC, server_name`
    : `SELECT * FROM tebex_flags ORDER BY created_at DESC LIMIT 100`;
  const stmt = runId ? env.DB.prepare(query).bind(runId) : env.DB.prepare(query);
  const flags = await stmt.all();
  return new Response(JSON.stringify({ flags: flags.results || [] }, null, 2),
    { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await request.json();
  const { flag_id, right_of_reply_sent_at, response_received_at, response_text,
          published_disposition, final_notes } = body;
  if (!flag_id) return new Response('flag_id required', { status: 400 });
  await env.DB.prepare(
    `UPDATE tebex_flags SET
       right_of_reply_sent_at = COALESCE(?, right_of_reply_sent_at),
       response_received_at = COALESCE(?, response_received_at),
       response_text = COALESCE(?, response_text),
       published_disposition = COALESCE(?, published_disposition),
       final_notes = COALESCE(?, final_notes)
     WHERE flag_id = ?`
  ).bind(
    right_of_reply_sent_at || null, response_received_at || null,
    response_text || null, published_disposition || null,
    final_notes || null, flag_id
  ).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /api/tebex/targets?key=<admin> — list all target servers
// POST /api/tebex/targets?key=<admin> — upsert a target

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const targets = await env.DB.prepare(
    `SELECT * FROM tebex_targets ORDER BY include_in_audit DESC, server_name`
  ).all();
  return new Response(JSON.stringify({ targets: targets.results || [] }, null, 2),
    { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await request.json();
  const { server_name, tebex_url, store_type, include_in_audit, editorial_notes, contact_channel } = body;
  if (!server_name) return new Response('server_name required', { status: 400 });
  await env.DB.prepare(
    `INSERT INTO tebex_targets (server_name, tebex_url, store_type, include_in_audit, editorial_notes, contact_channel, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(server_name) DO UPDATE SET
       tebex_url = excluded.tebex_url,
       store_type = excluded.store_type,
       include_in_audit = excluded.include_in_audit,
       editorial_notes = excluded.editorial_notes,
       contact_channel = excluded.contact_channel,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    server_name, tebex_url || '', store_type || 'tebex-standard',
    include_in_audit ? 1 : 0, editorial_notes || '', contact_channel || ''
  ).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /api/tebex/runs?key=<admin> — list recent runs with summaries

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get('key');
  if (key !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  const runs = await env.DB.prepare(
    `SELECT * FROM tebex_runs ORDER BY started_at DESC LIMIT 20`
  ).all();
  const latestRunId = runs.results?.[0]?.run_id;
  let summaries = { results: [] };
  if (latestRunId) {
    summaries = await env.DB.prepare(
      `SELECT * FROM tebex_summaries WHERE run_id = ? ORDER BY server_name`
    ).bind(latestRunId).all();
  }
  return new Response(JSON.stringify({
    runs: runs.results || [],
    latestSummaries: summaries.results || []
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

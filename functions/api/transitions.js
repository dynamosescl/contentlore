// GET /api/transitions
// Returns all transition data: servers, creators, timeline
// Query params: type=servers|creators|timeline|all (default: all)

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'all';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    const result = {};

    if (type === 'all' || type === 'servers') {
      const servers = await env.DB.prepare('SELECT * FROM transition_servers ORDER BY id').all();
      result.servers = servers.results || [];
    }

    if (type === 'all' || type === 'creators') {
      const creators = await env.DB.prepare('SELECT * FROM transition_creators ORDER BY id').all();
      result.creators = creators.results || [];
    }

    if (type === 'all' || type === 'timeline') {
      const timeline = await env.DB.prepare('SELECT * FROM transition_timeline ORDER BY date DESC, id DESC').all();
      result.timeline = timeline.results || [];
    }

    // Summary stats
    if (type === 'all') {
      result.summary = {
        totalServers: (result.servers || []).length,
        totalCreators: (result.creators || []).length,
        timelineEvents: (result.timeline || []).length,
      };
    }

    return new Response(JSON.stringify(result), { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers,
    });
  }
}

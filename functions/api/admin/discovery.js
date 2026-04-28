// GET /api/admin/discovery — list pending creators
// POST /api/admin/discovery — approve or reject a pending creator
// Query params for GET: status=pending (default), sort=count|viewers|recent
// Auth: Bearer token from ADMIN_TOKEN env var

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const sort = url.searchParams.get('sort') || 'count';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let orderBy;
  let whereExtra = '';
  switch (sort) {
    case 'viewers': orderBy = 'discovered_viewers DESC'; break;
    case 'recent': orderBy = 'last_seen DESC'; break;
    case 'recommended':
      // Raid/host targets only, ranked by distinct sources then by
      // discovery_count then by recency. The distinct-source count is
      // computed in JS below since SQLite has no JSON_ARRAY_LENGTH
      // function in the json1 build D1 ships.
      whereExtra = "AND source IN ('raid', 'host')";
      orderBy = 'discovery_count DESC, last_seen DESC';
      break;
    case 'count': default: orderBy = 'discovery_count DESC, discovered_viewers DESC'; break;
  }

  try {
    const result = await env.DB.prepare(`
      SELECT * FROM pending_creators
      WHERE status = ? ${whereExtra}
      ORDER BY ${orderBy}
      LIMIT ?
    `).bind(status, limit).all();

    const pending = (result.results || []).map(row => {
      let raidSources = [];
      try { raidSources = JSON.parse(row.raid_sources || '[]'); } catch { raidSources = []; }
      return {
        ...row,
        discovered_tags: JSON.parse(row.discovered_tags || '[]'),
        raid_sources: raidSources,
        raid_source_count: raidSources.length,
      };
    });

    // For ?sort=recommended, re-rank by distinct source count.
    if (sort === 'recommended') {
      pending.sort((a, b) => {
        if (b.raid_source_count !== a.raid_source_count) return b.raid_source_count - a.raid_source_count;
        if (b.discovery_count !== a.discovery_count) return b.discovery_count - a.discovery_count;
        return (b.last_seen || '').localeCompare(a.last_seen || '');
      });
    }

    // Get counts by status
    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) as count FROM pending_creators GROUP BY status
    `).all();
    const statusCounts = {};
    for (const row of (counts.results || [])) {
      statusCounts[row.status] = row.count;
    }

    return new Response(JSON.stringify({
      creators: pending,
      total: pending.length,
      statusCounts,
      filter: { status, sort, limit },
    }), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { id, action, notes } = body;

    if (!id || !action) {
      return new Response(JSON.stringify({ error: 'id and action required' }), {
        status: 400, headers: corsHeaders(),
      });
    }

    if (!['approve', 'reject', 'watch', 'reset'].includes(action)) {
      return new Response(JSON.stringify({ error: 'action must be: approve, reject, watch, or reset' }), {
        status: 400, headers: corsHeaders(),
      });
    }

    // Get the pending creator
    const pending = await env.DB.prepare(
      'SELECT * FROM pending_creators WHERE id = ?'
    ).bind(id).first();

    if (!pending) {
      return new Response(JSON.stringify({ error: 'Pending creator not found' }), {
        status: 404, headers: corsHeaders(),
      });
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      const platform = (pending.platform || 'twitch').toLowerCase();
      const handle = pending.name.toLowerCase();
      const creatorId = `${platform}-${handle}`;
      const nowSec = Math.floor(Date.now() / 1000);

      // Check if already in creators table (by constructed id or by handle)
      const existingCreator = await env.DB.prepare(
        'SELECT id FROM creators WHERE id = ? OR LOWER(display_name) = ?'
      ).bind(creatorId, handle).first();

      if (existingCreator) {
        // Already exists — just update pending status
        await env.DB.prepare(
          'UPDATE pending_creators SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?'
        ).bind('approved', now, notes || 'Already existed in creators table', id).run();

        return new Response(JSON.stringify({
          success: true,
          action: 'approved',
          note: 'Creator already exists in main table',
          creator_id: existingCreator.id,
        }), { headers: corsHeaders() });
      }

      // Insert new creator (real schema: id, display_name, role, avatar_url, created_at, updated_at)
      await env.DB.prepare(`
        INSERT INTO creators (id, display_name, role, avatar_url, created_at, updated_at)
        VALUES (?, ?, 'creator', ?, ?, ?)
      `).bind(
        creatorId,
        pending.name,
        pending.profile_image || null,
        nowSec,
        nowSec
      ).run();

      // Insert into creator_platforms (real schema: creator_id, platform, handle, is_primary)
      await env.DB.prepare(`
        INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary)
        VALUES (?, ?, ?, 1)
      `).bind(creatorId, platform, handle).run();

      // Update pending status
      await env.DB.prepare(
        'UPDATE pending_creators SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?'
      ).bind('approved', now, notes || null, id).run();

      return new Response(JSON.stringify({
        success: true,
        action: 'approved',
        creator_id: creatorId,
        name: pending.name,
      }), { status: 200, headers: corsHeaders() });

    } else if (action === 'reject') {
      await env.DB.prepare(
        'UPDATE pending_creators SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?'
      ).bind('rejected', now, notes || null, id).run();

      return new Response(JSON.stringify({
        success: true, action: 'rejected', name: pending.name,
      }), { headers: corsHeaders() });

    } else if (action === 'watch') {
      // "Watch" — keep monitoring but don't approve yet
      await env.DB.prepare(
        'UPDATE pending_creators SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?'
      ).bind('watched', now, notes || null, id).run();

      return new Response(JSON.stringify({
        success: true, action: 'watched', name: pending.name,
      }), { headers: corsHeaders() });

    } else if (action === 'reset') {
      await env.DB.prepare(
        'UPDATE pending_creators SET status = ?, reviewed_at = NULL, notes = NULL WHERE id = ?'
      ).bind('pending', id).run();

      return new Response(JSON.stringify({
        success: true, action: 'reset', name: pending.name,
      }), { headers: corsHeaders() });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

// Bulk actions
export async function onRequestPut(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { ids, action, notes } = body;

    if (!ids || !Array.isArray(ids) || !action) {
      return new Response(JSON.stringify({ error: 'ids (array) and action required' }), {
        status: 400, headers: corsHeaders(),
      });
    }

    if (!['reject', 'reset'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Bulk action supports: reject, reset' }), {
        status: 400, headers: corsHeaders(),
      });
    }

    const now = new Date().toISOString();
    const newStatus = action === 'reject' ? 'rejected' : 'pending';
    const batch = ids.map(id =>
      env.DB.prepare(
        'UPDATE pending_creators SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?'
      ).bind(newStatus, action === 'reset' ? null : now, notes || null, id)
    );

    for (let i = 0; i < batch.length; i += 25) {
      await env.DB.batch(batch.slice(i, i + 25));
    }

    return new Response(JSON.stringify({
      success: true, action, count: ids.length,
    }), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

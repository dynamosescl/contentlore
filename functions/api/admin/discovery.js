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
  switch (sort) {
    case 'viewers': orderBy = 'discovered_viewers DESC'; break;
    case 'recent': orderBy = 'last_seen DESC'; break;
    case 'count': default: orderBy = 'discovery_count DESC, discovered_viewers DESC'; break;
  }

  try {
    const result = await env.DB.prepare(`
      SELECT * FROM pending_creators
      WHERE status = ?
      ORDER BY ${orderBy}
      LIMIT ?
    `).bind(status, limit).all();

    const pending = (result.results || []).map(row => ({
      ...row,
      discovered_tags: JSON.parse(row.discovered_tags || '[]'),
    }));

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
      // Insert into creators table
      const existingCreator = await env.DB.prepare(
        'SELECT id FROM creators WHERE LOWER(creator_name) = ?'
      ).bind(pending.name.toLowerCase()).first();

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

      // Insert new creator
      const insertResult = await env.DB.prepare(`
        INSERT INTO creators (creator_name, primary_platform, twitch_username, status, created_at)
        VALUES (?, ?, ?, 'active', ?)
      `).bind(
        pending.name,
        pending.platform || 'twitch',
        pending.platform === 'twitch' ? pending.name : null,
        now
      ).run();

      const creatorId = insertResult.meta.last_row_id;

      // Insert into creator_platforms if channel_id available
      if (pending.channel_id) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO creator_platforms (creator_name, platform, platform_id, username)
          VALUES (?, ?, ?, ?)
        `).bind(
          pending.name,
          pending.platform || 'twitch',
          pending.channel_id,
          pending.name
        ).run();
      }

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

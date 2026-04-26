// POST /api/admin/beef — Create or update a beef
// DELETE /api/admin/beef?id=N — Delete a beef
// Auth: Bearer token from ADMIN_TOKEN env var

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: corsHeaders(),
    });
  }
  return null;
}

function validate(body) {
  const errors = [];
  if (!body.title || typeof body.title !== 'string' || body.title.trim().length < 2) {
    errors.push('title is required (min 2 chars)');
  }
  if (body.heat !== undefined && (typeof body.heat !== 'number' || body.heat < 1 || body.heat > 10)) {
    errors.push('heat must be a number between 1 and 10');
  }
  const validStatuses = ['active', 'cooling', 'resolved', 'legendary'];
  if (body.status && !validStatuses.includes(body.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }
  if (body.side_a && !Array.isArray(body.side_a)) errors.push('side_a must be an array');
  if (body.side_b && !Array.isArray(body.side_b)) errors.push('side_b must be an array');
  if (body.beats && !Array.isArray(body.beats)) errors.push('beats must be an array');
  return errors;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const body = await request.json();
    const errors = validate(body);
    if (errors.length) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const slug = body.slug || slugify(body.title);
    const now = new Date().toISOString();

    // Check for existing slug
    const existing = await env.DB.prepare('SELECT id FROM beefs WHERE slug = ?').bind(slug).first();

    if (body.id || existing) {
      // UPDATE mode
      const id = body.id || existing.id;
      await env.DB.prepare(`
        UPDATE beefs SET
          title = ?,
          slug = ?,
          server = ?,
          status = ?,
          side_a = ?,
          side_b = ?,
          heat = ?,
          description = ?,
          beats = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        body.title.trim(),
        slug,
        body.server || null,
        body.status || 'active',
        JSON.stringify(body.side_a || []),
        JSON.stringify(body.side_b || []),
        body.heat || 5,
        body.description || '',
        JSON.stringify(body.beats || []),
        now,
        id
      ).run();

      return new Response(JSON.stringify({ success: true, action: 'updated', id, slug }), {
        status: 200,
        headers: corsHeaders(),
      });
    } else {
      // CREATE mode
      const result = await env.DB.prepare(`
        INSERT INTO beefs (slug, title, server, status, side_a, side_b, heat, description, beats, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slug,
        body.title.trim(),
        body.server || null,
        body.status || 'active',
        JSON.stringify(body.side_a || []),
        JSON.stringify(body.side_b || []),
        body.heat || 5,
        body.description || '',
        JSON.stringify(body.beats || []),
        now,
        now
      ).run();

      return new Response(JSON.stringify({ success: true, action: 'created', id: result.meta.last_row_id, slug }), {
        status: 201,
        headers: corsHeaders(),
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error', message: err.message }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const slug = url.searchParams.get('slug');

    if (!id && !slug) {
      return new Response(JSON.stringify({ error: 'Provide id or slug query param' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    let result;
    if (id) {
      result = await env.DB.prepare('DELETE FROM beefs WHERE id = ?').bind(parseInt(id)).run();
    } else {
      result = await env.DB.prepare('DELETE FROM beefs WHERE slug = ?').bind(slug).run();
    }

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Beef not found' }), {
        status: 404,
        headers: corsHeaders(),
      });
    }

    return new Response(JSON.stringify({ success: true, action: 'deleted' }), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error', message: err.message }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}

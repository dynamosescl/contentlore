// POST /api/admin/lore — Create or update a lore arc
// DELETE /api/admin/lore?id=N — Delete a lore arc
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
  const validKinds = ['gang-war', 'heist', 'political', 'romance', 'comedy', 'rivalry', 'betrayal', 'redemption', 'origin', 'territory', 'other'];
  if (body.kind && !validKinds.includes(body.kind)) {
    errors.push(`kind must be one of: ${validKinds.join(', ')}`);
  }
  const validEras = ['current', 'legacy', 'legendary'];
  if (body.era && !validEras.includes(body.era)) {
    errors.push(`era must be one of: ${validEras.join(', ')}`);
  }
  if (body.weight !== undefined && (typeof body.weight !== 'number' || body.weight < 1 || body.weight > 5)) {
    errors.push('weight must be a number between 1 and 5');
  }
  if (body.chapters && !Array.isArray(body.chapters)) errors.push('chapters must be an array');
  if (body.linked_beefs && !Array.isArray(body.linked_beefs)) errors.push('linked_beefs must be an array');
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

    const existing = await env.DB.prepare('SELECT id FROM lore_arcs WHERE slug = ?').bind(slug).first();

    if (body.id || existing) {
      const id = body.id || existing.id;
      await env.DB.prepare(`
        UPDATE lore_arcs SET
          title = ?,
          slug = ?,
          server = ?,
          kind = ?,
          era = ?,
          weight = ?,
          description = ?,
          chapters = ?,
          linked_beefs = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        body.title.trim(),
        slug,
        body.server || null,
        body.kind || 'other',
        body.era || 'current',
        body.weight || 3,
        body.description || '',
        JSON.stringify(body.chapters || []),
        JSON.stringify(body.linked_beefs || []),
        now,
        id
      ).run();

      return new Response(JSON.stringify({ success: true, action: 'updated', id, slug }), {
        status: 200,
        headers: corsHeaders(),
      });
    } else {
      const result = await env.DB.prepare(`
        INSERT INTO lore_arcs (slug, title, server, kind, era, weight, description, chapters, linked_beefs, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slug,
        body.title.trim(),
        body.server || null,
        body.kind || 'other',
        body.era || 'current',
        body.weight || 3,
        body.description || '',
        JSON.stringify(body.chapters || []),
        JSON.stringify(body.linked_beefs || []),
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
      result = await env.DB.prepare('DELETE FROM lore_arcs WHERE id = ?').bind(parseInt(id)).run();
    } else {
      result = await env.DB.prepare('DELETE FROM lore_arcs WHERE slug = ?').bind(slug).run();
    }

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Lore arc not found' }), {
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

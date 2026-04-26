// GET /api/admin/backfill-avatars — dry run, shows how many need backfill
// POST /api/admin/backfill-avatars — executes backfill
// Auth: Bearer token from ADMIN_TOKEN env var
//
// Fetches Twitch Helix GET /users for creators missing avatar_url,
// then updates D1 with profile_image_url from Twitch.

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

async function getTwitchToken(env) {
  // Try KV cache
  const cached = await env.KV.get('twitch_token');
  if (cached) return cached;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${env.TWITCH_CLIENT_ID}&client_secret=${env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  const data = await res.json();
  if (data.access_token) {
    await env.KV.put('twitch_token', data.access_token, { expirationTtl: (data.expires_in || 3600) - 300 });
    return data.access_token;
  }
  throw new Error('Failed to get Twitch token');
}

async function fetchTwitchUsers(logins, token, clientId) {
  // Twitch allows up to 100 logins per request
  const params = logins.map(l => `login=${encodeURIComponent(l)}`).join('&');
  const res = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitch API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.data || [];
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    // Count creators missing avatars
    const missing = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM creators
      WHERE avatar_url IS NULL
         OR avatar_url = ''
         OR avatar_url LIKE '%previews-ttv%'
    `).first();

    const total = await env.DB.prepare('SELECT COUNT(*) as count FROM creators').first();

    // Count Twitch creators specifically (we can only backfill Twitch)
    const twitchMissing = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM creators
      WHERE (avatar_url IS NULL OR avatar_url = '' OR avatar_url LIKE '%previews-ttv%')
        AND primary_platform = 'twitch'
    `).first();

    return new Response(JSON.stringify({
      total_creators: total.count,
      missing_avatars: missing.count,
      twitch_missing: twitchMissing.count,
      message: 'POST to this endpoint to run the backfill',
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
    const token = await getTwitchToken(env);
    const clientId = env.TWITCH_CLIENT_ID;

    // Get all Twitch creators missing avatars
    const result = await env.DB.prepare(`
      SELECT id, display_name, primary_handle
      FROM creators
      WHERE (avatar_url IS NULL OR avatar_url = '' OR avatar_url LIKE '%previews-ttv%')
        AND primary_platform = 'twitch'
      ORDER BY id
    `).all();

    const creators = result.results || [];

    if (creators.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No creators need avatar backfill',
        updated: 0,
      }), { headers: corsHeaders() });
    }

    let updated = 0;
    let failed = 0;
    const errors = [];

    // Process in batches of 100 (Twitch API limit)
    for (let i = 0; i < creators.length; i += 100) {
      const batch = creators.slice(i, i + 100);
      const logins = batch.map(c =>
        (c.primary_handle || c.display_name || '').toLowerCase()
      ).filter(Boolean);

      if (logins.length === 0) continue;

      try {
        const users = await fetchTwitchUsers(logins, token, clientId);

        // Build lookup by login
        const userMap = {};
        for (const u of users) {
          userMap[u.login.toLowerCase()] = u;
        }

        // Update each creator
        const updateBatch = [];
        for (const creator of batch) {
          const login = (creator.primary_handle || creator.display_name || '').toLowerCase();
          const twitchUser = userMap[login];

          if (twitchUser && twitchUser.profile_image_url) {
            updateBatch.push(
              env.DB.prepare('UPDATE creators SET avatar_url = ? WHERE id = ?')
                .bind(twitchUser.profile_image_url, creator.id)
            );
            updated++;
          } else {
            failed++;
          }
        }

        if (updateBatch.length > 0) {
          // D1 batch limit is ~100 statements
          for (let j = 0; j < updateBatch.length; j += 50) {
            await env.DB.batch(updateBatch.slice(j, j + 50));
          }
        }

        // Small delay between Twitch API calls to avoid rate limits
        if (i + 100 < creators.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (batchErr) {
        errors.push(`Batch ${i}-${i + 100}: ${batchErr.message}`);
        failed += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_processed: creators.length,
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    }), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

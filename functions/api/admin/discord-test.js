// ================================================================
// functions/api/admin/discord-test.js
// GET  /api/admin/discord-test — config status (is DISCORD_WEBHOOK_URL set?)
// POST /api/admin/discord-test — send a test embed to env.DISCORD_WEBHOOK_URL
//
// Bearer-authed via env.ADMIN_TOKEN (same gate as the other admin
// endpoints). The test embed mirrors the shape of the go-live
// notification the scheduler sends, so this is the one-button way
// to verify the webhook URL works before flipping the cron loose.
// ================================================================

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

export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  const url = env.DISCORD_WEBHOOK_URL;
  return new Response(JSON.stringify({
    ok: true,
    configured: !!url,
    masked: url ? maskUrl(url) : null,
  }), { status: 200, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'DISCORD_WEBHOOK_URL is not set on this environment.',
    }), { status: 400, headers: corsHeaders() });
  }

  // Optional override payload from the body (so admins can preview
  // exactly what the scheduler will post).
  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  const payload = body.payload || {
    username: 'ContentLore',
    embeds: [{
      title: '🧪 ContentLore webhook test',
      description: 'If you can read this, the Discord webhook URL is wired up correctly. The scheduler will post a similar embed each time a curated creator goes live.',
      color: 0x44ddee, // electric cyan, roughly oklch(0.82 0.20 195)
      fields: [
        { name: 'Source',    value: '`/api/admin/discord-test`', inline: true },
        { name: 'Triggered', value: new Date().toISOString(),    inline: true },
      ],
      footer: { text: 'ContentLore · UK GTA RP intelligence' },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    const status = res.status;
    const txt = ok ? null : await res.text().catch(() => null);
    return new Response(JSON.stringify({
      ok,
      status,
      error: ok ? null : (txt || `Discord rejected webhook with HTTP ${status}`),
    }), { status: ok ? 200 : 502, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
    }), { status: 500, headers: corsHeaders() });
  }
}

function maskUrl(u) {
  // Return only host + last 6 chars of token slug so admins can confirm
  // which webhook is wired without leaking the secret.
  try {
    const url = new URL(u);
    const tail = url.pathname.split('/').pop() || '';
    return `${url.host}/…/${tail.slice(-6)}`;
  } catch {
    return '(unparseable url)';
  }
}

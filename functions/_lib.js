// ================================================================
// functions/_lib.js
// Shared utilities used across every Function.
// Consulting-grade: defensive, explicit, no magic.
// ================================================================

/**
 * Standard JSON response helper.
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

/**
 * Standard HTML response helper.
 */
export function htmlResponse(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

/**
 * Admin password gate. Returns null if authorised, or a Response if not.
 * Checks the X-Admin-Password header against env.ADMIN_PASSWORD.
 */
export function requireAdminAuth(request, env) {
  const provided = request.headers.get('x-admin-password');
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return jsonResponse({ error: 'Admin password not configured' }, 500);
  }
  if (!provided || provided !== expected) {
    return jsonResponse({ error: 'Unauthorised' }, 401);
  }
  return null;
}

/**
 * Generate a verification code for claim flow.
 * Format: CL-XXXXXX where X is uppercase alphanumeric.
 */
export function generateVerificationCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'CL-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Escape HTML for safe output.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format follower count (1234 -> 1.2K, 1234567 -> 1.2M).
 */
export function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Slugify for URL-safe strings.
 */
export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get Twitch app access token (cached in KV for ~55 min).
 */
export async function getTwitchToken(env) {
  const cached = await env.KV.get('twitch:app_token');
  if (cached) return cached;

  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Twitch credentials not configured');
  }

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch token fetch failed ${res.status}: ${body}`);
  }
  const data = await res.json();
  await env.KV.put('twitch:app_token', data.access_token, {
    expirationTtl: 3300, // 55 min
  });
  return data.access_token;
}

/**
 * Get Kick app access token (cached in KV).
 */
export async function getKickToken(env) {
  const cached = await env.KV.get('kick:app_token');
  if (cached) return cached;

  const clientId = env.KICK_CLIENT_ID;
  const clientSecret = env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Kick credentials not configured');
  }

  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kick token fetch failed ${res.status}: ${body}`);
  }
  const data = await res.json();
  await env.KV.put('kick:app_token', data.access_token, {
    expirationTtl: 3300,
  });
  return data.access_token;
}

/**
 * Fetch Twitch user data by login.
 */
export async function fetchTwitchUser(env, login) {
  const token = await getTwitchToken(env);
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: {
        'client-id': env.TWITCH_CLIENT_ID,
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0] ?? null;
}

/**
 * Fetch Twitch stream data (live status) by user_id.
 */
export async function fetchTwitchStream(env, userId) {
  const token = await getTwitchToken(env);
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(userId)}`,
    {
      headers: {
        'client-id': env.TWITCH_CLIENT_ID,
        authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0] ?? null;
}

/**
 * Fetch a single Kick channel by slug via the official Public API.
 * Returns the channel object (with .stream, .category, .stream_title) or null.
 */
export async function fetchKickChannel(env, slug) {
  try {
    const token = await getKickToken(env);
    const res = await fetch(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

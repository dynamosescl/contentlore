// ================================================================
// functions/api/submit.js
// POST /api/submit — public creator submission form endpoint.
//
// No auth: anyone can submit a candidate channel for review. Rate
// limited to 3 submissions per IP per UTC day via KV (key
// `submit:rl:{ip}:{yyyy-mm-dd}`, TTL ~25h, value = counter).
//
// Submissions land in the existing `pending_creators` table with
// status='pending'. The full multi-platform payload (twitch, kick,
// tiktok, youtube, x, bio, servers, submitter ip) is stored as JSON
// in the `notes` column, prefixed with the literal `SUBMITTED:` so
// the mod panel can filter discovery rows from form submissions
// without a schema change.
// ================================================================

import { jsonResponse } from '../_lib.js';

const MAX_PER_IP_PER_DAY = 3;
const NOTES_PREFIX = 'SUBMITTED:'; // sentinel for /api/admin/submissions filter

const VALID_SERVERS = new Set([
  'unique', 'orbit', 'unmatched', 'new-era', 'prodigy', 'tng',
  'd10', 'verarp', 'endz', 'letsrp', 'drilluk', 'britishlife',
]);

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost({ request, env }) {
  // ----- IP + rate limit -----
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown')
    .split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const rlKey = `submit:rl:${ip}:${day}`;

  let count = 0;
  try {
    const cur = await env.KV.get(rlKey);
    count = cur ? parseInt(cur, 10) || 0 : 0;
  } catch { /* if KV's down, fail open — better than 500 for a public form */ }

  if (count >= MAX_PER_IP_PER_DAY) {
    return jsonResponse({ ok: false, error: 'Rate limit reached. Try again tomorrow.' }, 429);
  }

  // ----- Parse + validate -----
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  // Honeypot — bots fill `hp`, humans don't see it.
  if (body.hp && String(body.hp).trim()) {
    // Pretend success so spam bots don't learn the rule.
    return jsonResponse({ ok: true, id: 'spam-' + Math.random().toString(36).slice(2, 8) }, 200);
  }

  const display_name = sanitiseField(body.display_name, 64);
  if (!display_name) {
    return jsonResponse({ ok: false, error: 'Display name is required.' }, 400);
  }

  const socials = {
    twitch:  sanitiseHandle(body.twitch),
    kick:    sanitiseHandle(body.kick),
    tiktok:  sanitiseHandle(body.tiktok),
    youtube: sanitiseHandle(body.youtube),
    x:       sanitiseHandle(body.x),
  };
  const hasAnyPlatform = Object.values(socials).some(Boolean);
  if (!hasAnyPlatform) {
    return jsonResponse({ ok: false, error: 'At least one platform handle is required.' }, 400);
  }

  const servers = Array.isArray(body.servers)
    ? [...new Set(body.servers.map(s => String(s).toLowerCase()).filter(s => VALID_SERVERS.has(s)))]
    : [];
  const bio = sanitiseField(body.bio, 600);

  // Pick the primary platform — Twitch > Kick > TikTok > YouTube > X.
  // Lines up with how the live API and roster cards order pills.
  const platformOrder = ['twitch', 'kick', 'tiktok', 'youtube', 'x'];
  const primary = platformOrder.find(p => socials[p]) || 'twitch';
  const primaryHandle = socials[primary] || display_name.toLowerCase().replace(/\s+/g, '');

  // Already curated? Reject early so we don't pollute the queue with
  // dupes for the existing 26 — case-insensitive on the primary handle.
  try {
    const dupe = await env.DB.prepare(
      `SELECT 1 FROM creator_platforms WHERE LOWER(handle) = ? LIMIT 1`
    ).bind(primaryHandle.toLowerCase()).first();
    if (dupe) {
      return jsonResponse({ ok: false, error: 'This channel is already tracked.' }, 409);
    }
  } catch { /* not fatal — fall through */ }

  // ----- Build the notes blob (JSON, prefixed with sentinel) -----
  const submission = {
    display_name,
    socials,
    servers,
    bio,
    submitted_at: new Date().toISOString(),
    ip,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 256),
  };
  const notes = NOTES_PREFIX + JSON.stringify(submission);

  // ----- Insert into pending_creators -----
  let row;
  try {
    row = await env.DB.prepare(`
      INSERT INTO pending_creators
        (name, platform, channel_id, discovered_title, discovered_viewers,
         discovered_tags, detected_server, discovery_count, status, notes)
      VALUES (?, ?, NULL, ?, 0, '[]', ?, 0, 'pending', ?)
      ON CONFLICT(name, platform) DO UPDATE SET
        discovered_title = excluded.discovered_title,
        detected_server  = excluded.detected_server,
        notes            = excluded.notes,
        last_seen        = datetime('now'),
        status           = CASE WHEN status IN ('approved','rejected') THEN status ELSE 'pending' END
      RETURNING id
    `).bind(
      display_name,
      primary,
      bio.slice(0, 200),     // discovered_title doubles as preview text
      servers[0] || null,
      notes,
    ).first();
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Database write failed.' }, 500);
  }

  // ----- Bump rate-limit counter (fire-and-forget) -----
  try {
    await env.KV.put(rlKey, String(count + 1), { expirationTtl: 25 * 3600 });
  } catch { /* ignore — over-counting is better than under */ }

  return jsonResponse({ ok: true, id: row?.id || null });
}

function sanitiseField(raw, max) {
  if (raw == null) return '';
  const s = String(raw).trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) : s;
}

function sanitiseHandle(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/.*/, '');
  // Allow alphanumerics, underscore, hyphen, dot. Anything else → reject the field.
  if (!s) return null;
  if (!/^[A-Za-z0-9._-]{1,48}$/.test(s)) return null;
  return s.toLowerCase();
}

// ================================================================
// functions/api/submit-clip.js
// POST /api/submit-clip
//
// Public endpoint — viewers submit clips for moderator approval.
// Rate limit: 5 submissions per IP per UTC day (KV).
//
// Body: { url, creator_handle, description? }
//
// Inserts into clip_submissions with status='pending'. Approved by
// admins via /mod/ → POST /api/admin/clip-submissions.
// ================================================================

import { jsonResponse } from '../_lib.js';
import { getHandlesSet } from '../_curated.js';

const RL_PER_DAY = 5;
const RL_TTL = 25 * 3600;
const URL_MAX = 500;
const DESC_MAX = 280;

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Identify the platform + parse a clip ID from URL.
// Twitch:
//   https://www.twitch.tv/<channel>/clip/<slug>?...
//   https://clips.twitch.tv/<slug>
//   https://m.twitch.tv/clip/<slug>
// Kick:
//   https://kick.com/<channel>/clips/<slug>
//   https://kick.com/<channel>?clip=<slug>
function parseClipUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'twitch.tv') {
    // /<channel>/clip/<slug>
    const m = u.pathname.match(/^\/([\w-]+)\/clip\/([\w-]+)/i);
    if (m) return { platform: 'twitch', channel: m[1].toLowerCase(), clip_id: m[2] };
    // /clip/<slug>
    const m2 = u.pathname.match(/^\/clip\/([\w-]+)/i);
    if (m2) return { platform: 'twitch', channel: null, clip_id: m2[1] };
  }
  if (host === 'clips.twitch.tv') {
    // /<slug> or /embed?clip=<slug>
    const slug = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (slug && slug !== 'embed') return { platform: 'twitch', channel: null, clip_id: slug };
    const cp = u.searchParams.get('clip');
    if (cp) return { platform: 'twitch', channel: null, clip_id: cp };
  }
  if (host === 'kick.com') {
    const m = u.pathname.match(/^\/([\w-]+)\/clips\/([\w-]+)/i);
    if (m) return { platform: 'kick', channel: m[1].toLowerCase(), clip_id: m[2] };
    const cp = u.searchParams.get('clip');
    const ch = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (cp && ch) return { platform: 'kick', channel: ch.toLowerCase(), clip_id: cp };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid_json' }, 400); }

  const url = String(body.url || '').trim();
  const creator = String(body.creator_handle || '').trim().toLowerCase();
  const desc = String(body.description || '').trim().slice(0, DESC_MAX);

  if (!url || url.length > URL_MAX) return jsonResponse({ ok: false, error: 'url_required' }, 400);
  if (!creator) return jsonResponse({ ok: false, error: 'creator_required' }, 400);

  const parsed = parseClipUrl(url);
  if (!parsed) return jsonResponse({ ok: false, error: 'unrecognised_url', hint: 'Use a Twitch or Kick clip link.' }, 400);

  // Verify creator handle is in the curated allowlist.
  const allowed = await getHandlesSet(env);
  if (!allowed.has(creator)) {
    return jsonResponse({ ok: false, error: 'unknown_creator', hint: 'Pick a tracked streamer from the dropdown.' }, 400);
  }

  // Rate limit by IP + UTC day.
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  const today = ymd(new Date());
  const rlKey = `clipsubmit:rl:${ip}:${today}`;
  const used = parseInt((await env.KV.get(rlKey)) || '0', 10) || 0;
  if (used >= RL_PER_DAY) {
    return jsonResponse({ ok: false, error: 'rate_limited', hint: 'Daily submission limit reached — try again tomorrow.' }, 429);
  }

  // De-dupe: same URL already pending or approved? skip insert.
  const dup = await env.DB.prepare(
    `SELECT id, status FROM clip_submissions WHERE url = ? LIMIT 1`
  ).bind(url).first();
  if (dup) {
    return jsonResponse({ ok: false, error: 'duplicate', existing_status: dup.status }, 409);
  }

  const ua = (request.headers.get('user-agent') || '').slice(0, 240);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `INSERT INTO clip_submissions
       (url, platform, clip_id, creator_handle, description, submitted_by_ip, user_agent, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    url, parsed.platform, parsed.clip_id || null, creator, desc || null, ip, ua, now
  ).run();

  await env.KV.put(rlKey, String(used + 1), { expirationTtl: RL_TTL });

  return jsonResponse({
    ok: true,
    id: result.meta?.last_row_id || null,
    status: 'pending',
    message: 'Submission received. A moderator will review shortly.',
  });
}

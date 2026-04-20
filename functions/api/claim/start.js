// ================================================================
// functions/api/claim/start.js
// POST /api/claim/start
// Body: { platform, handle, email? }
// Generates a verification code the creator must paste into their
// platform bio. Returns the code and the URL to check.
// ================================================================

import { jsonResponse, generateVerificationCode, slugify } from '../../_lib.js';

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON body required' }, 400);
  }

  const platform = String(body?.platform || '').toLowerCase().trim();
  const handle = String(body?.handle || '').trim();
  const email = body?.email ? String(body.email).trim() : null;

  if (!platform || !['twitch', 'kick'].includes(platform)) {
    return jsonResponse({ error: 'Platform must be twitch or kick' }, 400);
  }
  if (!handle || handle.length < 2 || handle.length > 60) {
    return jsonResponse({ error: 'Handle required (2-60 characters)' }, 400);
  }

  try {
    // Rate limit by IP: max 5 claim attempts per hour
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateKey = `claim:ratelimit:${ip}`;
    const count = parseInt((await env.KV.get(rateKey)) || '0', 10);
    if (count >= 5) {
      return jsonResponse(
        { error: 'Too many claim attempts. Try again in an hour.' },
        429
      );
    }
    await env.KV.put(rateKey, String(count + 1), { expirationTtl: 3600 });

    // Check: is this handle already a verified creator?
    const cleanHandle = slugify(handle);
    const candidateId = platform === 'kick' ? `kick-${cleanHandle}` : cleanHandle;
    const existingCreator = await env.DB
      .prepare(
        `SELECT c.id, cp.verified FROM creators c
         LEFT JOIN creator_platforms cp 
           ON cp.creator_id = c.id AND cp.platform = ? AND cp.handle = ?
         WHERE c.id = ?`
      )
      .bind(platform, handle, candidateId)
      .first();
    if (existingCreator?.verified === 1) {
      return jsonResponse(
        { error: 'This creator is already verified on ContentLore.' },
        409
      );
    }

    // Check: is there already an active claim for this handle?
    const now = Math.floor(Date.now() / 1000);
    const active = await env.DB
      .prepare(
        `SELECT id, verification_code, expires_at FROM claims
         WHERE platform = ? AND handle = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind(platform, handle, now)
      .first();
    if (active) {
      return jsonResponse({
        ok: true,
        verification_code: active.verification_code,
        expires_at: active.expires_at,
        message: 'An active claim already exists for this handle.',
      });
    }

    // Create a new claim
    const code = generateVerificationCode();
    const expiresAt = now + 24 * 3600; // 24 hours

    const insertResult = await env.DB
      .prepare(
        `INSERT INTO claims 
         (verification_code, platform, handle, email, status, ip_address, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(code, platform, handle, email, ip, expiresAt)
      .run();

    return jsonResponse({
      ok: true,
      verification_code: code,
      platform,
      handle,
      expires_at: expiresAt,
      instructions: `Paste this exact string into your ${platform} bio on the platform itself: ${code}. Then come back and click Verify.`,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

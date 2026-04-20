// ================================================================
// functions/api/claim/verify.js
// POST /api/claim/verify
// Body: { verification_code }
// Checks the code appears in the platform bio, then moves the claim
// into the pending_creators queue for admin review.
// ================================================================

import {
  jsonResponse,
  fetchTwitchUser,
  fetchKickChannel,
} from '../../_lib.js';

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON body required' }, 400);
  }

  const code = String(body?.verification_code || '').trim().toUpperCase();
  if (!code || !/^CL-[A-Z0-9]{6}$/.test(code)) {
    return jsonResponse({ error: 'Invalid verification code format' }, 400);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const claim = await env.DB
      .prepare(
        `SELECT * FROM claims 
         WHERE verification_code = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind(code, now)
      .first();
    if (!claim) {
      return jsonResponse(
        { error: 'Claim not found, expired, or already processed.' },
        404
      );
    }

    // Fetch the platform bio live
    let platformBio = null;
    let platformDisplayName = null;
    let platformImage = null;
    let platformFollowers = null;

    if (claim.platform === 'twitch') {
      const user = await fetchTwitchUser(env, claim.handle);
      if (!user) {
        return jsonResponse(
          { error: `Twitch user @${claim.handle} not found.` },
          404
        );
      }
      platformBio = user.description || '';
      platformDisplayName = user.display_name;
      platformImage = user.profile_image_url;
    } else if (claim.platform === 'kick') {
      const channel = await fetchKickChannel(env, claim.handle);
      if (!channel) {
        return jsonResponse(
          { error: `Kick channel @${claim.handle} not found.` },
          404
        );
      }
      platformBio =
        channel.bio ||
        channel.user?.bio ||
        channel.channel_description ||
        channel.user?.profile_pic ||
        '';
      platformDisplayName = channel.user?.username || channel.slug || claim.handle;
      platformImage = channel.user?.profile_pic || channel.banner_image?.url;
      platformFollowers = channel.followers_count ?? channel.followersCount ?? null;
    }

    if (!platformBio || !platformBio.toUpperCase().includes(code)) {
      return jsonResponse(
        {
          ok: false,
          error: `Verification code not found in your ${claim.platform} bio. Paste "${code}" into the bio and try again. You can remove it after approval.`,
        },
        400
      );
    }

    // Verified. Mark the claim and push into pending_creators.
    await env.DB
      .prepare(
        `UPDATE claims SET status = 'verified', verified_at = unixepoch() WHERE id = ?`
      )
      .bind(claim.id)
      .run();

    // Insert into pending_creators for admin review
    await env.DB
      .prepare(
        `INSERT INTO pending_creators 
         (source, platform, handle, display_name, bio, profile_image, followers, 
          email, verified, discovery_reason, status)
         VALUES ('self_claim', ?, ?, ?, ?, ?, ?, ?, 1, 'self_claim verified', 'pending')`
      )
      .bind(
        claim.platform,
        claim.handle,
        platformDisplayName || claim.handle,
        platformBio.substring(0, 500),
        platformImage,
        platformFollowers,
        claim.email
      )
      .run();

    return jsonResponse({
      ok: true,
      verified: true,
      platform: claim.platform,
      handle: claim.handle,
      display_name: platformDisplayName,
      message:
        'Verified. Your profile is now pending editorial review. You can remove the code from your bio. You will hear from us soon.',
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

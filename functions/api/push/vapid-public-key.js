// GET /api/push/vapid-public-key
//
// Hands the client the VAPID public key (base64url, raw 65-byte
// uncompressed P-256 point) so it can call
// PushManager.subscribe({ applicationServerKey: ... }). The matching
// VAPID_PRIVATE_KEY lives only on the scheduler (which signs and
// sends pushes); the Pages side never needs the private half.

import { jsonResponse } from '../../_lib.js';

export async function onRequestGet({ env }) {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) {
    return jsonResponse({ ok: false, error: 'VAPID_PUBLIC_KEY not configured' }, 503);
  }
  return jsonResponse({ ok: true, key }, 200, {
    'cache-control': 'public, max-age=3600',
  });
}

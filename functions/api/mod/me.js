// ================================================================
// functions/api/mod/me.js
// GET /api/mod/me
//
// Bearer mod token. Returns the authenticated mod's public profile —
// the same shape as /api/mod/login but read-only and idempotent. Used
// by the dashboard to refresh stale localStorage profile data.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, publicMod } from '../../_mod-auth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  return jsonResponse({ ok: true, mod: publicMod(auth.mod) });
}

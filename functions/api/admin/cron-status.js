// ================================================================
// functions/api/admin/cron-status.js
// GET /api/admin/cron-status
// Returns the last scheduled run's summary JSON from KV.
// Useful for monitoring: is the cron actually running? What's it doing?
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../_lib.js';

export async function onRequestGet({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  try {
    const lastRun = await env.KV.get('cron:last-run', 'json');
    const cursor = await env.KV.get('cron:live-scan:cursor');

    return jsonResponse({
      ok: true,
      last_run: lastRun || null,
      cursor: cursor ? parseInt(cursor, 10) : 0,
      note: lastRun
        ? `Last ran at ${lastRun.started_at}`
        : 'No run recorded yet. Wait up to 15 minutes after deploying the cron config.',
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/admin/backfill-avatars.js
// GET  /api/admin/backfill-avatars  — dry run (counts) + Twitch token health check
// POST /api/admin/backfill-avatars  — runs the backfill against the curated list
//
// Auth: Bearer ADMIN_TOKEN.
//
// Now scoped to the curated allowlist (read from D1 via _curated.js)
// instead of the entire 7,790-row creators table — the legacy long-tail
// rows are unreachable from the UI and don't need avatars.
//
// Twitch: batched /helix/users call, single round-trip for all
//   curated handles with a `socials.twitch` value.
// Kick: reads from the existing `kick:avatar:{slug}` KV cache (warmed
//   by /api/uk-rp-live whenever a Kick broadcaster is live). The
//   Kick /public/v1/channels endpoint doesn't include profile pics,
//   so we can't fetch them on demand — the KV cache is the only path.
//
// Writes go to `creators.avatar_url` keyed by creator_id resolved
// through `creator_platforms.handle`. The 26 curated creators all
// have rows in `creators` + `creator_platforms` per migration 010.
// ================================================================

import { getTwitchToken } from '../../_lib.js';
import { getCuratedList } from '../../_curated.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
  return null;
}

function jsonResp(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ----------------------------------------------------------------
// GET — dry run + token health check.
// ----------------------------------------------------------------
export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const curated = await getCuratedList(env);
    const handles = curated.map(c => c.handle.toLowerCase());

    let dbRows = [];
    if (handles.length > 0) {
      const placeholders = handles.map(() => '?').join(',');
      const res = await env.DB.prepare(`
        SELECT c.id, c.avatar_url, LOWER(cp.handle) AS handle
        FROM creators c
        INNER JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE LOWER(cp.handle) IN (${placeholders})
      `).bind(...handles).all();
      dbRows = res.results || [];
    }

    const missing = dbRows.filter(r =>
      !r.avatar_url || r.avatar_url === '' || /previews-ttv/.test(r.avatar_url)
    ).length;

    let tokenTest = 'not tested';
    try {
      if (env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) {
        await getTwitchToken(env);
        tokenTest = 'OK';
      } else {
        tokenTest = `Missing: client_id=${!!env.TWITCH_CLIENT_ID}, client_secret=${!!env.TWITCH_CLIENT_SECRET}`;
      }
    } catch (e) {
      tokenTest = 'ERROR: ' + e.message;
    }

    return jsonResp({
      ok: true,
      scope: 'curated_creators',
      curated_count: curated.length,
      curated_with_db_row: dbRows.length,
      missing_avatars: missing,
      twitch_token_test: tokenTest,
      message: 'POST to run the backfill against the curated allowlist',
      // Legacy alias kept so the mod-panel auth probe (which only
      // checks res.ok) keeps working.
      total_creators: curated.length,
    });
  } catch (err) {
    return jsonResp({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ----------------------------------------------------------------
// POST — perform the backfill.
// ----------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const curated = await getCuratedList(env);
    const handles = curated.map(c => c.handle.toLowerCase());
    if (handles.length === 0) {
      return jsonResp({ ok: true, message: 'Curated list empty — nothing to do', updated: 0 });
    }

    // Resolve curated handles → creator_id via creator_platforms.
    const placeholders = handles.map(() => '?').join(',');
    const idRes = await env.DB.prepare(`
      SELECT c.id, c.display_name, c.avatar_url, LOWER(cp.handle) AS handle, cp.platform
      FROM creators c
      INNER JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE LOWER(cp.handle) IN (${placeholders})
    `).bind(...handles).all();
    const dbByHandle = new Map();
    for (const r of (idRes.results || [])) dbByHandle.set(r.handle, r);

    const summary = {
      ok: true,
      scope: 'curated_creators',
      curated_count: curated.length,
      twitch: { attempted: 0, updated: 0, no_change: 0, no_twitch_response: [] },
      kick:   { attempted: 0, updated: 0, no_change: 0, no_kv_cache: [] },
      missing_db_row: [],
      errors: [],
    };

    // ----- Twitch -----
    const twitchTargets = curated
      .filter(c => c.socials?.twitch)
      .map(c => ({ curatedHandle: c.handle, twitchHandle: String(c.socials.twitch).toLowerCase() }));
    summary.twitch.attempted = twitchTargets.length;

    if (twitchTargets.length > 0) {
      try {
        const token = await getTwitchToken(env);
        const params = twitchTargets.map(t => `login=${encodeURIComponent(t.twitchHandle)}`).join('&');
        const res = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
          headers: { 'Client-ID': env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('helix/users ' + res.status + ': ' + (await res.text()).slice(0, 200));
        const data = await res.json();
        const byLogin = {};
        for (const u of (data.data || [])) byLogin[u.login.toLowerCase()] = u;

        const updates = [];
        for (const t of twitchTargets) {
          const u = byLogin[t.twitchHandle];
          if (!u || !u.profile_image_url) {
            summary.twitch.no_twitch_response.push(t.curatedHandle);
            continue;
          }
          const dbRow = dbByHandle.get(t.curatedHandle);
          if (!dbRow) {
            summary.missing_db_row.push(t.curatedHandle);
            continue;
          }
          if (dbRow.avatar_url === u.profile_image_url) {
            summary.twitch.no_change++;
            continue;
          }
          updates.push(
            env.DB.prepare('UPDATE creators SET avatar_url = ? WHERE id = ?')
              .bind(u.profile_image_url, dbRow.id)
          );
          summary.twitch.updated++;
        }
        for (let i = 0; i < updates.length; i += 50) {
          await env.DB.batch(updates.slice(i, i + 50));
        }
      } catch (e) {
        summary.errors.push('twitch: ' + (e.message || String(e)));
      }
    }

    // ----- Kick -----
    // Source: `kick:avatar:{slug}` KV cache, warmed by /api/uk-rp-live
    // whenever a Kick broadcaster appears in /public/v1/livestreams.
    // Kick's /public/v1/channels endpoint does not include profile
    // pictures, so this is the only practical source for offline
    // creators.
    const kickTargets = curated
      .filter(c => c.socials?.kick)
      .map(c => ({ curatedHandle: c.handle, kickHandle: String(c.socials.kick).toLowerCase() }));
    summary.kick.attempted = kickTargets.length;

    if (kickTargets.length > 0) {
      try {
        const updates = [];
        for (const k of kickTargets) {
          const cached = await env.KV.get(`kick:avatar:${k.kickHandle}`);
          if (!cached) {
            summary.kick.no_kv_cache.push(k.curatedHandle);
            continue;
          }
          const dbRow = dbByHandle.get(k.curatedHandle);
          if (!dbRow) {
            summary.missing_db_row.push(k.curatedHandle);
            continue;
          }
          if (dbRow.avatar_url === cached) {
            summary.kick.no_change++;
            continue;
          }
          updates.push(
            env.DB.prepare('UPDATE creators SET avatar_url = ? WHERE id = ?')
              .bind(cached, dbRow.id)
          );
          summary.kick.updated++;
        }
        for (let i = 0; i < updates.length; i += 50) {
          await env.DB.batch(updates.slice(i, i + 50));
        }
      } catch (e) {
        summary.errors.push('kick: ' + (e.message || String(e)));
      }
    }

    return jsonResp(summary);
  } catch (err) {
    return jsonResp({ ok: false, error: String(err?.message || err) }, 500);
  }
}

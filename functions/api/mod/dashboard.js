// ================================================================
// functions/api/mod/dashboard.js
// GET /api/mod/dashboard
//
// Bundles everything the moderator dashboard needs into one shot:
//   - Authenticated mod profile (status, level, XP, creators_modded)
//   - One per creators_modded entry: live state, 7-day-average vs
//     current viewers, same-server peers (other tracked creators
//     currently live on the same RP server), recent clips
//   - Scene-wide context (total live, total viewers, hype band)
//   - Contribution summary (recent activity + by-type counts +
//     next-level progress)
//
// Bearer mod token. Everything else is server-side; the page just
// renders the JSON.
// ================================================================

import { jsonResponse } from '../../_lib.js';
import { requireMod, levelForXp, LEVELS, XP_FOR } from '../../_mod-auth.js';
import { getCuratedEntry } from '../../_curated.js';

// Mirror of SERVERS from /api/scene-health (and creator-profile).
// Keep in sync — same table the rest of the codebase uses.
const SERVERS = [
  { id: 'unique',      name: 'Unique RP',      keywords: ['unique rp', 'uniquerp', 'unique'] },
  { id: 'tng',         name: 'TNG RP',         keywords: ['tng rp', 'tngrp', 'tng'] },
  { id: 'orbit',       name: 'Orbit RP',       keywords: ['orbit rp', 'orbitrp', 'orbit'] },
  { id: 'new-era',     name: 'New Era RP',     keywords: ['new era rp', 'newera rp', 'new era', 'newera'] },
  { id: 'prodigy',     name: 'Prodigy RP',     keywords: ['prodigy rp', 'prodigyrp', 'prodigy'] },
  { id: 'd10',         name: 'D10 RP',         keywords: ['d10 rp', 'd10rp', 'd10'] },
  { id: 'unmatched',   name: 'Unmatched RP',   keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'] },
  { id: 'chase',       name: 'Chase RP',       keywords: ['chase rp', 'chaserp'] },
  { id: 'verarp',      name: 'VeraRP',         keywords: ['vera rp', 'verarp', 'vera'] },
  { id: 'endz',        name: 'The Ends RP',    keywords: ['the ends', 'theends', 'ends rp', 'theendsrp', 'the endz', 'endz rp', 'endz'] },
  { id: 'letsrp',      name: "Let's RP",       keywords: ["let's rp", 'letsrp', 'lets rp'] },
  { id: 'drilluk',     name: 'Drill UK',       keywords: ['drill uk', 'drilluk', 'drill rp'] },
  { id: 'britishlife', name: 'British Life',   keywords: ['british life', 'britishlife'] },
  { id: '9kings',      name: '9 Kings RP',     keywords: ['9 kings rp', '9kings rp', '9kingsrp', 'ninekings', '9 kings', '9kings'] },
];
const SERVERS_SORTED = [...SERVERS].sort((a, b) =>
  Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
);
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const s of SERVERS_SORTED) for (const kw of s.keywords) if (t.includes(kw)) return s;
  return null;
}

export async function onRequestGet({ request, env }) {
  const auth = await requireMod(request, env);
  if (auth.error) return auth.error;
  const mod = auth.mod;

  const baseUrl = new URL(request.url).origin;

  // Pull live state + hype + clips in parallel.
  const [liveRes, hypeRes, clipsRes] = await Promise.allSettled([
    fetch(baseUrl + '/api/uk-rp-live', { headers: { 'cf-pages-internal': '1' } }).then(r => r.json()),
    fetch(baseUrl + '/api/hype').then(r => r.json()),
    fetch(baseUrl + '/api/clips?range=24h').then(r => r.json()),
  ]);
  const live = liveRes.status === 'fulfilled' ? liveRes.value : null;
  const hype = hypeRes.status === 'fulfilled' ? hypeRes.value : null;
  const clipsResp = clipsRes.status === 'fulfilled' ? clipsRes.value : null;

  const liveAll = (live?.live || []).filter(c => c.is_live);
  const liveByHandle = new Map(liveAll.map(c => [c.handle, c]));

  // 7-day rolling average of avg_viewers per modded creator. One D1
  // query covers all of them at once.
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  let avgByHandle = new Map();
  if (mod.creators_modded.length) {
    const placeholders = mod.creators_modded.map(() => '?').join(',');
    const avgRes = await env.DB.prepare(`
      SELECT cp.handle,
             AVG(ss.avg_viewers) AS avg_v,
             SUM(ss.duration_mins) AS total_mins
        FROM stream_sessions ss
        INNER JOIN creator_platforms cp ON cp.creator_id = ss.creator_id
       WHERE cp.handle IN (${placeholders})
         AND ss.started_at >= ?
       GROUP BY cp.handle
    `).bind(...mod.creators_modded, since).all();
    for (const r of (avgRes.results || [])) {
      avgByHandle.set(String(r.handle).toLowerCase(), {
        avg_viewers: Math.round(Number(r.avg_v || 0)),
        total_mins: Number(r.total_mins || 0),
      });
    }
  }

  // Build per-creator sections.
  const creators = [];
  for (const handle of mod.creators_modded) {
    const entry = await getCuratedEntry(env, handle);
    if (!entry) continue;
    const liveData = liveByHandle.get(handle) || null;
    const avgRow = avgByHandle.get(handle);

    const detectedServer = liveData?.is_live ? detectServer(liveData.stream_title) : null;
    const samePeers = liveData?.is_live && detectedServer
      ? liveAll
          .filter(c => c.handle !== handle && detectServer(c.stream_title)?.id === detectedServer.id)
          .map(c => ({
            handle: c.handle,
            display_name: c.display_name,
            platform: c.platform,
            viewers: c.viewers || 0,
          }))
          .sort((a, b) => b.viewers - a.viewers)
      : [];

    const myClips = (clipsResp?.clips || [])
      .filter(c => String(c.creator_handle).toLowerCase() === handle)
      .slice(0, 6);

    let viewersVsAvgPct = null;
    if (liveData?.is_live && avgRow?.avg_viewers > 0) {
      viewersVsAvgPct = Math.round(((liveData.viewers - avgRow.avg_viewers) / avgRow.avg_viewers) * 100);
    }

    creators.push({
      handle,
      display_name: entry.display_name || liveData?.display_name || handle,
      platform: entry.platform,
      avatar_url: liveData?.avatar_url || null,
      profile_url: liveData?.profile_url || (entry.platform === 'kick' ? `https://kick.com/${handle}` : `https://twitch.tv/${handle}`),
      is_live: !!liveData?.is_live,
      stream_title: liveData?.stream_title || null,
      viewers: liveData?.viewers || 0,
      game_name: liveData?.game_name || null,
      uptime_mins: liveData?.uptime_mins || 0,
      thumbnail_url: liveData?.thumbnail_url || null,
      embed_url: liveData?.embed_url || null,
      avg_viewers_7d: avgRow?.avg_viewers || 0,
      total_mins_7d: avgRow?.total_mins || 0,
      viewers_vs_avg_pct: viewersVsAvgPct,
      detected_server: detectedServer ? { id: detectedServer.id, name: detectedServer.name } : null,
      same_server_peers: samePeers,
      recent_clips: myClips,
    });
  }

  // Scene context — totals across all currently-live curated creators.
  const totalViewers = liveAll.reduce((s, c) => s + (c.viewers || 0), 0);
  const scene = {
    total_live: liveAll.length,
    total_viewers: totalViewers,
    hype: hype?.ok ? hype : null,
  };

  // Contributions: recent activity + by-type counts.
  const contribRes = await env.DB.prepare(`
    SELECT id, type, target_id, xp_earned, created_at
      FROM mod_contributions
     WHERE mod_id = ?
     ORDER BY created_at DESC
     LIMIT 50
  `).bind(mod.id).all();
  const recent = (contribRes.results || []).map(r => ({
    id: r.id,
    type: r.type,
    target_id: r.target_id,
    xp_earned: Number(r.xp_earned || 0),
    created_at: Number(r.created_at || 0),
  }));
  const byType = {};
  for (const c of recent) byType[c.type] = (byType[c.type] || 0) + 1;

  // Level progress toward next.
  const idx = LEVELS.findIndex(l => l.id === mod.level);
  const nextLvl = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  const curLvl = LEVELS[idx] || LEVELS[0];
  const progressPct = nextLvl
    ? Math.min(100, Math.round(((mod.xp - curLvl.min) / (nextLvl.min - curLvl.min)) * 100))
    : 100;

  return jsonResponse({
    ok: true,
    mod: {
      id: mod.id,
      display_name: mod.display_name,
      twitch_handle: mod.twitch_handle,
      kick_handle: mod.kick_handle,
      creators_modded: mod.creators_modded,
      xp: mod.xp,
      level: mod.level,
      status: mod.status,
    },
    creators,
    scene,
    contributions: {
      total_xp: mod.xp,
      level: mod.level,
      level_label: levelForXp(mod.xp).label,
      next_level: nextLvl,
      progress_pct: progressPct,
      xp_for: XP_FOR,
      recent,
      by_type: byType,
    },
    generated_at: new Date().toISOString(),
  });
}

// ================================================================
// functions/api/scenes.js
// GET /api/scenes
//
// The core differentiator. Takes live stream data and groups it by:
//   1. Server (detected from title keywords)
//   2. Scene type (chase, court, raid, shootout, etc.)
//   3. Fallback: top-viewers grouping
//
// Returns structured scene groups with auto-selection ranking.
// Pure logic — no external dependencies beyond the live-now data.
// ================================================================

import { jsonResponse } from '../_lib.js';

// ── UK server registry ──────────────────────────────────────────
const SERVERS = [
  {
    id: 'orbit-rp',
    name: 'Orbit RP',
    keywords: ['orbit', 'orbitrp', 'orbit rp'],
    vibe: 'serious',
    colour: '#D4A574',
  },
  {
    id: 'new-era-rp',
    name: 'New Era RP',
    keywords: ['new era', 'newera', 'nerp', 'new era rp', 'newerarp'],
    vibe: 'serious',
    colour: '#5D8FB8',
  },
  {
    id: 'prodigy-rp',
    name: 'Prodigy RP',
    keywords: ['prodigy', 'prodigyrp', 'prodigy rp'],
    vibe: 'serious',
    colour: '#4A9B8F',
  },
  {
    id: 'd10-rp',
    name: 'D10 RP',
    keywords: ['d10', 'district 10', 'district10', 'd10 rp'],
    vibe: 'action',
    colour: '#C46A57',
  },
  {
    id: 'unique-rp',
    name: 'Unique RP',
    keywords: ['unique', 'uniquerp', 'unique rp'],
    vibe: 'casual',
    colour: '#6B5A8F',
  },
  {
    id: 'tng-rp',
    name: 'TNG RP',
    keywords: ['tng', 'tngrp', 'tng rp'],
    vibe: 'serious',
    colour: '#8B6D47',
  },
  {
    id: 'unmatched-rp',
    name: 'Unmatched RP',
    keywords: ['unmatched', 'unmatchedrp', 'unmatched rp'],
    vibe: 'emerging',
    colour: '#6B8F73',
  },
  {
    id: 'vera-rp',
    name: 'VeraRP',
    keywords: ['vera', 'verarp', 'vera rp'],
    vibe: 'serious',
    colour: '#C0C0B8',
  },
  {
    id: 'endz-rp',
    name: 'The EndZ',
    keywords: ['endz', 'the endz', 'theendz'],
    vibe: 'action',
    colour: '#B64545',
  },
  {
    id: 'letsrp',
    name: "Let's RP",
    keywords: ['letsrp', "let's rp", 'lets rp'],
    vibe: 'serious',
    colour: '#5D8FB8',
  },
  {
    id: 'drill-uk',
    name: 'Drill UK RP',
    keywords: ['drill uk', 'drilluk', 'drill uk rp'],
    vibe: 'themed',
    colour: '#C46A57',
  },
  {
    id: 'british-life',
    name: 'British Life RP',
    keywords: ['british life', 'britishlife', 'blrp', 'british life rp'],
    vibe: 'casual',
    colour: '#6B8F73',
  },
];

// ── Scene keyword detection ─────────────────────────────────────
const SCENE_TYPES = [
  { id: 'chase',    label: 'Chase',       keywords: ['chase', 'pursuit', 'fleeing', 'evading', 'running from'] },
  { id: 'shootout', label: 'Shootout',    keywords: ['shootout', 'shoot out', 'shots fired', 'gunfight', 'shooting', 'war'] },
  { id: 'court',    label: 'Court',       keywords: ['court', 'trial', 'judge', 'verdict', 'lawyer', 'courtroom', 'prosecution'] },
  { id: 'raid',     label: 'Raid',        keywords: ['raid', 'raiding', 'search warrant'] },
  { id: 'robbery',  label: 'Robbery',     keywords: ['robbery', 'heist', 'bank job', 'robbing', 'jewellery store', 'fleeca'] },
  { id: 'kidnap',   label: 'Kidnap',      keywords: ['kidnap', 'hostage', 'ransom', 'taken'] },
  { id: 'race',     label: 'Race',        keywords: ['race', 'racing', 'drift', 'street race', 'time trial'] },
  { id: 'beef',     label: 'Beef',        keywords: ['beef', 'rivalry', 'opp', 'opps', 'war', 'clashing'] },
  { id: 'pd',       label: 'Police',      keywords: ['pd', 'police', 'lspd', 'bcso', 'officer', 'patrol', 'on duty', 'leo'] },
  { id: 'ems',      label: 'EMS',         keywords: ['ems', 'medic', 'ambulance', 'hospital'] },
  { id: 'gang',     label: 'Gang',        keywords: ['gang', 'crew', 'turf', 'block', 'set', 'hood', 'trap'] },
  { id: 'civ',      label: 'Civilian',    keywords: ['civ', 'civilian', 'job', 'mechanic', 'taxi', 'trucker'] },
];

/**
 * Detect which UK server a stream is on from its title.
 */
function detectServer(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const srv of SERVERS) {
    for (const kw of srv.keywords) {
      if (lower.includes(kw)) return srv;
    }
  }
  return null;
}

/**
 * Detect scene type from stream title.
 */
function detectScene(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const scene of SCENE_TYPES) {
    for (const kw of scene.keywords) {
      if (lower.includes(kw)) return scene;
    }
  }
  return null;
}

/**
 * Group live streams into scene clusters.
 */
function groupStreams(liveStreams) {
  const groups = [];
  const ungrouped = [];

  // Step 1: bucket by server
  const serverBuckets = new Map();
  for (const stream of liveStreams) {
    const server = detectServer(stream.stream_title);
    if (server) {
      if (!serverBuckets.has(server.id)) {
        serverBuckets.set(server.id, { server, streams: [] });
      }
      serverBuckets.get(server.id).streams.push({
        ...stream,
        _server: server,
        _scene: detectScene(stream.stream_title),
      });
    } else {
      ungrouped.push(stream);
    }
  }

  // Step 2: within each server bucket, sub-group by scene
  for (const [serverId, bucket] of serverBuckets) {
    const sceneBuckets = new Map();
    const noScene = [];

    for (const stream of bucket.streams) {
      if (stream._scene) {
        const key = stream._scene.id;
        if (!sceneBuckets.has(key)) {
          sceneBuckets.set(key, { scene: stream._scene, streams: [] });
        }
        sceneBuckets.get(key).streams.push(stream);
      } else {
        noScene.push(stream);
      }
    }

    // Create groups for scene clusters (2+ streams = a scene)
    for (const [sceneId, sceneBucket] of sceneBuckets) {
      if (sceneBucket.streams.length >= 2) {
        const totalViewers = sceneBucket.streams.reduce((sum, s) => sum + (s.viewers || 0), 0);
        groups.push({
          id: `${serverId}--${sceneId}`,
          type: 'scene',
          server: bucket.server,
          scene: sceneBucket.scene,
          streams: sceneBucket.streams.sort((a, b) => (b.viewers || 0) - (a.viewers || 0)),
          total_viewers: totalViewers,
          stream_count: sceneBucket.streams.length,
        });
      } else {
        // Single-stream scenes merge into the server group
        noScene.push(...sceneBucket.streams);
      }
    }

    // If there are remaining streams on this server, create a server-level group
    if (noScene.length > 0) {
      const totalViewers = noScene.reduce((sum, s) => sum + (s.viewers || 0), 0);
      groups.push({
        id: `${serverId}--general`,
        type: 'server',
        server: bucket.server,
        scene: null,
        streams: noScene.sort((a, b) => (b.viewers || 0) - (a.viewers || 0)),
        total_viewers: totalViewers,
        stream_count: noScene.length,
      });
    }
  }

  // Step 3: ungrouped streams become individual entries
  for (const stream of ungrouped) {
    groups.push({
      id: `solo--${stream.handle || stream.id}`,
      type: 'solo',
      server: null,
      scene: detectScene(stream.stream_title),
      streams: [stream],
      total_viewers: stream.viewers || 0,
      stream_count: 1,
    });
  }

  // Sort groups: multi-stream scenes first, then by total viewers
  groups.sort((a, b) => {
    // Prioritise multi-stream scenes
    if (a.stream_count >= 2 && b.stream_count < 2) return -1;
    if (b.stream_count >= 2 && a.stream_count < 2) return 1;
    return b.total_viewers - a.total_viewers;
  });

  return groups;
}

/**
 * Pick the best auto-selection (for /multi default view).
 * Guard: a tiny 2-stream group shouldn't outrank a large solo stream.
 */
function pickAutoSelection(groups) {
  if (groups.length === 0) return null;

  // Find the best multi-stream scene
  const multiScenes = groups.filter(g => g.stream_count >= 2 && g.type === 'scene');
  if (multiScenes.length > 0) {
    return multiScenes[0];
  }

  // Find the best multi-stream server group
  const multiServers = groups.filter(g => g.stream_count >= 2);
  if (multiServers.length > 0) {
    return multiServers[0];
  }

  // Fallback: highest-viewer solo
  return groups[0];
}

/**
 * Aggregate server activity for the /now page.
 */
function serverActivity(liveStreams) {
  const activity = new Map();
  for (const stream of liveStreams) {
    const server = detectServer(stream.stream_title);
    if (server) {
      if (!activity.has(server.id)) {
        activity.set(server.id, {
          server,
          live_count: 0,
          total_viewers: 0,
          top_stream: null,
        });
      }
      const entry = activity.get(server.id);
      entry.live_count++;
      entry.total_viewers += stream.viewers || 0;
      if (!entry.top_stream || (stream.viewers || 0) > (entry.top_stream.viewers || 0)) {
        entry.top_stream = stream;
      }
    }
  }
  return [...activity.values()].sort((a, b) => b.total_viewers - a.total_viewers);
}

// ── Handler ─────────────────────────────────────────────────────

export async function onRequestGet({ env }) {
  try {
    // Fetch live streams (reuse the live-now logic)
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    const now = Math.floor(Date.now() / 1000);

    // Try stream_sessions first
    let rows = [];
    const sessRes = await env.DB.prepare(`
      SELECT 
        c.id, c.display_name, c.avatar_url,
        cp.handle, cp.platform,
        ss.started_at, ss.peak_viewers, ss.avg_viewers,
        ss.primary_category, ss.final_title
      FROM stream_sessions ss
      INNER JOIN creators c ON c.id = ss.creator_id
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE ss.is_ongoing = 1 AND c.role = 'creator'
      ORDER BY ss.peak_viewers DESC
    `).all();

    rows = sessRes.results || [];

    // Fallback to snapshots
    if (rows.length === 0) {
      const snapRes = await env.DB.prepare(`
        SELECT 
          c.id, c.display_name, c.avatar_url,
          cp.handle, cp.platform AS platform,
          s.viewers, s.stream_title AS final_title, 
          s.stream_category AS primary_category, s.started_at
        FROM snapshots s
        INNER JOIN creators c ON c.id = s.creator_id
        LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
        WHERE s.captured_at > ? AND s.is_live = 1 AND c.role = 'creator'
          AND s.id IN (SELECT MAX(id) FROM snapshots WHERE is_live = 1 GROUP BY creator_id)
        ORDER BY s.viewers DESC
      `).bind(cutoff).all();
      rows = snapRes.results || [];
    }

    // Normalise to consistent shape
    const live = rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      platform: r.platform,
      handle: r.handle,
      viewers: r.viewers || r.peak_viewers || 0,
      uptime_mins: r.started_at ? Math.max(0, Math.round((now - r.started_at) / 60)) : null,
      game_name: r.primary_category,
      stream_title: r.final_title,
    }));

    // Group into scenes
    const groups = groupStreams(live);
    const autoSelection = pickAutoSelection(groups);
    const activity = serverActivity(live);

    return jsonResponse({
      ok: true,
      live_count: live.length,
      groups,
      auto_selection: autoSelection,
      server_activity: activity,
      servers: SERVERS,
      scene_types: SCENE_TYPES.map(s => ({ id: s.id, label: s.label })),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

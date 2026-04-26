// scenes.js — Scene snapshot capture for contentlore-scheduler
// Called from the main scheduled handler alongside polling.js and sessions.js
// Groups currently live streams by detected server and stores a snapshot per server

// UK RP server keyword registry — matches stream titles to servers
const SERVER_REGISTRY = [
  { name: 'JESTRP',     keywords: ['jestrp', 'jest rp', 'jest_rp'] },
  { name: 'ONERP',      keywords: ['onerp', 'one rp', 'one_rp'] },
  { name: 'MTRP',       keywords: ['mtrp', 'mt rp', 'mt_rp', 'merseyrp', 'mersey'] },
  { name: 'NPRP',       keywords: ['nprp', 'np rp', 'np_rp'] },
  { name: 'NOPIXEL',    keywords: ['nopixel', 'no pixel', 'no_pixel'] },
  { name: 'LUCID',      keywords: ['lucidcity', 'lucid city', 'lucidrp', 'lucid_rp'] },
  { name: 'IGNITE',     keywords: ['igniterp', 'ignite rp', 'ignite_rp'] },
  { name: 'ECLIPSERP',  keywords: ['eclipserp', 'eclipse rp', 'eclipse_rp'] },
  { name: 'PRODIGY',    keywords: ['prodigyrp', 'prodigy rp', 'prodigy_rp'] },
  { name: 'UKRP',       keywords: ['ukrp', 'uk rp', 'uk_rp'] },
];

function detectServer(title, tags) {
  const combined = `${title || ''} ${(tags || []).join(' ')}`.toLowerCase();
  for (const server of SERVER_REGISTRY) {
    if (server.keywords.some(kw => combined.includes(kw))) {
      return server.name;
    }
  }
  return null;
}

function extractKeywords(title) {
  if (!title) return [];
  const keywords = [];
  const lower = title.toLowerCase();
  const patterns = [
    /\b(gang|war|beef|heist|robbery|court|trial|race|war|raid|shootout|kidnap|hostage|escape|chase|police)\b/gi
  ];
  for (const pattern of patterns) {
    const matches = lower.match(pattern);
    if (matches) keywords.push(...matches);
  }
  return [...new Set(keywords)];
}

export async function captureSceneSnapshots(env) {
  const now = new Date().toISOString();
  console.log(`[scenes] Capturing scene snapshots at ${now}`);

  try {
    // Get all currently live creators from the latest snapshots
    // These are creators whose most recent snapshot shows them as live
    const liveCreators = await env.DB.prepare(`
      SELECT s.creator_name, s.platform, s.viewer_count, s.title, s.tags, s.server
      FROM creator_snapshots s
      INNER JOIN (
        SELECT creator_name, platform, MAX(snapshot_at) as latest
        FROM creator_snapshots
        WHERE snapshot_at > datetime('now', '-30 minutes')
        GROUP BY creator_name, platform
      ) latest ON s.creator_name = latest.creator_name
        AND s.platform = latest.platform
        AND s.snapshot_at = latest.latest
      WHERE s.is_live = 1
    `).all();

    const live = liveCreators.results || [];
    console.log(`[scenes] Found ${live.length} live creators`);

    if (live.length === 0) return { snapshots: 0 };

    // Group by detected server
    const serverGroups = {};
    for (const creator of live) {
      const server = creator.server || detectServer(creator.title, 
        typeof creator.tags === 'string' ? JSON.parse(creator.tags || '[]') : (creator.tags || [])
      );
      if (!server) continue;

      if (!serverGroups[server]) {
        serverGroups[server] = { streamers: [], totalViewers: 0, keywords: [] };
      }
      const viewers = creator.viewer_count || 0;
      serverGroups[server].streamers.push({
        name: creator.creator_name,
        platform: creator.platform || 'twitch',
        viewers
      });
      serverGroups[server].totalViewers += viewers;

      const kws = extractKeywords(creator.title);
      serverGroups[server].keywords.push(...kws);
    }

    // Insert a snapshot for each active server
    const insertStmt = env.DB.prepare(`
      INSERT INTO scene_snapshots (server, streamers, total_viewers, streamer_count, peak_viewer_name, peak_viewer_count, keywords, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batch = [];
    for (const [server, group] of Object.entries(serverGroups)) {
      const sorted = group.streamers.sort((a, b) => b.viewers - a.viewers);
      const peak = sorted[0] || {};
      const uniqueKeywords = [...new Set(group.keywords)];

      batch.push(insertStmt.bind(
        server,
        JSON.stringify(sorted),
        group.totalViewers,
        sorted.length,
        peak.name || null,
        peak.viewers || 0,
        JSON.stringify(uniqueKeywords),
        now
      ));
    }

    if (batch.length > 0) {
      await env.DB.batch(batch);
    }

    console.log(`[scenes] Stored ${batch.length} scene snapshots across servers`);

    // Cleanup: remove snapshots older than 7 days
    await env.DB.prepare(
      `DELETE FROM scene_snapshots WHERE snapshot_at < datetime('now', '-7 days')`
    ).run();

    return { snapshots: batch.length, servers: Object.keys(serverGroups) };
  } catch (err) {
    console.error(`[scenes] Error capturing snapshots: ${err.message}`);
    return { snapshots: 0, error: err.message };
  }
}

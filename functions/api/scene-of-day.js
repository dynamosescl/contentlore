// GET /api/scene-of-day
// Returns: peak scene today, trending servers, viewer deltas, transfer detection

export async function onRequest(context) {
  const { env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120',
  };

  try {
    // Peak scene today (highest total_viewers snapshot)
    const peakScene = await env.DB.prepare(`
      SELECT server, streamers, total_viewers, streamer_count,
             peak_viewer_name, peak_viewer_count, keywords, snapshot_at
      FROM scene_snapshots
      WHERE snapshot_at > datetime('now', '-24 hours')
      ORDER BY total_viewers DESC
      LIMIT 1
    `).first();

    // Current scene (most recent snapshots per server)
    const currentScenes = await env.DB.prepare(`
      SELECT s.server, s.streamers, s.total_viewers, s.streamer_count,
             s.peak_viewer_name, s.peak_viewer_count, s.keywords, s.snapshot_at
      FROM scene_snapshots s
      INNER JOIN (
        SELECT server, MAX(snapshot_at) as latest
        FROM scene_snapshots
        WHERE snapshot_at > datetime('now', '-30 minutes')
        GROUP BY server
      ) l ON s.server = l.server AND s.snapshot_at = l.latest
      ORDER BY s.total_viewers DESC
    `).all();

    // Previous period for delta calculation (30-60 min ago)
    const previousScenes = await env.DB.prepare(`
      SELECT s.server, s.total_viewers, s.streamer_count
      FROM scene_snapshots s
      INNER JOIN (
        SELECT server, MAX(snapshot_at) as latest
        FROM scene_snapshots
        WHERE snapshot_at BETWEEN datetime('now', '-60 minutes') AND datetime('now', '-30 minutes')
        GROUP BY server
      ) l ON s.server = l.server AND s.snapshot_at = l.latest
    `).all();

    const prevMap = {};
    for (const p of (previousScenes.results || [])) {
      prevMap[p.server] = p;
    }

    // Build current scene data with deltas
    const scenes = (currentScenes.results || []).map(s => {
      const prev = prevMap[s.server];
      const viewerDelta = prev ? s.total_viewers - prev.total_viewers : 0;
      const streamerDelta = prev ? s.streamer_count - prev.streamer_count : 0;
      return {
        server: s.server,
        streamers: JSON.parse(s.streamers || '[]'),
        totalViewers: s.total_viewers,
        streamerCount: s.streamer_count,
        peakViewer: s.peak_viewer_name,
        peakViewerCount: s.peak_viewer_count,
        keywords: JSON.parse(s.keywords || '[]'),
        snapshotAt: s.snapshot_at,
        viewerDelta,
        streamerDelta,
        trending: viewerDelta > 0 ? 'up' : viewerDelta < 0 ? 'down' : 'flat',
      };
    });

    // Transfer detection — find creators who appeared on different servers
    // in the last 2 hours
    const transfers = await env.DB.prepare(`
      SELECT DISTINCT a.server as from_server, b.server as to_server,
        json_extract(json_each.value, '$.name') as creator_name,
        a.snapshot_at as from_time, b.snapshot_at as to_time
      FROM scene_snapshots a, json_each(a.streamers)
      INNER JOIN scene_snapshots b ON b.server != a.server
        AND b.snapshot_at > a.snapshot_at
        AND b.snapshot_at < datetime(a.snapshot_at, '+2 hours')
        AND b.streamers LIKE '%' || json_extract(json_each.value, '$.name') || '%'
      WHERE a.snapshot_at > datetime('now', '-6 hours')
      ORDER BY a.snapshot_at DESC
      LIMIT 20
    `).all();

    // "Right now" summary sentence
    const totalLive = scenes.reduce((s, sc) => s + sc.streamerCount, 0);
    const totalViewers = scenes.reduce((s, sc) => s + sc.totalViewers, 0);
    const topServer = scenes[0];
    let sentence = '';
    if (totalLive === 0) {
      sentence = 'No UK RP streams detected right now.';
    } else {
      sentence = `${totalLive} creator${totalLive !== 1 ? 's' : ''} live across ${scenes.length} server${scenes.length !== 1 ? 's' : ''}, pulling ${fmtN(totalViewers)} viewers.`;
      if (topServer) {
        sentence += ` ${topServer.server} leads with ${fmtN(topServer.totalViewers)} viewers from ${topServer.streamerCount} stream${topServer.streamerCount !== 1 ? 's' : ''}.`;
        if (topServer.peakViewer) {
          sentence += ` ${topServer.peakViewer} is the top draw at ${fmtN(topServer.peakViewerCount)}.`;
        }
      }
    }

    // Format peak scene
    const peak = peakScene ? {
      server: peakScene.server,
      totalViewers: peakScene.total_viewers,
      streamerCount: peakScene.streamer_count,
      peakViewer: peakScene.peak_viewer_name,
      peakViewerCount: peakScene.peak_viewer_count,
      streamers: JSON.parse(peakScene.streamers || '[]'),
      keywords: JSON.parse(peakScene.keywords || '[]'),
      snapshotAt: peakScene.snapshot_at,
    } : null;

    return new Response(JSON.stringify({
      sentence,
      scenes,
      peakSceneToday: peak,
      transfers: (transfers.results || []),
      totalLive,
      totalViewers,
      activeServers: scenes.length,
      generatedAt: new Date().toISOString(),
    }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers
    });
  }
}

function fmtN(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

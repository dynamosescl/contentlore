// GET /api/scene-timeline
// Query params: hours=24 (default), server=JESTRP (optional)
// Returns time-series scene data for the Now page timeline

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 72);
  const server = url.searchParams.get('server');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
  };

  try {
    let query, params;

    if (server) {
      query = `
        SELECT id, server, streamers, total_viewers, streamer_count,
               peak_viewer_name, peak_viewer_count, keywords, snapshot_at
        FROM scene_snapshots
        WHERE snapshot_at > datetime('now', '-${hours} hours')
          AND server = ?
        ORDER BY snapshot_at ASC
      `;
      params = [server];
    } else {
      query = `
        SELECT id, server, streamers, total_viewers, streamer_count,
               peak_viewer_name, peak_viewer_count, keywords, snapshot_at
        FROM scene_snapshots
        WHERE snapshot_at > datetime('now', '-${hours} hours')
        ORDER BY snapshot_at ASC
      `;
      params = [];
    }

    const result = await env.DB.prepare(query).bind(...params).all();
    const snapshots = (result.results || []).map(row => ({
      ...row,
      streamers: JSON.parse(row.streamers || '[]'),
      keywords: JSON.parse(row.keywords || '[]'),
    }));

    // Group by time slots (15-min intervals) for timeline rendering
    const timeline = {};
    const serverTotals = {};

    for (const snap of snapshots) {
      // Round to nearest 15 min
      const d = new Date(snap.snapshot_at + 'Z');
      const mins = Math.floor(d.getMinutes() / 15) * 15;
      d.setMinutes(mins, 0, 0);
      const slot = d.toISOString();

      if (!timeline[slot]) timeline[slot] = {};
      timeline[slot][snap.server] = {
        viewers: snap.total_viewers,
        streamers: snap.streamer_count,
        peak: snap.peak_viewer_name,
        peakViewers: snap.peak_viewer_count,
        keywords: snap.keywords,
      };

      // Accumulate server totals
      if (!serverTotals[snap.server]) {
        serverTotals[snap.server] = { totalSnapshots: 0, peakViewers: 0, avgViewers: 0, viewerSum: 0 };
      }
      serverTotals[snap.server].totalSnapshots++;
      serverTotals[snap.server].viewerSum += snap.total_viewers;
      if (snap.total_viewers > serverTotals[snap.server].peakViewers) {
        serverTotals[snap.server].peakViewers = snap.total_viewers;
      }
    }

    // Calculate averages
    for (const srv of Object.keys(serverTotals)) {
      serverTotals[srv].avgViewers = Math.round(
        serverTotals[srv].viewerSum / serverTotals[srv].totalSnapshots
      );
      delete serverTotals[srv].viewerSum;
    }

    // Build ordered timeline array
    const timelineArray = Object.entries(timeline)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slot, servers]) => ({ time: slot, servers }));

    return new Response(JSON.stringify({
      hours,
      server: server || 'all',
      snapshots: snapshots.length,
      timeline: timelineArray,
      serverTotals,
      servers: Object.keys(serverTotals),
    }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers
    });
  }
}

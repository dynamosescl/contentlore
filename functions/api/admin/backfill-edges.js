// ================================================================
// functions/api/admin/backfill-edges.js
// POST /api/admin/backfill-edges
// Scans every historical snapshot with a non-null stream_title and
// extracts raid/host/shoutout mentions into creator_edges.
// Idempotent — running twice does not double-count (upsert by unique key).
//
// Auth: X-Admin-Password header required.
// Body: { limit?: number (default 2000, cap 10000), dry_run?: bool }
// ================================================================

import { jsonResponse, requireAdminAuth } from '../../_lib.js';

// Real UK streaming title patterns (not the "raided by X" fantasy):
//  - @mentions: "@canniny", "@HAchubby"
//  - collab prefixes: "w/ @alice", "ft. bob", "feat. carol"
//  - occasional raid/host language (kept, will hit sometimes)
const MENTION_PATTERN = /(?:\bw\/\s*|\bft\.?\s+|\bfeat\.?\s+|\bwith\s+|\braid(?:ed)?\s+(?:by\s+)?|\bhost(?:ed)?\s+(?:by\s+)?|\bshout\s?out\s+(?:to\s+)?)@?([a-zA-Z0-9_]{3,30})|@([a-zA-Z0-9_]{3,30})/gi;

export async function onRequestPost({ env, request }) {
  const authError = requireAdminAuth(request, env);
  if (authError) return authError;

  let body = {};
  try { body = await request.json(); } catch { /* fine */ }
  const limit   = Math.min(parseInt(body?.limit || '2000', 10), 10000);
  const dryRun  = body?.dry_run === true;

  try {
    // Build handle map: handle (lowercase) -> creator_id
    const handleMapRes = await env.DB.prepare(`
      SELECT handle, creator_id FROM creator_platforms WHERE handle IS NOT NULL
    `).all();
    const handleMap = new Map();
    for (const r of (handleMapRes.results || [])) {
      if (r.handle) handleMap.set(String(r.handle).toLowerCase(), r.creator_id);
    }

    // Pull snapshots with titles, most recent first, bounded by limit
    const snapsRes = await env.DB.prepare(`
      SELECT s.creator_id, s.platform, s.stream_title, s.captured_at
      FROM snapshots s
      WHERE s.stream_title IS NOT NULL AND LENGTH(s.stream_title) > 0
      ORDER BY s.captured_at DESC
      LIMIT ?
    `).bind(limit).all();

    const snapshots = snapsRes.results || [];

    let titlesScanned = 0;
    let totalMatches = 0;           // raw regex hits (before handle filtering)
    let matchedUnknownHandle = 0;   // matched a handle but not in our map
    let matchedSelf = 0;             // matched creator's own handle
    let mentionsFound = 0;           // passed all filters
    let edgesWritten = 0;
    const errorsByCategory = {};
    const sampleMatches = [];
    const sampleUnknownHandles = new Set();  // unique @handles we saw that aren't tracked

    for (const snap of snapshots) {
      titlesScanned++;
      const title = snap.stream_title;
      const matches = [...title.matchAll(MENTION_PATTERN)];

      for (const m of matches) {
        totalMatches++;
        // Either group 1 (prefixed: w/ @x, ft. @x, raided by x) or group 2 (plain @x)
        const mentionedHandle = ((m[1] || m[2]) || '').toLowerCase();
        if (!mentionedHandle || mentionedHandle.length < 3) continue;
        const targetCreatorId = handleMap.get(mentionedHandle);

        if (!targetCreatorId) {
          matchedUnknownHandle++;
          if (sampleUnknownHandles.size < 30) sampleUnknownHandles.add(mentionedHandle);
          continue;
        }
        if (targetCreatorId === snap.creator_id) {
          matchedSelf++;
          continue;
        }

        mentionsFound++;
        const phrase = m[0].toLowerCase();

        // Classification priority: explicit raid/host language > collab > plain mention
        let edgeType = 'mention';
        if (phrase.includes('raid'))           edgeType = 'raid';
        else if (phrase.includes('host'))      edgeType = 'host';
        else if (phrase.includes('shout'))     edgeType = 'shoutout';
        else if (phrase.includes('w/') ||
                 phrase.includes('ft')  ||
                 phrase.includes('feat')||
                 phrase.includes('with')) edgeType = 'co_stream';

        if (sampleMatches.length < 10) {
          sampleMatches.push({
            from: snap.creator_id,
            to: targetCreatorId,
            type: edgeType,
            title_snippet: title.substring(0, 80),
          });
        }

        if (dryRun) continue;

        try {
          await env.DB.prepare(`
            INSERT INTO creator_edges
              (from_creator_id, to_creator_id, edge_type, weight, last_seen_at, first_seen_at, platform, source)
            VALUES (?, ?, ?, 1, ?, ?, ?, 'backfill')
            ON CONFLICT(from_creator_id, to_creator_id, edge_type)
            DO UPDATE SET
              weight = weight + 1,
              last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
          `).bind(
            snap.creator_id,
            targetCreatorId,
            edgeType,
            snap.captured_at,
            snap.captured_at,
            snap.platform
          ).run();
          edgesWritten++;
        } catch (dbErr) {
          const cat = 'db_insert_failed';
          errorsByCategory[cat] = (errorsByCategory[cat] || 0) + 1;
        }
      }
    }

    console.log(`[backfill] scanned=${titlesScanned} total_matches=${totalMatches} unknown_handles=${matchedUnknownHandle} mentions=${mentionsFound} edges_written=${edgesWritten}`);

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      titles_scanned: titlesScanned,
      total_regex_matches: totalMatches,
      matched_unknown_handle: matchedUnknownHandle,
      matched_self: matchedSelf,
      mentions_found: mentionsFound,
      edges_written: edgesWritten,
      handle_map_size: handleMap.size,
      errors: errorsByCategory,
      sample_matches: sampleMatches,
      sample_unknown_handles: Array.from(sampleUnknownHandles),
      note: dryRun
        ? 'Dry run — no writes. Set dry_run: false to commit.'
        : 'Edges written. Run again to pick up any new snapshots since.',
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

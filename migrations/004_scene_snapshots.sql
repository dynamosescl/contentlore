-- Phase 3: Scene snapshot schema
-- Run: wrangler d1 execute contentlore-db --file=migrations/004_scene_snapshots.sql --remote

-- Ensure table exists with full schema
CREATE TABLE IF NOT EXISTS scene_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server TEXT NOT NULL,
  streamers TEXT DEFAULT '[]',          -- JSON array of {name, platform, viewers}
  total_viewers INTEGER DEFAULT 0,
  streamer_count INTEGER DEFAULT 0,
  peak_viewer_name TEXT,                -- top streamer in this scene
  peak_viewer_count INTEGER DEFAULT 0,
  keywords TEXT DEFAULT '[]',           -- JSON array of detected title keywords
  snapshot_at TEXT DEFAULT (datetime('now'))
);

-- Index for timeline queries (last 24-48h by server)
CREATE INDEX IF NOT EXISTS idx_scene_snap_time ON scene_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_scene_snap_server ON scene_snapshots(server, snapshot_at);

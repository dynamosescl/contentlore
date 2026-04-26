-- ================================================================
-- migrations/007_scene_snapshots.sql
-- Stores detected scene events for the 24hr timeline on /now.
-- Written by the scheduler when scenes are detected during polling.
-- ================================================================

CREATE TABLE IF NOT EXISTS scene_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_key TEXT NOT NULL,
  server_id TEXT,
  scene_type TEXT,
  stream_count INTEGER NOT NULL,
  total_viewers INTEGER NOT NULL,
  stream_handles TEXT NOT NULL DEFAULT '[]',
  detected_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scene_snaps_time ON scene_snapshots(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_scene_snaps_server ON scene_snapshots(server_id, detected_at DESC);

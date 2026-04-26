-- Phase 4: Discovery pipeline schema
-- Run: wrangler d1 execute contentlore-db --file=migrations/005_discovery.sql --remote
-- Or paste into D1 Console

-- Ensure pending_creators has full schema for discovery
-- (table may already exist from earlier setup — this is additive)

CREATE TABLE IF NOT EXISTS pending_creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT DEFAULT 'twitch',
  channel_id TEXT,
  profile_image TEXT,
  discovered_title TEXT,
  discovered_viewers INTEGER DEFAULT 0,
  discovered_tags TEXT DEFAULT '[]',
  detected_server TEXT,
  discovery_count INTEGER DEFAULT 1,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'pending',
  reviewed_at TEXT,
  reviewed_by TEXT,
  notes TEXT,
  UNIQUE(name, platform)
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_creators(status);
CREATE INDEX IF NOT EXISTS idx_pending_last_seen ON pending_creators(last_seen);
CREATE INDEX IF NOT EXISTS idx_pending_count ON pending_creators(discovery_count);

CREATE TABLE IF NOT EXISTS creator_edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_creator_id TEXT NOT NULL,
  to_creator_id   TEXT NOT NULL,
  edge_type       TEXT NOT NULL CHECK (edge_type IN ('raid', 'host', 'co_stream', 'mention', 'shoutout')),
  weight          INTEGER NOT NULL DEFAULT 1,
  last_seen_at    INTEGER NOT NULL,
  first_seen_at   INTEGER NOT NULL,
  platform        TEXT,
  source          TEXT,
  UNIQUE (from_creator_id, to_creator_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_from    ON creator_edges(from_creator_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_edges_to      ON creator_edges(to_creator_id,   last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_edges_recent  ON creator_edges(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_edges_type    ON creator_edges(edge_type, last_seen_at DESC);
ALTER TABLE snapshots ADD COLUMN stream_title TEXT;
ALTER TABLE snapshots ADD COLUMN game_name    TEXT;
ALTER TABLE snapshots ADD COLUMN started_at   INTEGER;

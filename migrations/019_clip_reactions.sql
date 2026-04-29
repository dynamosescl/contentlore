-- Migration 019: Clip reactions
--
-- One row per (clip_id, emoji) pair. Counts increment via /api/clip-react
-- (POST) and are read alongside the clip wall via /api/clip-reactions.
-- Per-device de-duplication is handled in localStorage on the client —
-- the server only enforces a per-IP rate limit and the emoji allowlist.

CREATE TABLE IF NOT EXISTS clip_reactions (
  clip_id    TEXT    NOT NULL,
  emoji      TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (clip_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_clip_reactions_clip ON clip_reactions(clip_id);

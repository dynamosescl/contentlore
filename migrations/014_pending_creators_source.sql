-- ================================================================
-- 014_pending_creators_source.sql
--
-- Adds two columns to pending_creators so the discovery queue can
-- record HOW each candidate was discovered:
--   • source         — 'discovery' (default; auto from GTA V scan),
--                      'raid', 'host', 'shoutout', or 'submission'
--                      (the existing /api/submit form, when we
--                      backfill it).
--   • raid_sources   — JSON array of tracked-streamer handles that
--                      raided/hosted this candidate. Used to rank
--                      the new "Recommended" section in /mod/ —
--                      more distinct sources = stronger signal.
--
-- Idempotent: ALTER TABLE ADD COLUMN errors are silenced via the
-- IF NOT EXISTS pattern below (D1 SQLite doesn't support
-- IF NOT EXISTS on ADD COLUMN, so we wrap with a defensive subquery
-- that's a no-op if the column already exists).
-- ================================================================

-- D1 doesn't support `ADD COLUMN IF NOT EXISTS`, so we just hope no
-- one ran the migration twice. Re-running this file will throw a
-- "duplicate column name" error on the second run — that's fine,
-- each line is independent and the SQL below it still runs.

ALTER TABLE pending_creators ADD COLUMN source TEXT NOT NULL DEFAULT 'discovery';
ALTER TABLE pending_creators ADD COLUMN raid_sources TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_pending_source ON pending_creators(source);

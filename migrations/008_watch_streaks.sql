-- Phase 3: Watch Streaks
-- Anonymous opt-in daily-visit tracking with optional public display name.
-- Run: npx wrangler d1 execute contentlore-db --file=migrations/008_watch_streaks.sql --remote

CREATE TABLE IF NOT EXISTS watch_streaks (
  user_id        TEXT PRIMARY KEY,             -- client-generated UUID; never user-typed
  display_name   TEXT,                          -- optional; only shown on leaderboard if set
  first_visit_at INTEGER NOT NULL,              -- unix epoch (server-stamped)
  last_visit_at  INTEGER NOT NULL,              -- unix epoch (server-stamped at most-recent check-in)
  current_streak INTEGER NOT NULL DEFAULT 1,    -- consecutive UTC days
  max_streak     INTEGER NOT NULL DEFAULT 1,    -- best streak ever
  total_visits   INTEGER NOT NULL DEFAULT 1    -- lifetime check-in count
);

-- Two leaderboard orderings + a recency index for cleanup queries.
CREATE INDEX IF NOT EXISTS idx_streaks_current  ON watch_streaks(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_streaks_max      ON watch_streaks(max_streak DESC);
CREATE INDEX IF NOT EXISTS idx_streaks_lastseen ON watch_streaks(last_visit_at DESC);

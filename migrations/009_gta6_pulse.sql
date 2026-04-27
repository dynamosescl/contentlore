-- Phase 4: GTA 6 Community Pulse poll
-- Anonymous one-vote-per-user poll on the /gta-rp/gta-6/ page.
-- Run: npx wrangler d1 execute contentlore-db --file=migrations/009_gta6_pulse.sql --remote

CREATE TABLE IF NOT EXISTS gta6_pulse_votes (
  user_id  TEXT PRIMARY KEY,                      -- client-generated UUID; never user-typed
  choice   TEXT NOT NULL
    CHECK (choice IN ('ready', 'optimistic', 'worried', 'not-thinking')),
  voted_at INTEGER NOT NULL                       -- unix epoch (server-stamped)
);

CREATE INDEX IF NOT EXISTS idx_pulse_choice ON gta6_pulse_votes(choice);

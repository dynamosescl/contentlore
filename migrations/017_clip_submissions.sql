-- ================================================================
-- 017_clip_submissions.sql
-- Stores clips submitted by viewers via the public form on
-- /gta-rp/clips/. Awaiting moderator approval in /mod/ before they
-- surface on the wall with a "Community Pick" badge.
-- ================================================================

CREATE TABLE IF NOT EXISTS clip_submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  url               TEXT NOT NULL,                 -- Twitch or Kick clip URL
  platform          TEXT,                          -- 'twitch' | 'kick' (auto-detected from URL)
  clip_id           TEXT,                          -- Twitch clip slug if parseable
  creator_handle    TEXT NOT NULL,                 -- which curated streamer the clip is from
  description       TEXT,                          -- optional submitter description
  submitted_by_ip   TEXT,                          -- for spam attribution
  user_agent        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  decided_at        INTEGER,                       -- unix seconds, set on approve/reject
  decided_note      TEXT,                          -- optional moderator note
  submitted_at      INTEGER NOT NULL               -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_clip_submissions_status      ON clip_submissions(status);
CREATE INDEX IF NOT EXISTS idx_clip_submissions_submitted   ON clip_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_clip_submissions_creator     ON clip_submissions(creator_handle);

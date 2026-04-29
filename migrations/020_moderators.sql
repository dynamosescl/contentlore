-- Migration 020: Stream Moderator section
--
-- Five new tables for the moderator system + a `bio` column on
-- curated_creators so verified mods can edit their creator's bio.
--
-- Mods are identified by a token stored in mod_accounts.token. Tokens
-- are issued at signup and shown to the mod once at admin approval.
-- Per-device storage in localStorage `cl:mod:token`. All /api/mod/*
-- endpoints require Authorization: Bearer <token> except signup.

CREATE TABLE IF NOT EXISTS mod_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  twitch_handle   TEXT,
  kick_handle     TEXT,
  display_name    TEXT NOT NULL,
  creators_modded TEXT NOT NULL,                 -- JSON array of curated handles, e.g. ["tyrone","stoker"]
  message         TEXT,                          -- signup message, surfaces in /mod/ panel
  token           TEXT NOT NULL UNIQUE,          -- 32-char hex, server-generated
  xp              INTEGER NOT NULL DEFAULT 0,
  level           TEXT NOT NULL DEFAULT 'rookie',-- rookie|regular|trusted|senior|head
  status          TEXT NOT NULL DEFAULT 'pending',-- pending|verified|suspended
  mod_of_month    TEXT,                          -- 'YYYY-MM' month they won; nullable
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  last_active     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mod_accounts_token   ON mod_accounts(token);
CREATE INDEX IF NOT EXISTS idx_mod_accounts_status  ON mod_accounts(status);

CREATE TABLE IF NOT EXISTS characters (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  character_name     TEXT NOT NULL,
  played_by_handle   TEXT NOT NULL,        -- curated creator handle
  server             TEXT,                 -- e.g. "Orbit RP"
  faction            TEXT,                 -- gang/job
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'active', -- active|retired|dead
  submitted_by_mod   INTEGER,              -- mod_accounts.id
  approved           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_characters_creator ON characters(played_by_handle);
CREATE INDEX IF NOT EXISTS idx_characters_name    ON characters(character_name);
CREATE INDEX IF NOT EXISTS idx_characters_appr    ON characters(approved);

CREATE TABLE IF NOT EXISTS mod_stream_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mod_id          INTEGER NOT NULL,
  creator_handle  TEXT NOT NULL,
  session_date    TEXT NOT NULL,           -- 'YYYY-MM-DD' (UK day)
  notes           TEXT,
  flagged_moments TEXT,                    -- JSON array of {ts:int, label:string}
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
-- One row per (mod, creator, day) — auto-saves UPSERT into this row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_notes_unique
  ON mod_stream_notes(mod_id, creator_handle, session_date);
CREATE INDEX IF NOT EXISTS idx_mod_notes_creator
  ON mod_stream_notes(creator_handle, session_date);

CREATE TABLE IF NOT EXISTS mod_contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mod_id      INTEGER NOT NULL,
  type        TEXT NOT NULL,         -- clip_tag|character_add|social_update|stream_notes|moment_flag|bio_edit
  target_id   TEXT,                  -- the thing acted on, e.g. clip id or character id (text for flexibility)
  xp_earned   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mod_contrib_mod   ON mod_contributions(mod_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mod_contrib_type  ON mod_contributions(type);

CREATE TABLE IF NOT EXISTS clip_tags (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id             TEXT NOT NULL,
  tag                 TEXT NOT NULL,
  context_description TEXT,
  submitted_by_mod    INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_clip_tags_clip ON clip_tags(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_tags_tag  ON clip_tags(tag);

-- Bio column on curated_creators. SQLite has no IF NOT EXISTS for ADD
-- COLUMN; if you re-run this migration on a DB that already has the
-- column, the ALTER will fail and the rest of the script will stop.
-- Comment this out before re-running by hand.
ALTER TABLE curated_creators ADD COLUMN bio TEXT;

-- ================================================================
-- 012_watch_party.sql — Watch Party tables
--
-- Phase 6. Synced viewing experience: one host picks a stream and
-- shares a 6-char party id; everyone joining the same id gets the
-- same embed plus a shared chat. Parties self-expire after 24h.
--
-- Idempotent — safe to re-run.
-- ================================================================

CREATE TABLE IF NOT EXISTS parties (
  id              TEXT    PRIMARY KEY,                -- 6-char alphanumeric (e.g. ABC123)
  host_token      TEXT    NOT NULL,                   -- random 32-char secret, gates host-only mutations
  current_handle  TEXT    NOT NULL,                   -- creator handle the party is currently watching
  current_platform TEXT   NOT NULL,                   -- 'twitch' | 'kick' (drives the embed url)
  host_name       TEXT,                               -- display name the host picked
  created_at      INTEGER NOT NULL,                   -- unix seconds
  updated_at      INTEGER NOT NULL,                   -- unix seconds
  expires_at      INTEGER NOT NULL                    -- unix seconds — created_at + 86400
);

CREATE INDEX IF NOT EXISTS idx_parties_expires_at ON parties(expires_at);

CREATE TABLE IF NOT EXISTS party_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id    TEXT    NOT NULL,                       -- FK to parties.id (logical, no enforcement)
  username    TEXT    NOT NULL,                       -- display name from localStorage
  message     TEXT    NOT NULL,                       -- chat content (server-trims to 280 chars)
  created_at  INTEGER NOT NULL                        -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_party_messages_party_at ON party_messages(party_id, created_at);
CREATE INDEX IF NOT EXISTS idx_party_messages_created_at ON party_messages(created_at);

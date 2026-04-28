-- PWA Phase 5 — browser push subscriptions
-- Run: npx wrangler d1 execute contentlore-db --file=migrations/011_push_subscriptions.sql --remote
--
-- Stores Web Push API subscriptions per device (one row per
-- PushSubscription.endpoint, since that's the unique identifier
-- the push service issues). Anonymous: keyed by a client-side
-- UUID stored in localStorage, same pattern as watch_streaks.
-- filter_handles is reserved for per-creator opt-in later — for
-- now the bot fans out to anyone with 'all'.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uuid       TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL UNIQUE,
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  user_agent      TEXT,
  filter_handles  TEXT    NOT NULL DEFAULT 'all',
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_uuid ON push_subscriptions(user_uuid);
CREATE INDEX IF NOT EXISTS idx_push_filter ON push_subscriptions(filter_handles);
CREATE INDEX IF NOT EXISTS idx_push_seen ON push_subscriptions(last_seen_at);

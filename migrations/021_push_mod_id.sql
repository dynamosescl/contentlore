-- Migration 021: link push_subscriptions to mod_accounts
--
-- When a verified mod subscribes to push from /moderators/dashboard/,
-- the row is tagged with mod_id so the scheduler can fan out
-- mod-specific copy ("Your creator just went live on {server}",
-- "Tyrone moved from Orbit to Unique") instead of the public copy.
--
-- Nullable; legacy / public subscriptions stay mod_id NULL.
ALTER TABLE push_subscriptions ADD COLUMN mod_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_push_mod ON push_subscriptions(mod_id);

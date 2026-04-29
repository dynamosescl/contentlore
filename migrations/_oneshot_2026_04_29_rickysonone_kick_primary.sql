-- ================================================================
-- Flip rickysonone's primary platform from Twitch to Kick.
--
-- Confirmed handle resolves on both platforms. Brief calls for Kick
-- to be primary so polling, /api/uk-rp-live, and rank/leaderboards
-- all attribute the activity to Kick going forward.
--
-- Three writes:
--   1. curated_creators.primary_platform = 'kick'
--   2. creator_platforms (twitch row) → is_primary = 0
--   3. creator_platforms (kick row)   → is_primary = 1
--
-- The socials JSON already lists both handles ({twitch:..., kick:...})
-- so no edit needed there. Existing creator_id stays as
-- 'twitch-rickysonone' — the prefix is historical and harmless.
--
-- Confirmed via verification on 2026-04-29: chloekins95 resolves on
-- Twitch (page metadata returns "I RP as Chloe Wylder / Alorie
-- Wynters") so no change needed for that handle.
-- ================================================================

UPDATE curated_creators
   SET primary_platform = 'kick'
 WHERE handle = 'rickysonone';

UPDATE creator_platforms
   SET is_primary = 0
 WHERE LOWER(handle) = 'rickysonone' AND platform = 'twitch';

UPDATE creator_platforms
   SET is_primary = 1
 WHERE LOWER(handle) = 'rickysonone' AND platform = 'kick';

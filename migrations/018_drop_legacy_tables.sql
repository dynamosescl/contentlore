-- ================================================================
-- 018_drop_legacy_tables.sql
-- Drops eight legacy tables that no Function or scheduler script
-- still references. They were left over from earlier project pivots
-- (the editorial CMS, the FiveM Enhanced "transition" tracker
-- prototype, the rising-creators feed). All have been confirmed
-- unused — full grep across functions/, contentlore-scheduler/,
-- and every HTML page on 2026-04-29.
--
-- DROP IF EXISTS so this migration is safe to re-run.
-- ================================================================

DROP TABLE IF EXISTS category_editorial_notes;
DROP TABLE IF EXISTS claims;
DROP TABLE IF EXISTS lore_entries;
DROP TABLE IF EXISTS rising_posts;
DROP TABLE IF EXISTS transition_changelog;
DROP TABLE IF EXISTS transition_creators;
DROP TABLE IF EXISTS transition_servers;
DROP TABLE IF EXISTS transition_timeline;

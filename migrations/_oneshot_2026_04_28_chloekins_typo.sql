-- One-shot: fix cholekins95 → chloekins95 typo.
-- creators.id is FK-referenced from creator_platforms (and would also
-- be from snapshots / stream_sessions etc once data accumulates), so
-- we can't UPDATE the id in place. These rows are ~30 min old with
-- no dependent data, so delete-and-reinsert is safe.

-- 1. Insert correctly-named rows first (so the FK target exists)
INSERT OR IGNORE INTO creators (id, display_name, role)
  VALUES ('twitch-chloekins95', 'Chloekins95', 'creator');
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified)
  VALUES ('twitch-chloekins95', 'twitch', 'chloekins95', 1, 0);

-- 2. Drop the typo'd rows (children first, then parent)
DELETE FROM creator_platforms WHERE creator_id = 'twitch-cholekins95';
DELETE FROM creators WHERE id = 'twitch-cholekins95';

-- 3. Update the curated_creators row in place (handle is PK here but
--    not FK-referenced by any other table).
UPDATE curated_creators
SET handle = 'chloekins95',
    display_name = 'Chloekins95',
    socials = json_set(socials, '$.twitch', 'chloekins95')
WHERE handle = 'cholekins95';

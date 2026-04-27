-- Phase 4: Backfill the 20 curated creators that aren't yet in the
-- creators / creator_platforms tables. Without these rows, the scheduler's
-- round-robin polling skips them and downstream features (timeline,
-- scene_snapshots, creator-profile stats) stay empty for ~76% of the
-- curated 26.
--
-- INSERT OR IGNORE keeps this idempotent — re-running is a no-op.
--
-- Run: npx wrangler d1 execute contentlore-db --file=migrations/010_backfill_curated.sql --remote

-- ============================================================
-- Already present (do not re-create — listed for reference)
--   tyrone           twitch
--   reeclare         twitch     (creator_id: kick-reeclare)
--   samham           twitch     (creator_id: twitch-samham)
--   bags             twitch     (creator_id: twitch-bags)  ← needs +kick row
--   dynamoses        kick + twitch (creator_id: dynamoses)
--   kavsual          kick       (creator_id: kick-kavsual)
-- ============================================================

-- ----- 16 missing Twitch creators -----
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-lbmm', 'LBMM', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-stoker', 'Stoker', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-deggyuk', 'DeggyUK', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-megsmary', 'MegsMary', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-tazzthegeeza', 'TaZzTheGeeza', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-wheelydev', 'WheelyDev', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-rexality', 'RexaliTy', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-steeel', 'Steeel', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-justj0hnnyhd', 'JustJ0hnnyHD', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-cherish_remedy', 'Cherish_Remedy', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-lorddorro', 'LordDorro', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-jck0__', 'JCK0__', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-absthename', 'ABsTheName', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-essellz', 'Essellz', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-lewthescot', 'LewTheScot', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-angels365', 'Angels365', 'creator');
-- (4 fantasiasfantasy split into its own line for clarity below)
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-fantasiasfantasy', 'FantasiasFantasy', 'creator');

INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-lbmm', 'twitch', 'lbmm', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-stoker', 'twitch', 'stoker', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-deggyuk', 'twitch', 'deggyuk', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-megsmary', 'twitch', 'megsmary', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-tazzthegeeza', 'twitch', 'tazzthegeeza', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-wheelydev', 'twitch', 'wheelydev', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-rexality', 'twitch', 'rexality', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-steeel', 'twitch', 'steeel', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-justj0hnnyhd', 'twitch', 'justj0hnnyhd', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-cherish_remedy', 'twitch', 'cherish_remedy', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-lorddorro', 'twitch', 'lorddorro', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-jck0__', 'twitch', 'jck0__', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-absthename', 'twitch', 'absthename', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-essellz', 'twitch', 'essellz', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-lewthescot', 'twitch', 'lewthescot', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-angels365', 'twitch', 'angels365', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-fantasiasfantasy', 'twitch', 'fantasiasfantasy', 1, 0);

-- ----- 3 missing Kick creators (shammers, dcampion, elliewaller) -----
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('kick-shammers', 'Shammers', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('kick-dcampion', 'DCampion', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('kick-elliewaller', 'EllieWaller', 'creator');

INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('kick-shammers', 'kick', 'shammers', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('kick-dcampion', 'kick', 'dcampion', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('kick-elliewaller', 'kick', 'elliewaller', 1, 0);

-- ----- bags: existing creator_id 'twitch-bags' needs a kick platform row -----
-- (His allowlist platform is kick, but the existing creator record was named
-- with a 'twitch-' prefix from a prior discovery — keep it, just add the kick
-- channel as a sibling platform under the same creator.)
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-bags', 'kick', 'bags', 1, 0);

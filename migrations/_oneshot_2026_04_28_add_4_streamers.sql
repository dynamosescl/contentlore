-- One-shot: add 4 new tracked streamers (audit only — applied via
-- `wrangler d1 execute` on 2026-04-28; not part of the standard
-- migration sequence).
--
-- All 4 follow the migration-010 pattern:
--   1. INSERT into creators with id="<platform>-<handle>"
--   2. INSERT into creator_platforms tying creator_id → handle
--   3. INSERT into curated_creators with the full socials JSON
--
-- Notes:
--   • cholekins95: Twitch helix returned no row at probe time — the
--     handle may be a typo or recently renamed. Inserted anyway per
--     instruction; live polling will surface as offline until it
--     resolves to a real account.
--   • rickysonone: dual-platform confirmed (Twitch partner + Kick).
--     Their Kick bio reads "I left the Purple Tick behind to stream
--     full-time on Kick" — primary_platform=twitch per instruction
--     but they may be more reliably live on the Kick side.

-- ----- creators -----
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-cholekins95',   'Cholekins95',   'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-kapperdiaries', 'KapperDiaries', 'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-rickysonone',   'RickysOnOne',   'creator');
INSERT OR IGNORE INTO creators (id, display_name, role) VALUES ('twitch-mearrss',       'Mearrss',       'creator');

-- ----- creator_platforms (primary platform = twitch for all 4) -----
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-cholekins95',   'twitch', 'cholekins95',   1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-kapperdiaries', 'twitch', 'kapperdiaries', 1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-rickysonone',   'twitch', 'rickysonone',   1, 0);
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-mearrss',       'twitch', 'mearrss',       1, 0);

-- rickysonone is the only confirmed dual-platform of the four (probe verified).
INSERT OR IGNORE INTO creator_platforms (creator_id, platform, handle, is_primary, verified) VALUES ('twitch-rickysonone', 'kick', 'rickysonone', 0, 0);

-- ----- curated_creators (the source of truth for the allowlist) -----
INSERT OR IGNORE INTO curated_creators (handle, display_name, primary_platform, socials) VALUES
  ('cholekins95',   'Cholekins95',   'twitch', '{"twitch":"cholekins95","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('kapperdiaries', 'KapperDiaries', 'twitch', '{"twitch":"kapperdiaries","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('rickysonone',   'RickysOnOne',   'twitch', '{"twitch":"rickysonone","kick":"rickysonone","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('mearrss',       'Mearrss',       'twitch', '{"twitch":"mearrss","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}');

-- Drop them from the discovery queue if they got auto-flagged so the
-- mod panel "pending" list isn't cluttered with handles we already added.
UPDATE pending_creators SET status = 'approved' WHERE LOWER(name) IN ('cholekins95','kapperdiaries','rickysonone','mearrss');

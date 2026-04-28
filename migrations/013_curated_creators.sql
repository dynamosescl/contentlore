-- ================================================================
-- 013_curated_creators.sql — single source of truth for the curated
-- 26-creator allowlist. Replaces 14 hardcoded copies scattered across
-- Pages Functions + scheduler.
--
-- Idempotent. Re-running this file is safe; INSERT OR IGNORE skips
-- rows that already exist.
-- ================================================================

CREATE TABLE IF NOT EXISTS curated_creators (
  handle            TEXT    NOT NULL PRIMARY KEY,                          -- lowercase
  display_name      TEXT    NOT NULL,                                      -- as-shown casing
  primary_platform  TEXT    NOT NULL CHECK (primary_platform IN ('twitch', 'kick')),
  socials           TEXT    NOT NULL DEFAULT '{}',                         -- JSON: {twitch,kick,tiktok,youtube,x,instagram,discord}
  added_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active            INTEGER NOT NULL DEFAULT 1                             -- 1=tracked, 0=soft-deleted
);

CREATE INDEX IF NOT EXISTS idx_curated_active ON curated_creators(active);

-- Seed — 26 current creators. The two confirmed dual-platform creators
-- (dynamoses, bags) get both twitch + kick handles populated.
INSERT OR IGNORE INTO curated_creators (handle, display_name, primary_platform, socials) VALUES
  ('tyrone',           'Tyrone',           'twitch', '{"twitch":"tyrone","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('lbmm',             'LBMM',             'twitch', '{"twitch":"lbmm","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('reeclare',         'Reeclare',         'twitch', '{"twitch":"reeclare","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('stoker',           'Stoker',           'twitch', '{"twitch":"stoker","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('samham',           'SamHam',           'twitch', '{"twitch":"samham","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('deggyuk',          'DeggyUK',          'twitch', '{"twitch":"deggyuk","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('megsmary',         'MegsMary',         'twitch', '{"twitch":"megsmary","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('tazzthegeeza',     'TaZzTheGeeza',     'twitch', '{"twitch":"tazzthegeeza","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('wheelydev',        'WheelyDev',        'twitch', '{"twitch":"wheelydev","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('rexality',         'RexaliTy',         'twitch', '{"twitch":"rexality","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('steeel',           'Steeel',           'twitch', '{"twitch":"steeel","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('justj0hnnyhd',     'JustJ0hnnyHD',     'twitch', '{"twitch":"justj0hnnyhd","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('cherish_remedy',   'Cherish_Remedy',   'twitch', '{"twitch":"cherish_remedy","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('lorddorro',        'LordDorro',        'twitch', '{"twitch":"lorddorro","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('jck0__',           'JCK0__',           'twitch', '{"twitch":"jck0__","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('absthename',       'ABsTheName',       'twitch', '{"twitch":"absthename","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('essellz',          'Essellz',          'twitch', '{"twitch":"essellz","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('lewthescot',       'LewTheScot',       'twitch', '{"twitch":"lewthescot","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('angels365',        'Angels365',        'twitch', '{"twitch":"angels365","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('fantasiasfantasy', 'FantasiasFantasy', 'twitch', '{"twitch":"fantasiasfantasy","kick":null,"tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('kavsual',          'Kavsual',          'kick',   '{"twitch":null,"kick":"kavsual","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('shammers',         'Shammers',         'kick',   '{"twitch":null,"kick":"shammers","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('bags',             'Bags',             'kick',   '{"twitch":"bags","kick":"bags","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('dynamoses',        'Dynamoses',        'kick',   '{"twitch":"dynamoses","kick":"dynamoses","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('dcampion',         'DCampion',         'kick',   '{"twitch":null,"kick":"dcampion","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}'),
  ('elliewaller',      'EllieWaller',      'kick',   '{"twitch":null,"kick":"elliewaller","tiktok":null,"youtube":null,"x":null,"instagram":null,"discord":null}');

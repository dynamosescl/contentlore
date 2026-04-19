-- ===========================================================================
-- ContentLore Tebex Audit — D1 schema
-- Run once: wrangler d1 execute contentlore-db --file=tebex-audit-schema.sql --remote
-- OR paste into Cloudflare dashboard → D1 → contentlore-db → Console
-- Idempotent: safe to re-run. CREATE TABLE IF NOT EXISTS prevents collisions.
-- ===========================================================================

-- Target servers — the list of UK FiveM servers being audited
CREATE TABLE IF NOT EXISTS tebex_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL UNIQUE,
  tebex_url TEXT NOT NULL DEFAULT '',
  store_type TEXT NOT NULL DEFAULT 'tebex-standard',
  include_in_audit INTEGER NOT NULL DEFAULT 1,
  scoreboard_rank INTEGER,
  contact_channel TEXT,
  contact_verified_at TEXT,
  editorial_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Run log — one row per scraper execution
CREATE TABLE IF NOT EXISTS tebex_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  run_type TEXT DEFAULT 'manual',
  servers_attempted INTEGER DEFAULT 0,
  servers_successful INTEGER DEFAULT 0,
  products_collected INTEGER DEFAULT 0,
  errors TEXT,
  duration_sec INTEGER,
  scraper_version TEXT,
  notes TEXT
);

-- Raw products — every product from every scrape
CREATE TABLE IF NOT EXISTS tebex_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  product_name TEXT,
  price_native REAL DEFAULT 0,
  currency TEXT,
  price_gbp REAL DEFAULT 0,
  price_usd REAL DEFAULT 0,
  category TEXT,
  description TEXT,
  product_url TEXT,
  recurring INTEGER DEFAULT 0,
  scraped_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Per-server summary per run — the data the scoring references
CREATE TABLE IF NOT EXISTS tebex_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  total_products INTEGER DEFAULT 0,
  min_price_gbp REAL,
  max_price_gbp REAL,
  median_price_gbp REAL,
  has_subscription_tiers INTEGER DEFAULT 0,
  subscription_tier_count INTEGER DEFAULT 0,
  entry_tier_gbp REAL,
  top_tier_gbp REAL,
  pla_keyword_matches INTEGER DEFAULT 0,
  marketing_honesty_flags INTEGER DEFAULT 0,
  fetch_status TEXT DEFAULT 'OK',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, server_name)
);

-- Automated + editorial flags
CREATE TABLE IF NOT EXISTS tebex_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_id TEXT UNIQUE,
  run_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  dimension TEXT,
  flag_type TEXT,
  severity INTEGER DEFAULT 1,
  evidence_url TEXT,
  description TEXT,
  auto_or_editorial TEXT DEFAULT 'auto',
  right_of_reply_sent_at TEXT,
  response_received_at TEXT,
  response_text TEXT,
  published_disposition TEXT,
  final_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Editorial scores — one row per server per audit period
CREATE TABLE IF NOT EXISTS tebex_scoring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_period TEXT NOT NULL,
  server_name TEXT NOT NULL,
  catalogue_breadth INTEGER,
  pricing_posture INTEGER,
  pla_alignment INTEGER,
  marketing_honesty INTEGER,
  transparency INTEGER,
  total_score INTEGER,
  rank INTEGER,
  editorial_summary TEXT,
  scored_by TEXT,
  scored_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(audit_period, server_name)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_tebex_products_run ON tebex_products(run_id);
CREATE INDEX IF NOT EXISTS idx_tebex_products_server ON tebex_products(server_name);
CREATE INDEX IF NOT EXISTS idx_tebex_summaries_run ON tebex_summaries(run_id);
CREATE INDEX IF NOT EXISTS idx_tebex_flags_run ON tebex_flags(run_id);
CREATE INDEX IF NOT EXISTS idx_tebex_flags_server ON tebex_flags(server_name);
CREATE INDEX IF NOT EXISTS idx_tebex_scoring_period ON tebex_scoring(audit_period);
CREATE INDEX IF NOT EXISTS idx_tebex_targets_include ON tebex_targets(include_in_audit);

-- ===========================================================================
-- SEED: 12 target servers for the Q2 2026 inaugural audit
-- Uses INSERT OR IGNORE so re-running doesn't duplicate or error on existing.
-- ===========================================================================

INSERT OR IGNORE INTO tebex_targets (server_name, tebex_url, store_type, include_in_audit, editorial_notes) VALUES
('Unmatched RP', 'https://unmatchedrp.tebex.io', 'tebex-standard', 1, 'Serious British RP. Uses Cfx.re login for package claim.'),
('Orbit RP', 'https://orbit-rp.tebex.io', 'tebex-standard', 1, 'Launched 26 Sep 2025 by Stoker. UK-based FiveM RP server.'),
('District 10 (D10)', 'https://district-10-rp.tebex.io', 'tebex-standard', 1, '116k Discord community. Allow-list server.'),
('Exclusive Roleplay', 'https://exclusiveroleplay.tebex.io', 'tebex-standard', 1, 'UK-based explicit. TMC framework.'),
('Time4 RP', 'https://time4-roleplay-store.tebex.io', 'tebex-standard', 1, 'UK-based FiveM server on TMC framework.'),
('Kudos Roleplay', 'https://kudosrp.tebex.io', 'tebex-standard', 1, 'New GTA V RP community. Validate UK status before first scrape.'),
('Fate Roleplay', 'https://fateroleplay.tebex.io', 'tebex-standard', 1, 'Soft-whitelisted RP server. UK status unclear — validate.'),
('ONX RP', 'https://community-store.onx.gg', 'custom', 1, 'Uses custom subdomain. Scraper tries JSON/HTML fallbacks.'),
('The EndZ', '', 'tebex-standard', 0, 'URL not yet discovered — set include=1 once found.'),
('Drill UK RP', '', 'tebex-standard', 0, 'URL not yet discovered — set include=1 once found.'),
('Unique RP', 'https://unique-rp.tebex.io', 'tebex-standard', 0, 'COI — editor in inner circle. Include=0 per /ethics/ disclosure. URL captured for future reference.'),
('Deggy new server (pending)', '', 'tebex-standard', 0, 'New UK server launch pending — name and URL TBD.');

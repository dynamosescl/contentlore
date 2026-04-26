-- ================================================================
-- migrations/006_lore_arcs.sql
-- Long-form storyline arc tracking for UK GTA RP scene.
-- ================================================================

CREATE TABLE IF NOT EXISTS lore_arcs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  summary TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('character','crew','server','rivalry')),
  era TEXT NOT NULL
    CHECK (era IN ('current','recent','historic')),
  server_id TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  crews TEXT,
  beef_ids TEXT,
  weight INTEGER NOT NULL DEFAULT 3
    CHECK (weight BETWEEN 1 AND 5),
  chapters TEXT NOT NULL DEFAULT '[]',
  ai_summary TEXT,
  ai_summary_updated_at INTEGER,
  started TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lore_server ON lore_arcs(server_id);
CREATE INDEX IF NOT EXISTS idx_lore_era ON lore_arcs(era, weight DESC);

-- Seed data from Lovable lore.ts
INSERT OR IGNORE INTO lore_arcs (id, slug, title, hook, summary, kind, era, server_id, participants, crews, beef_ids, weight, chapters, started) VALUES
('lbmm-rise', 'lbmm-rise', 'The Rise of LBMM', 'From corner hustle to the most-watched crew on Unique.', 'LBMM started as a small operation barely anyone tracked. A run of clean heists, a string of well-played beefs and a viewer-pulling cast turned them into the centre of gravity on Unique RP. Their arc now drives most of the server''s headline storylines.', 'crew', 'current', 'unique', '["jeycreates","souljaboy_jrp"]', '["LBMM"]', '["tyrone-vs-lbmm"]', 5, '[{"when":"This week","title":"Tyrone calls them out on stream","body":"After a botched deal went public, Tyrone went on cam naming names. LBMM hasn''t replied in-character yet, which has the timeline guessing what the response looks like."},{"when":"Last month","title":"The vault job","body":"A four-hour heist arc that pulled a five-figure concurrent audience across the cast. Widely treated as the moment LBMM moved from ''one of the crews'' to ''the crew''."},{"when":"Spring 2025","title":"First major beef","body":"Their first server-recognised feud — short, sharp, and resolved on their terms. Marked the first time the wider Unique cast started reacting to LBMM moves."}]', '2025-01-15');

INSERT OR IGNORE INTO lore_arcs (id, slug, title, hook, summary, kind, era, server_id, participants, crews, beef_ids, weight, chapters, started) VALUES
('tng-season-shift', 'tng-season-shift', 'TNG''s identity reset', 'How TNG carved out its own lane after the Unique exodus.', 'When a wave of creators rotated off Unique and onto TNG, the server had a choice: copy the formula or build its own. Admin choices around heat, escalation pacing and crew approvals leaned into a more grounded, cinematic tone — and a new core cast formed around it.', 'server', 'current', 'tng', '["jck0__"]', NULL, NULL, 4, '[{"when":"Recent","title":"Cast stabilises around long-form storylines","body":"TNG''s regulars have settled into multi-stream arcs rather than chasing daily action. The result is a smaller but stickier audience that follows characters across weeks."},{"when":"Spring 2025","title":"The exodus that made room","body":"Several Unique mainstays moved over for a clean slate. The space let new characters land without competing with established Unique IP."}]', '2025-03-01');

INSERT OR IGNORE INTO lore_arcs (id, slug, title, hook, summary, kind, era, server_id, participants, crews, beef_ids, weight, chapters, started) VALUES
('new-era-foundation', 'new-era-foundation', 'New Era RP: building a scene from zero', 'A new server, an open canvas, and the streamers betting on it.', 'New Era launched without the inherited storylines of older servers. Its early arc is the foundation phase — first crews, first cops, first beefs — and the creators choosing to plant flags here are effectively writing the scene''s origin myth in real time.', 'server', 'current', 'new-era', '[]', NULL, NULL, 3, '[{"when":"Now","title":"Founding crews lock in","body":"The first generation of factions is forming. Whoever cements identity now will be referenced for the lifetime of the server."},{"when":"Launch","title":"Server opens","body":"A small, deliberate launch with a focus on grounded RP and slower escalation than the bigger UK servers."}]', '2025-09-01');

INSERT OR IGNORE INTO lore_arcs (id, slug, title, hook, summary, kind, era, server_id, participants, crews, beef_ids, weight, chapters, started) VALUES
('orbit-revival', 'orbit-revival', 'Orbit RP''s quiet comeback', 'After a fallow stretch, Orbit''s regulars are rebuilding the room.', 'Orbit went through a long quiet period where the active roster shrank and storylines stalled. A core group has been quietly putting in hours, rebuilding the daily rhythm of the server one scene at a time.', 'server', 'recent', 'orbit', '[]', NULL, NULL, 2, '[{"when":"Recent","title":"Daily rhythm returns","body":"There''s a recognisable cast on most nights again. Not loud yet, but consistent — and consistency is what brings the bigger names back."}]', '2025-08-01');

INSERT OR IGNORE INTO lore_arcs (id, slug, title, hook, summary, kind, era, server_id, participants, crews, beef_ids, weight, chapters, started) VALUES
('unmatched-launch', 'unmatched-launch', 'Unmatched RP picks a lane', 'A newer entrant aiming for the gap between Unique and TNG.', 'Unmatched is positioning between the chaos of Unique and the slower burn of TNG. Whether that lane has enough oxygen is the open question — the next two months of arcs will decide it.', 'server', 'current', 'unmatched', '[]', NULL, NULL, 2, '[{"when":"Now","title":"Identity test phase","body":"Founding crews are still being approved. The early storylines will set the tone for everything after."}]', '2025-10-01');

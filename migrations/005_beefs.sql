-- ================================================================
-- migrations/005_beefs.sql
-- Beef/rivalry tracking for UK GTA RP scene.
-- ================================================================

CREATE TABLE IF NOT EXISTS beefs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  summary TEXT NOT NULL,
  server_id TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  crews TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('cooking','active','settled','cold')),
  heat INTEGER NOT NULL DEFAULT 3
    CHECK (heat BETWEEN 1 AND 5),
  beats TEXT NOT NULL DEFAULT '[]',
  started TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_beefs_status ON beefs(status, heat DESC);
CREATE INDEX IF NOT EXISTS idx_beefs_server ON beefs(server_id);

-- Seed data from Lovable beef.ts
INSERT OR IGNORE INTO beefs (id, slug, title, hook, summary, server_id, participants, crews, status, heat, beats, started) VALUES
('tyrone-vs-lbmm', 'tyrone-vs-lbmm', 'Tyrone vs LBMM', 'Two of Unique''s biggest characters trading shots after a botched deal.', 'What started as a business arrangement on Unique RP turned sideways after a missing shipment. Both sides have publicly accused the other and the wider crews are now picking corners.', 'unique', '["tyrone","lbmm"]', NULL, 'active', 5, '[{"when":"This week","what":"Tyrone called LBMM out live on stream, named names."},{"when":"Last week","what":"Shipment goes missing — neither side admits to taking it."},{"when":"2025-03-12","what":"Original deal goes down between the two crews."}]', '2025-03-12');

INSERT OR IGNORE INTO beefs (id, slug, title, hook, summary, server_id, participants, crews, status, heat, beats, started) VALUES
('stoker-deggy-cold-war', 'stoker-deggy-cold-war', 'Stoker vs DeggyUK', 'Old grudge from Unique reignited on a chance encounter.', 'Stoker and Deggy have history going back months. A run-in at the docks reopened everything that was supposedly settled.', 'unique', '["stoker","deggyuk"]', NULL, 'cooking', 3, '[{"when":"This week","what":"Awkward standoff at the docks — no shots fired, but words exchanged."},{"when":"2025-04-02","what":"First confirmed sighting of both on-server since the truce."}]', '2025-04-02');

INSERT OR IGNORE INTO beefs (id, slug, title, hook, summary, server_id, participants, crews, status, heat, beats, started) VALUES
('samham-megsmary', 'samham-megsmary', 'SamHam vs MegsMary', 'Civ-side drama that''s bleeding into the criminal scene.', 'A civ-side disagreement over a shared property has escalated. Both have pulled in friends and the situation now spans multiple sessions.', 'unique', '["samham","megsmary"]', NULL, 'active', 4, '[{"when":"This week","what":"MegsMary moves out, takes the keys with her."},{"when":"Last week","what":"Public argument outside the property — clipped everywhere."}]', '2025-03-28');

INSERT OR IGNORE INTO beefs (id, slug, title, hook, summary, server_id, participants, crews, status, heat, beats, started) VALUES
('tng-turf', 'tng-turf', 'Reeclare crew vs Bags crew', 'TNG turf dispute heating up after a drive-by.', 'TNG''s east side has been contested for weeks. A drive-by attributed to Bags'' crew has Reeclare''s people promising response.', 'tng', '["reeclare","bags"]', '["East Side","Bags Crew"]', 'active', 4, '[{"when":"This week","what":"Drive-by on Reeclare''s safehouse. No casualties, plenty of shells."},{"when":"Last week","what":"Territory line redrawn after a meeting goes nowhere."}]', '2025-03-20');

INSERT OR IGNORE INTO beefs (id, slug, title, hook, summary, server_id, participants, crews, status, heat, beats, started) VALUES
('orbit-newbies', 'orbit-newbies', 'Cherish_Remedy vs JustJ0hnnyHD', 'Orbit RP newcomers running into each other constantly.', 'Two of Orbit''s louder personalities keep ending up in the same scenes. Half the server thinks it''s bait, the other half thinks it''s real.', 'orbit', '["cherish_remedy","justj0hnnyhd"]', NULL, 'cooking', 2, '[{"when":"This week","what":"Third coincidental run-in in five days. People are noticing."}]', '2025-04-10');

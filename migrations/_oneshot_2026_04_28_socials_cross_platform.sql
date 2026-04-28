-- One-shot socials backfill for confirmed cross-platform handles
-- (run 2026-04-28; not part of the standard migration sequence —
-- file kept for audit, but `wrangler d1 execute` was used directly).
--
-- Verified via /api/admin/scout: every handle below has a confirmed
-- account on the other platform under the same slug.

-- Kick-primary creators who also have a Twitch account
UPDATE curated_creators SET socials = json_set(socials, '$.twitch', 'dcampion')    WHERE handle = 'dcampion';
UPDATE curated_creators SET socials = json_set(socials, '$.twitch', 'elliewaller') WHERE handle = 'elliewaller';
UPDATE curated_creators SET socials = json_set(socials, '$.twitch', 'kavsual')     WHERE handle = 'kavsual';
UPDATE curated_creators SET socials = json_set(socials, '$.twitch', 'shammers')    WHERE handle = 'shammers';

-- Twitch-primary creators who also have a Kick account
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'reeclare')         WHERE handle = 'reeclare';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'absthename')       WHERE handle = 'absthename';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'deggyuk')          WHERE handle = 'deggyuk';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'essellz')          WHERE handle = 'essellz';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'fantasiasfantasy') WHERE handle = 'fantasiasfantasy';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'lbmm')             WHERE handle = 'lbmm';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'megsmary')         WHERE handle = 'megsmary';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'rexality')         WHERE handle = 'rexality';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'samham')           WHERE handle = 'samham';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'steeel')           WHERE handle = 'steeel';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'stoker')           WHERE handle = 'stoker';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'tazzthegeeza')     WHERE handle = 'tazzthegeeza';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'tyrone')           WHERE handle = 'tyrone';
UPDATE curated_creators SET socials = json_set(socials, '$.kick', 'wheelydev')        WHERE handle = 'wheelydev';

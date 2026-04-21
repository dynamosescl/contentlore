# ContentLore · Deploy Pack — April 2026 Session

Twelve files from today's build session. Unzip this over your local
`contentlore` repo root and commit.

## Files included

Modified (7):
- index.html                                          (homepage)
- styles.css                                          (+ Discovery Engine, Claim CTA, skeleton blocks appended at end)
- assets/pulse.js                                     (60-second polling, better error state)
- functions/api/admin/creators/enrich-all.js          (rewritten — scene voice, categorised errors, logging)
- functions/creator/[slug].js                         (Discover link in sidebar nav)
- functions/claim/index.js                            (Discover link in sidebar nav)
- functions/people/index.js                           (Discover link in sidebar nav + Claim CTA banner)

New (5):
- assets/discover.js                                  (Discovery Engine client-side filter logic)
- assets/homepage-stats.js                            (live homepage stat numbers)
- functions/api/discover.js                           (Discovery Engine API)
- functions/api/stats.js                              (homepage headline stats API, KV-cached 5 min)
- functions/discover/index.js                         (/discover/ page)

## How to deploy

1. Unzip into repo root. Confirms match the list above.
2. `git status` — should show 7 modified, 5 new.
3. Commit. Push to the branch Cloudflare Pages deploys from.
4. Cloudflare Pages auto-deploys. No schema changes. No new env vars.

## What to check on the live site

1. Homepage — fonts should now render in Newsreader + Anton (not Fraunces).
   Byline says "Dynamoses". Scene Pulse shows shimmer skeleton while loading.
   Paper-section numbers update from hard-coded → live after a beat.

2. /discover/ — highest-risk new page. If it 500s, the SQL in
   functions/api/discover.js is the suspect (two CTEs + joins).

3. /people/ — grid looks same; new Claim CTA banner sits under it.

4. Admin bio enrichment — next run surfaces categorised error counts
   in the response JSON. Look for `error_counts.claude_empty_response`
   to confirm the silent-failure diagnosis.

## Rollback

If /discover/ breaks specifically, revert:
- functions/api/discover.js
- functions/discover/index.js
- assets/discover.js
- The 4 sidebar nav changes (index.html + 3 .js pages)
- The CSS append blocks in styles.css

Everything else in this pack is additive and self-contained.

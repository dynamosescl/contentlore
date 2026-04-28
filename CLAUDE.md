# ContentLore — Project Bible

A living document for anyone (or any agent) working on this repo. Update as the project evolves.

---

## 1. Project Overview

**ContentLore** is a UK GTA RP streaming intelligence platform. It tracks a curated 26-creator allowlist across Twitch and Kick, surfaces who's live, and provides a multi-stream viewer for the UK roleplay scene. The differentiator vs. competitors (HasRoot, StreamsCharts, etc.) is **UK-scene focus** — none of them specialise in British GTA RP.

**Stack**
- **Hosting:** Cloudflare Pages (static + Functions) at `contentlore.com`
- **Database:** Cloudflare D1 (`contentlore-db`, id `fda318fa-b2d2-46d3-a9ba-eb522e516763`)
- **KV cache:** namespace id `f6c05b65a4e84c5baba997122ebcc8c6`
- **Scheduler:** separate Cloudflare Worker at `contentlore-scheduler.dynamomc2019.workers.dev` (cron `*/15 * * * *`), shares the same D1 + KV
- **Repos:**
  - Main site: `D:/contentlore` → `github.com/dynamosescl/contentlore.git`
  - Scheduler worker: `D:/contentlore-scheduler` (NOT a git repo locally — deploy via `npx wrangler deploy`)

**Key URLs**
- `https://contentlore.com/` — homepage
- `https://contentlore.com/gta-rp/` — live hub (the curated 26)
- `https://contentlore.com/gta-rp/now/` — real-time scene ticker
- `https://contentlore.com/gta-rp/multi/` — 6-tile multi-view
- `https://contentlore.com/gta-rp/clips/` — Clip Wall (Twitch clips, masonry)
- `https://contentlore.com/gta-rp/timeline/` — scene activity Gantt
- `https://contentlore.com/gta-rp/analytics/` — viewer trends, scene heatmap, server popularity, follower-trend sparklines
- `https://contentlore.com/gta-rp/network/` — interactive force-directed creator graph
- `https://contentlore.com/gta-rp/digest/` — auto-generated weekly scene digest
- `https://contentlore.com/gta-rp/streaks/` — opt-in daily-visit tracker
- `https://contentlore.com/gta-rp/servers/` — RP server status board
- `https://contentlore.com/gta-rp/fivem-enhanced/` — FiveM Enhanced migration tracker
- `https://contentlore.com/gta-rp/gta-6/` — platform deep-dive
- `https://contentlore.com/creator-profile/{handle}` — per-creator profile (dynamic Function)
- `https://contentlore.com/submit/` — public creator submission form (rate-limited 3/IP/day)
- `https://contentlore.com/mod/` — admin dashboard (requires `ADMIN_TOKEN`)
- `https://contentlore.com/admin/content.html` — beef + lore editor
- `https://contentlore.com/admin/discovery.html` — pending creator triage
- `https://contentlore-scheduler.dynamomc2019.workers.dev/status` — last poll/session summaries

---

## 2. Current State

**Active hub surfaces (18):**
- Static pages (14): `/`, `/submit/`, `/gta-rp/{,now/,multi/,clips/,timeline/,analytics/,network/,digest/,streaks/,servers/,fivem-enhanced/,gta-6/}`
- Admin pages (3): `/mod/`, `/admin/content.html`, `/admin/discovery.html`
- Dynamic page (1): `/creator-profile/{handle}` rendered by `functions/creator-profile/[handle].js`

Every hub page is now a PWA candidate — manifest linked, theme-color set, service worker registered via `/pwa.js`. Mobile (<=768px) gets a fork of `/gta-rp/multi/` (single stream + chat below + bottom tabbar + roster bottom-sheet); the global nav collapses to a hamburger drawer at <=900px.

The repo also contains several legacy directories (`about/`, `contact/`, `creators/`, `ethics/`, `ledger/`, `rising/`, `signals/`, `the-platform/`, `gta-rp/beef/`, `gta-rp/lore/`) that survived the 2026-04-26 cleanup sweep but aren't part of the active navigation. They serve via `_redirects` catch-all if anyone deep-links them. Worth a re-audit eventually.

**Active Pages Functions (28, plus 1 helper):**

| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/uk-rp-live` | `api/uk-rp-live.js` | Curated 26 live state with full multi-platform `socials` per entry (direct platform APIs, 30s Cache API) |
| `GET /api/live-now` | `api/live-now.js` | DB-backed live list (anyone in `creators` table) |
| `GET /api/clips?range=24h\|7d\|30d` | `api/clips.js` | Top Twitch clips for the 20 Twitch handles, GTA V + Just Chatting filtered, 5-min Cache API |
| `GET /api/timeline?range=today\|yesterday\|7d` | `api/timeline.js` | `stream_sessions` rows overlapping window for the 26, server-id annotated, 5-min Cache API |
| `GET /api/analytics` | `api/analytics.js` | 7d hourly viewer buckets, 7×24 heatmap, server-hours bars, week-over-week growth, 30d follower trend per creator. 5-min Cache API |
| `GET /api/network` | `api/network.js` | Curated-26 nodes (avg viewer weight) + curated-only edges from `creator_edges`. 5-min Cache API |
| `GET /api/digest` | `api/digest.js` | "This week in UK GTA RP" report — peak moment, top creators, top clips (delegates to `/api/clips?range=7d`), new pending_creators, server hours. 10-min Cache API |
| `GET /api/cfx-populations` | `api/cfx-populations.js` | Live FiveM player counts for 5 known server CFX IDs, 60s Cache API |
| `GET /api/scene-averages` | `api/scene-averages.js` | 7-day avg streamers/viewers per server from `scene_snapshots`, 5-min Cache API. Powers the "Avg" column on the servers status board |
| `POST /api/streaks/check-in` | `api/streaks/check-in.js` | Idempotent daily-visit increment (anonymous UUID), badge state |
| `GET /api/streaks/leaderboard?order=current\|max` | `api/streaks/leaderboard.js` | Top opt-in users with display names, 5-min Cache API |
| `GET\|POST /api/gta6-pulse` | `api/gta6-pulse.js` | Anonymous one-vote-per-device GTA 6 readiness poll, 30s Cache API tallies |
| `GET /api/push/vapid-public-key` | `api/push/vapid-public-key.js` | Hands `env.VAPID_PUBLIC_KEY` to clients for `pushManager.subscribe()` |
| `POST /api/push/subscribe` | `api/push/subscribe.js` | Upserts a `push_subscriptions` row keyed by endpoint (idempotent re-subscribes) |
| `POST /api/push/unsubscribe` | `api/push/unsubscribe.js` | Deletes a subscription by endpoint (anon — endpoint is the secret) |
| `POST /api/submit` | `api/submit.js` | Public creator-submission endpoint. KV-rate-limited 3 / IP / UTC day. Inserts into `pending_creators` with `notes` prefixed `SUBMITTED:` |
| `GET /api/creators` | `api/creators.js` | Paged creator directory (D1) |
| `GET /api/stats` | `api/stats.js` | Aggregate counters (D1) |
| `GET /api/beefs` | `api/beefs.js` | Editorial beef list (D1) |
| `GET /api/lore-arcs` | `api/lore-arcs.js` | Editorial lore arc list (D1) |
| `* /creator-profile/{handle}` | `creator-profile/[handle].js` | Server-rendered profile page (HTML response). Renders the multi-platform PLATFORMS section from `entry.socials`. |
| `GET\|POST /api/admin/discovery` | `api/admin/discovery.js` | Pending creator triage (Bearer auth) |
| `GET\|POST /api/admin/submissions` | `api/admin/submissions.js` | List + approve/reject form submissions (Bearer auth). Filters by the `SUBMITTED:` notes prefix. |
| `GET\|POST /api/admin/beef` | `api/admin/beef.js` | Beef CRUD (Bearer auth) |
| `GET\|POST /api/admin/lore` | `api/admin/lore.js` | Lore arc CRUD (Bearer auth) |
| `GET\|POST /api/admin/backfill-avatars` | `api/admin/backfill-avatars.js` | One-shot Twitch avatar backfill (Bearer auth) |
| `GET\|POST /api/admin/discord-test` | `api/admin/discord-test.js` | Discord webhook config status + test embed (Bearer auth) |
| _helper_ | `_lib.js` | `jsonResponse`, `getTwitchToken`, `getKickToken`, `fetchKickChannel`, etc. |

**26-creator allowlist** (source of truth: `functions/api/uk-rp-live.js`; mirrored in `contentlore-scheduler/src/discovery.js` as `ALLOWLIST_HANDLES`)
- 20 Twitch primary: tyrone, lbmm, reeclare, stoker, samham, deggyuk, megsmary, tazzthegeeza, wheelydev, rexality, steeel, justj0hnnyhd, cherish_remedy, lorddorro, jck0__, absthename, essellz, lewthescot, angels365, fantasiasfantasy
- 6 Kick primary: kavsual, shammers, bags, dynamoses, dcampion, elliewaller
- Confirmed multi-platform (entry has both `socials.twitch` AND `socials.kick` populated): **dynamoses**, **bags** (both have D1 platform rows on both sides per migration 010)

Each ALLOWLIST entry now carries a `socials: { twitch, kick, tiktok, youtube, x, instagram, discord }` object with seven fixed slots — each either a username string (no @, no full URL) or null. Discord is the exception: it stores a full invite URL since `discord.gg/{code}` codes are opaque. The shape is fixed so consumers iterate predictably without null-guarding the object itself. TikTok / YouTube / X / Instagram are all null today — populated as creators submit them via `/submit/` or via manual edits to the allowlist file.

**13 RP servers tracked** (source of truth: `SERVERS` array in `gta-rp/servers/index.html`, mirrored in `functions/api/cfx-populations.js` for live populations). Mix of UK-founded servers (Unique, TNG, Orbit, Drill UK, British Life, The Ends) and American servers UK creators play on (New Era, Prodigy, D10, Chase, plus the rest with mixed/unverified origin). Don't blanket-label as "UK servers" — it's not accurate.
- With known CFX IDs (5): Unique RP `ok4qzr`, Orbit RP `5j8edz`, Unmatched RP `r43qej`, New Era RP `z5okp5`, Prodigy RP `775kda`
- CFX ID unknown / private (8): TNG, D10, Chase, VeraRP, The Ends RP (formerly The Endz), Let's RP, Drill UK, British Life RP

**D1 tables** (verified 2026-04-27 against prod schema)
- `creators` (id, display_name, role, bio, categories, origin_story, avatar_url, accent_colour, created_at, updated_at)
- `creator_platforms` (creator_id, platform, handle, platform_id, is_primary, verified, verified_at — PK on creator_id+platform)
- `creator_edges` (raid/host/shoutout social graph)
- `snapshots` (per-poll observations of live state)
- `stream_sessions` (derived sessions from snapshots — actively growing as `pollCurated` writes 26 fresh rows per tick)
- `scene_snapshots` (server-clustered scene captures — actively populating; first rows produced 2026-04-27 18:33 UTC after the curated polling pass landed. ~4 server rows per tick during peak hours.)
- `pending_creators` (discovery triage — currently 5 rows after the 2026-04-27 cleanup of US leaks; refills on each cron tick when fresh UK GTA RP candidates appear)
- `beefs`, `lore_arcs` (editorial)
- `watch_streaks` (Phase 3 — anon UUID, current/max streak, total_visits, optional display_name)
- `gta6_pulse_votes` (Phase 4 — anon UUID, choice ∈ {ready, optimistic, worried, not-thinking}, voted_at)
- `push_subscriptions` (Phase 5 PWA — endpoint UNIQUE, p256dh, auth, user_uuid, filter_handles. Migration `011_push_subscriptions.sql`. Driven by the scheduler's `pollCurated` go-live transition path via `src/web-push.js`)

**Data pipeline:** Scheduler worker (every 15 min) runs four steps in order:
1. `pollCurated` — batched Twitch + Kick fetch for **all 26 curated creators**, writes one snapshot per creator (~3.5s). After writes, diffs current liveness against `curated:livestate:v1` in KV; for each offline → online transition, calls `notifyGoLive` (`src/discord.js`) which posts a rich embed to `env.DISCORD_WEBHOOK_URL`. Then persists the new livestate blob for next-tick comparison. First-tick-ever liveness is treated as "was offline" so deploying on a busy day doesn't spam the channel.
2. `rebuildSessions` — stitches new snapshots into `stream_sessions`.
3. `captureSceneSnapshots` — groups currently-live curated streams by detected RP server, writes one row per active server.
4. `discoverCreators` — scans top 300 GTA V Twitch streams for new UK RP candidates, writes to `pending_creators`.

(The legacy round-robin `runPollingPass` step was removed — `pollCurated` covers all 26 curated creators every tick, and the long-tail pool wasn't producing useful data on a 6.7-day cadence. If you re-add it, wire it back into `src/index.js`.)

`/api/uk-rp-live` bypasses D1 entirely and queries Twitch + Kick official APIs directly for the 26 allowlisted creators (30s KV cache).

---

## 3. Competitive Landscape

**HasRoot** (`gtarp.hasroot.com`) is the closest competitor — US-focused, tracks NoPixel + 20 other servers. Features ContentLore doesn't have yet:
- ~~Clip Activity Feed~~ ✅ shipped (Phase 2)
- Clip Search across all tracked creators (clips are filterable by creator on `/gta-rp/clips/`, but no text search yet)
- VOD History browser
- ~~Streamer Activity Timeline~~ ✅ shipped (Phase 2 — `/gta-rp/timeline/`)
- Character Database (who plays which character on which server) — Phase 5
- Server-specific subdomains
- Streamer Login (creators claim their profile) — Phase 2 follow-up
- Browser push notifications when tracked creators go live — Phase 5

**Other analytics platforms:**
- **StreamsCharts** — multi-platform live stats
- **SullyGnome** — Twitch deep analytics
- **TwitchTracker** — Twitch stats and charts
- **GTA Genius** — GTA RP specific

**Niche advantage:** none of them focus on the UK scene. That's our wedge — be the definitive UK GTA RP discovery + intelligence surface.

---

## 4. Platform Expansion

The site currently tracks Twitch + Kick. Expansion plan:

**Kick — official API (DONE in Phase 1)**
Migrated from v1/v2 endpoint scraping to the official `api.kick.com/public/v1` API with OAuth 2.1 in commit `cb27388`. Both `functions/api/uk-rp-live.js` and `contentlore-scheduler/src/polling.js` now use the official endpoint. `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` set in env.

**Known Kick API limitations** (verified against `docs.kick.com/sitemap.md` 2026-04-27):
- **No clips endpoint.** The Public API exposes only Categories, Users, Channels, Channel Rewards, Chat, Moderation, Livestreams, Public Key, KICKs, FAQs. "KICKs" (`/public/v1/kicks/leaderboard`) is a gifting/tipping leaderboard — *not* video highlights. The Clip Wall (`/api/clips`) is therefore Twitch-only; Kick clips return zero results from `/api/clips` and the Kick clip section on creator profiles renders an explanatory empty state. Re-check Kick docs periodically and wire in when they ship a clips endpoint.
- **No follower count on the Channels endpoint.** `/public/v1/channels` returns subscriber counts (`active_subscribers_count`, `canceled_subscribers_count`) but not follower count, so the scheduler now writes NULL into the `followers` column for every Kick snapshot. Kick follower history will show flat-zero for any new data captured after Phase 1.
- **No avatar on the Channels endpoint.** Profile pictures only come from `/public/v1/livestreams` (i.e. when the broadcaster is live). `/api/uk-rp-live` warms a `kick:avatar:{slug}` KV cache (7-day TTL) the first time each broadcaster appears live, then re-uses it for offline displays.

**TikTok — content discovery layer (planned)**
Most UK GTA RP creators post highlights to TikTok. Display API gives profile info + recent videos. Embed API shows TikTok videos inline. Use for surfacing clips/highlights — not live tracking. Requires TikTok developer registration + app review (3-7 days). Allowlist data structure already includes a `tiktok` field per creator (Phase 1).

**YouTube — long-form content footprint (planned)**
Some creators upload VODs and edited content. YouTube Data API v3 gives channel stats, recent uploads, live stream status. Free tier generous (10,000 quota/day). Useful for creator profiles showing full content footprint. Allowlist data structure already includes a `youtube` field per creator (Phase 1).

---

## 5. Design Direction

**Established (DONE):**
- Site-wide colour: electric blue/cyan `oklch(0.82 0.20 195)` — zero pink remaining
- Fonts: Bebas Neue (display), Inter (body), JetBrains Mono (code)
- Effects: static scanline overlay (`body::before`) on every page. **All flicker/CRT/glitch animations removed site-wide** in commits `1252d9a` and `60c3450` per design call — content-heavy pages were too distracting.
- Logo: CL monogram with play button, 40 KB PNG (was 298 KB pre-Phase-1)
- Admin pages (`admin/content.html`, `admin/discovery.html`) ported to Bebas/oklch
- 12-server colour palette for the Timeline page (Unique=cyan, Orbit=green, TNG=orange, etc — see `SERVER_META` in `gta-rp/timeline/index.html`)

**Outstanding:**
- Mobile-first multi-view layout (single stream + swipeable tabs for chat)
- Picture-in-picture pop-out for multi-view tiles
- Hero background videos / motion (was rejected for flicker on text — could revisit for ambient backdrops)
- Card depth (shadow layering, parallax)
- OG image generation per page (Phase 5 social sharing)

---

## 6. Roadmap

`[x]` = done, `[~]` = code complete pending verification, `[ ]` = open, `[—]` = explicitly deferred per product call.

### PHASE 1 — FOUNDATION (DONE)
- [x] Switch to official Kick API in both `functions/api/uk-rp-live.js` and `contentlore-scheduler/src/polling.js` — `cb27388`
- [x] Fix homepage CRT flicker — `cb27388` (then removed entirely site-wide in `60c3450`)
- [x] Compress `logo.png` (298 KB → 40 KB via System.Drawing resize) — `cb27388`
- [x] Move stream thumbnail `{width}x{height}` substitution server-side in `uk-rp-live` — `cb27388`
- [x] Add cache headers to hot endpoints (`s-maxage=20` on `uk-rp-live` and `live-now`) — `cb27388`
- [x] Add TikTok + YouTube handle fields to allowlist data structure — `cb27388`
- [x] Port `admin/content.html` and `admin/discovery.html` to Bebas/oklch — `cb27388`
- [x] Schema-verify `/api/admin/discovery` approve flow against live D1 — `cb27388`. Full live-POST smoke test still deferred (pending_creators is empty in prod, no candidate to approve safely).
- [x] Delete `migrations/007_scene_snapshots.sql` (conflict with 004) — `7d02190`
- [x] Scheduler: replace broken Kick HTML regex — superseded by Phase 1 official-API migration

### PHASE 2 — ENGAGEMENT (DONE)

- [x] **Clip Wall** — `/gta-rp/clips/` masonry grid + `/api/clips?range=24h|7d|30d`. Twitch-only (Kick has no clips API — see Section 4). Filtered to GTA V + Just Chatting. Modal player with embed, share-link button. CSP allows `clips.twitch.tv` for the iframe.
- [x] **Creator Profiles** — `/creator-profile/{handle}` server-rendered HTML via `functions/creator-profile/[handle].js`. Hero, conditional live banner with embed, multi-platform link row, stats from `stream_sessions` (90-day window, weighted-avg viewers), server affinity chips, top 6 recent clips with cold-cache fallback to `/api/clips?range=30d`.
- [x] **Server Status Dashboard** — `/gta-rp/servers/` rebuilt as departures-board: Server / Status (UP·IDLE) / **Players** (live CFX populations, Phase 2 follow-up) / Streamers / Viewers / Top Streamer. Auto-refresh 60s. **Peak Today column omitted** — `scene_snapshots` is empty in prod.
- [x] **Scene Timeline / "What Happened Today"** — `/gta-rp/timeline/` Gantt visualisation per creator from `stream_sessions` + `/api/timeline?range=today|yesterday|7d`. Server-coloured bars (12-server palette), hover tooltip, ongoing sessions pulse. Summary stats: total hours, peak concurrent (sweep-line), most active server, busiest local hour.
- [x] **CFX live populations** (Phase 2 follow-up) — `/api/cfx-populations` fetches `clients/sv_maxclients` from `servers-frontend.fivem.net` for 5 servers with known CFX IDs (Unique, Orbit, Unmatched, New Era, Prodigy). Server-side because the FiveM master has no CORS. 60s KV cache.

#### Multi-View Improvements
- [x] Stream info bar — persistent below each tile (creator/game/viewers/uptime), separate from the top-overlay badges
- [x] Layout presets — 1×1 (Focus), 2×1 (Duo), 2×2 (Quad), 3×2 (Six). Caps selected count and trims by viewer rank when shrinking.
- [x] Persistent selections — `localStorage` keys `cl:multi:selected:v1` and `cl:multi:layout:v1`
- [x] Better empty state — live-creator thumbnail cards with one-click "+ Add to stage" replacing the text fallback
- [x] URL share — `?add=tyrone,stoker` (comma-list or repeated `?add=`) overrides saved selection on load
- [x] **Detachable chat drawer** (commit `e3b97a6`) — replaced the 340px sidebar + per-tile chat experiments with a fixed right-side drawer (380px, full viewport height minus nav). Tabs across the top let you switch which creator's chat is loaded. Mobile (<900px) becomes a bottom-up sheet. State (open/closed + active tab) persists in localStorage. Per-tile `💬 Chat` button pops the drawer focused on that streamer.
- [x] Bigger tiles in Focus mode — drawer-closed Focus mode now stretches to full viewport width (1600px max), no sidebar competing for space.
- [ ] Mobile layout polish — drawer-as-bottom-sheet works, but a dedicated swipe-between-creators flow would be friendlier on phones.
- [ ] Picture-in-picture mode — pop out a stream while browsing other pages.
- [ ] Quick-add from live page — button on each stream card that adds directly to multi-view without navigating.
- [ ] Fix Twitch autoplay warning — ensure iframe is visible before loading `src` to satisfy Twitch's style-visibility requirement.

### PHASE 3 — GAMIFICATION
- [x] **Watch Streaks** — D1 `watch_streaks` table, opt-in client (`/streak-checkin.js` defer-loaded on hub pages), `POST /api/streaks/check-in` (idempotent within UTC day) + `GET /api/streaks/leaderboard`, `/gta-rp/streaks/` page with stats card, 3 badges (Week Warrior 7d / Month Regular 30d / Scene Veteran 100d), and current-vs-all-time leaderboard. Anonymous by default; display name optional and only required to appear on the leaderboard. Migration `008_watch_streaks.sql` applied to prod.
- [x] **"Who Should I Watch?" Randomiser** — slot-machine modal on `/gta-rp/`. Deceleration animation 60ms→420ms over ~2s, locks onto a random live creator with flash + glow. Reveal card has Watch Now / Spin Again / Profile actions. Time-of-day-aware empty state when nobody is live.
- [—] **Predictions / Polls** — deferred (needs community traction first)
- [—] **RP Awards** — deferred (needs community traction first)
- [—] **Scene Bingo** — deferred (needs community traction first)

### PHASE 4 — INTELLIGENCE (data depth) — DONE
- [x] **GTA 6 Deep Dive** — `/gta-rp/gta-6/` rebuilt as a living briefing. Live ticking countdown to 19 Nov 2026 console launch. Latest News feed (release lock, Trailer 3 expectations, FiveM 202k Steam record, Cfx Platform Licence update, Project ROME rumour, UK scene posture). Updated Impact Matrix + Transition Scenarios reflecting Cfx.re/Rockstar ownership. Community Pulse poll with anonymous one-vote-per-device + live results bars, backed by `gta6_pulse_votes` table (migration 009). Endpoint `GET\|POST /api/gta6-pulse`. Impact calculator ("if X% migrate") still open as a follow-up.
- [x] **Restore `scene_snapshots` capture** — root cause was three-layered: (1) `scenes.js` queried a non-existent `creator_snapshots` table with wrong column names + a US-server registry; (2) even with `scenes.js` fixed, the 26 curated creators weren't in the `creators` table so the round-robin polling never wrote `is_live=1` rows for them; (3) round-robin cadence was ~6.7 days per creator anyway. Full fix shipped: rewrote `scenes.js` against the real schema with the UK 12-server list (commit `76fda06`), backfilled the 20 missing curated creators into `creators`+`creator_platforms` (migration `010_backfill_curated.sql`), added `pollCurated()` step to the scheduler that batched-polls all 26 every tick (commit `e24152f`). First scene rows landed 2026-04-27 18:33 UTC, ~4 server rows per tick during peak hours.
- [x] **FiveM Enhanced Deep Dive** (`cd91188`) — `/gta-rp/fivem-enhanced/` rebuilt with three concrete data layers: framework compatibility matrix (ESX testing, QBCore + QBOX ready), per-server migration tracker for all 12 UK servers with Last Checked dates, technical changelog grounded in the Cfx.re Creator Platform Licence reissue, OneSync Infinity defaulting on, scheduler tightening, and the 202k Steam record. Replaces the placeholder "Monitoring" briefing. Creator-impact section discusses migration risk by stream type and income volatility.
- [x] **Historical Analytics** (`cc2cb2a`) — `/gta-rp/analytics/` + `/api/analytics`. Inline-SVG line chart for hour-bucketed total concurrent viewers across the 26 over 7d, 7×24 heatmap (avg viewers by dow×hour-of-day UTC) with six tinted intensity buckets, horizontal bars for viewer-hours per detected UK server, week-over-week growth card grid, "Data accumulates over time" notice when sample size <24 buckets. No external chart library.
- [x] **Creator Network Graph** (`326704e`) — `/gta-rp/network/` + `/api/network`. Pure-SVG force-directed simulation (Coulomb repulsion + spring attraction + center gravity, 380 iterations, cooling step cap), node radius scales with 30d avg viewers, edge colour by interaction type (raid=cyan, host=green, shoutout=amber, mention=violet, co-stream=neutral). Click a node to focus its neighbourhood — others fade, detail card lists the connected creators with edge type, weight and last-seen date. Stats strip: nodes / edges / most-connected / density %. Empty-state when `creator_edges` is sparse: shows the 26 nodes with a "data is building" message rather than a broken canvas.
- [x] **Weekly Scene Digest** (`50dbf48`) — `/gta-rp/digest/` + `/api/digest`. Headline panel with peak viewership moment of the week (creator, platform, ts, stream title) flanked by 4 KPIs — total hours, unique creators live, most active server with viewer-hours sub-line, total session count. Hours leaderboard (top 5). Top 5 clips of the week (delegates to `/api/clips?range=7d` server-side). New Creators Discovered (pending_creators rows from last 7d). Rolling 7-day window — refreshed per request, 10-min Cache API hit.
- [x] **Creator Growth Tracker** (`ad04b4e`) — first half ("Fastest Growing This Week") landed in the analytics commit; this commit added per-creator follower-trend sparklines (30d, daily-bucketed) to `/gta-rp/analytics/`. Cards show first → last follower count + delta %, sorted by absolute delta. Kick rows surface the Public-API limitation honestly ("API limitation" sub-line) rather than appearing as flat-zero trends.

### PHASE 5 — GROWTH (external reach)
- [x] **Discord Bot** (`e7b1491` Pages-side; scheduler shipped to prod the same day) — Pages-side admin endpoint `GET\|POST /api/admin/discord-test` (Bearer-authed, GET returns config status with masked URL, POST sends a test embed). Scheduler-side `src/discord.js` exports `notifyGoLive(env, transitions[])` which posts rich embeds (Twitch purple / Kick green colour-coded, profile URL, stream title, viewers, category). `pollCurated` diffs current liveness against `curated:livestate:v1` in KV and fires `notifyGoLive` for every offline → online transition; first-tick-ever liveness is treated as offline so deployments don't spam the channel. **Confirmed firing in production 2026-04-28** — ABsTheName + Angels365 go-live embeds appeared in the configured Discord channel.
- [x] **Social Sharing — OG meta tags** (`6305eb9`) — every hub page ships og:type / og:site_name / og:title / og:description / og:image / og:url plus Twitter card counterparts, all pointing at `/logo.png`. Per-page generated OG images (with live data) still on the roadmap below.
- [x] **Mobile PWA** (`0456b66`, `c21cb63`, `3efba8e`, `dff7b86`) — Four-part build:
  - **Manifest + service worker + install prompt** (`0456b66`): `manifest.json` with teal theme, four shortcuts (Live, Multi, Timeline, Digest), 192/180/512 icons. `sw.js` does cache-first for static shell, network-first for HTML with offline fallback, pure-network for `/api/*`. `pwa.js` registers the SW, tracks visit count, surfaces a dismissable install banner from visit 2 onward (Chromium beforeinstallprompt + iOS Safari "Add to Home Screen" hint). `_headers` updated with `Service-Worker-Allowed: /` for root scope.
  - **Mobile multi-view** (`c21cb63`): At <=768px, `/gta-rp/multi/` swaps the desktop grid + drawer for a single full-width 16:9 stream + info bar + chat iframe + 64px bottom tabbar with creator-avatar tabs and a "+" button that opens a slide-up roster sheet. iframe cache keys prevent reload churn on the 90s poll. Desktop layout untouched.
  - **Hamburger nav drawer** (`3efba8e`): Single-file change in `pwa.js` injects a hamburger button + 280px right-side slide-in drawer at <=900px on every hub page that has a `nav.nav > .nav-links` structure. Mirrors the page's nav links with active-state preservation, ESC + overlay tap close.
  - **Browser push notifications** (`dff7b86`): `push_subscriptions` table (migration 011), three Pages endpoints (`/api/push/{vapid-public-key,subscribe,unsubscribe}`), and a `<span data-cl-notify>` button hydrator in `pwa.js`. Creator profile pages use `data-cl-notify="<handle>"` for per-creator opt-in; the live hub uses `data-cl-notify="all"` for global opt-in. Scheduler-side `src/web-push.js` does pure-Workers RFC 8291 aes128gcm encryption + ES256 VAPID JWT signing — no npm dependency. `pollCurated`'s transition path now fans out push alongside Discord, prunes 410-Gone endpoints from the table.
- [x] **Multi-platform creator footprint** (`8ad2ef5`) — every ALLOWLIST entry now carries a `socials` object with seven slots (twitch, kick, tiktok, youtube, x, instagram, discord). Creator profile pages render a "PLATFORMS" section with branded buttons + inline-SVG icons + handle subtext per platform. Roster cards on `/gta-rp/` show small brand-coloured pills (TW/KK/YT/TT/X/IG/DC) under each name. The two confirmed dual-platform creators (dynamoses, bags) now render two pills on the roster and two PLATFORMS buttons on their profile.
- [x] **Public creator submission form** (`a0bb8fb`) — `/submit/` GTA-styled form (display name + 5 platform handles + 12 server checkboxes + bio + honeypot) → `POST /api/submit` (no auth, KV-rate-limited 3 / IP / UTC day, dedupe-rejects against `creator_platforms`) → `pending_creators` row with `notes` prefixed `SUBMITTED:` and the full JSON payload. New `/mod/` "Submissions" tab with filter chips (Pending / Approved / Rejected), live pending-count badge on the tab name, per-card preview of platforms + servers + bio + IP + user-agent, and Approve/Reject buttons. Approval just stamps `status='approved'` — wiring the row into the live ALLOWLIST is still a manual deploy step (the array lives in code, not D1, mirrored in 9 places per the gotchas).
- [ ] **Per-page generated OG images** — render shareable cards with live data (e.g. for clips, creator profiles, weekly digest). Today's commit covers the meta-tag scaffolding pointing at the static logo; next step is dynamic image generation.
- [ ] **Character Wiki** — community-contributed character database. Who plays who on which server. Search by character name. Huge for RP — viewers know character names not streamer names.
- [ ] **Sound Alerts** — GTA-themed sound when someone goes live (optional, toggleable). Vice City radio jingle vibes.
- [ ] **Submission → ALLOWLIST automation** — today's submission flow ends at "approved in D1". To actually start tracking an approved creator the allowlist file needs editing + 5 mirrors updated + a deploy. A future automation could read approved submissions from D1 at runtime instead of compile-time, removing the deploy step entirely.

---

## 7. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                               │
│   Twitch helix    Kick public/v1 (OAuth)    FiveM master server    │
│   (Future: TikTok Display API, YouTube Data API v3)                │
└──────┬────────────────────┬───────────────────────┬────────────────┘
       │                    │                       │
       ▼                    ▼                       ▼
┌─────────────────────────┐  ┌──────────────────────────────────────┐
│  contentlore-scheduler  │  │  Pages Functions (live, per-request) │
│  (Cloudflare Worker)    │  │   /api/uk-rp-live    (curated 26)    │
│  cron */15 * * * *      │  │   /api/clips         (Twitch helix)  │
│                         │  │   /api/cfx-populations (FiveM master)│
│  curated → snapshots    │  │   /api/streaks/check-in  (D1 write)  │
│             (all 26/tick)│  │   /api/push/{vapid-public-key,      │
│   ↳ diff livestate KV   │  │              subscribe,unsubscribe} │
│   ↳ Discord webhook     │  │   /api/submit        (public, KV RL) │
│      on go-live         │  │  30s–600s Cache API / KV-cached      │
│   ↳ Web Push fanout     │  └──────────────┬───────────────────────┘
│      on go-live         │                 │
│  sessions → stream_     │                 │
│             sessions    │                 │
│  scenes  → scene_       │                 │
│             snapshots   │                 │
│  discovery → pending_   │                 │
│              creators   │                 │
└──────────┬──────────────┘                 │
           │                                │
           ▼                                │
┌──────────────────────────┐                │
│  D1: contentlore-db      │                │
│   creators               │                │
│   creator_platforms      │                │
│   creator_edges          │                │
│   snapshots              │                │
│   stream_sessions        │                │
│   scene_snapshots        │                │
│   pending_creators       │                │
│   beefs, lore_arcs       │                │
│   watch_streaks (Ph3)    │                │
│   gta6_pulse_votes (Ph4) │                │
│   push_subscriptions(Ph5)│                │
└──────────┬───────────────┘                │
           │                                │
           ▼                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Pages Functions (read-side, D1-backed)                            │
│   /api/live-now          DB-backed live list                       │
│   /api/timeline          stream_sessions overlap window            │
│   /api/analytics         hourly viewers + heatmap + server hours + │
│                          weekly growth + 30d follower trend        │
│   /api/network           creator-edges + curated-26 nodes          │
│   /api/digest            "this week" report card                   │
│   /api/streaks/leaderboard   watch_streaks ranking                 │
│   /api/creators, /api/stats, /api/beefs, /api/lore-arcs            │
│   /api/admin/*           Bearer-token write surface                │
│   /creator-profile/[h]   Server-rendered profile HTML              │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Static HTML pages                                                 │
│   /                   homepage           (live-now)                │
│   /submit/            channel submission (submit)                  │
│   /gta-rp/            curated hub        (uk-rp-live)              │
│   /gta-rp/now/        scene ticker       (live-now)                │
│   /gta-rp/multi/      6-tile player + mobile fork (uk-rp-live)     │
│   /gta-rp/clips/      Clip Wall          (clips)                   │
│   /gta-rp/timeline/   scene Gantt        (timeline)                │
│   /gta-rp/analytics/  scene analytics    (analytics)               │
│   /gta-rp/network/    creator graph      (network)                 │
│   /gta-rp/digest/     weekly digest      (digest)                  │
│   /gta-rp/streaks/    daily-visit ranks  (streaks/*)               │
│   /gta-rp/servers/    status board       (uk-rp-live + cfx-pops)   │
│   /gta-rp/fivem-enhanced/  migration tracker                       │
│   /gta-rp/gta-6/      intel deep-dive                              │
│   /mod/, /admin/*     admin surface                                │
│                                                                    │
│   PWA: every page links manifest.json + loads /pwa.js (deferred):  │
│     • /sw.js          shell cache + push handler                   │
│     • install prompt  fires on visit 2+, dismissable               │
│     • hamburger nav   <=900px slide-in drawer                      │
│     • notify button   <span data-cl-notify="all|<handle>">          │
└────────────────────────────────────────────────────────────────────┘
```

**Two live-state paths exist by design:**
- `/api/uk-rp-live` for the **curated 26** — direct platform API, deterministic, bypasses noisy DB
- `/api/live-now` for **anyone in the DB** — used by `/now` because it wants to surface non-allowlist activity (servers page now uses uk-rp-live too, post-Phase-2 rebuild)

**Routing rule:** `_routes.json` `include` list determines which paths hit Functions vs. fall through to static + the `_redirects` catch-all. Currently includes `/api/*` and `/creator-profile/*`. Any new Function path **must** be added here or it 404s into the homepage.

**KV keys in use** (durable state, OAuth caches, scheduler diagnostics — safe to clear if anything goes weird):
- `twitch:app_token`, `kick:app_token` — OAuth caches (~55 min)
- `twitch:user-id:{handle}` — permanent user-id resolver
- `kick:avatar:{slug}` — Kick profile_picture cache (7 days, populated when broadcaster is live)
- `cron:live-scan:cursor`, `cron:pass-count`, `cron:handle-map:v1` — scheduler state (legacy round-robin; no longer written but old rows may persist)
- `cron:last-run`, `sessions:last-run`, `curated:last-run` — diagnostic summaries (7-day TTL)
- `curated:livestate:v1` — per-creator liveness blob from the previous tick (`{ "twitch:tyrone": 1, "kick:bags": 0, ... }`). Driven by `pollCurated`, used to detect offline → online transitions for both the Discord webhook **and** the Web Push fan-out. 7-day TTL — if it expires, the next tick treats every live creator as "newly went live" but the first-tick-as-offline rule prevents spam since there's no live data on a totally cold deploy.
- `submit:rl:{ip}:{yyyy-mm-dd}` — submission form rate limit, 25h TTL. Counter increments on each `/api/submit` POST; rejects with 429 once it hits 3 in a UTC day.

**Cache API keys** (Cloudflare's edge HTTP cache, _not_ KV — that's where response caches now live since commit `7bf7940`. Cleared automatically after their TTL; manual busting requires a Cloudflare cache purge):
- `https://contentlore.com/cache/uk-rp-live` — `/api/uk-rp-live` payload (30s)
- `https://contentlore.com/cache/cfx-populations` — `/api/cfx-populations` (60s)
- `https://contentlore.com/cache/clips/{24h|7d|30d}` — Clip Wall response (5 min)
- `https://contentlore.com/cache/timeline/{today|yesterday|7d}` — Timeline response (5 min)
- `https://contentlore.com/cache/analytics/v1` — `/api/analytics` payload (5 min)
- `https://contentlore.com/cache/network/v1` — `/api/network` payload (5 min)
- `https://contentlore.com/cache/digest/v1` — `/api/digest` payload (10 min)
- `https://contentlore.com/cache/streaks-leaderboard/{order}/{limit}` — Watch Streaks leaderboard (5 min)
- `https://contentlore.com/cache/gta6-pulse-tallies` — GTA 6 Pulse aggregate tallies (30s; busted on each POST)
- `streaks:leaderboard:{current|max}:{limit}:cache` — Watch Streaks leaderboard cache (5 min)
- `gta6:pulse:tallies:cache` — GTA 6 Community Pulse aggregate counts (30s; busted on each POST)

---

## 8. Credentials (env vars)

Set in the Cloudflare dashboard for each project. **Never commit values.**

**Pages (`contentlore`)**
| Var | Used by | Purpose |
|---|---|---|
| `TWITCH_CLIENT_ID` | `_lib.js`, `uk-rp-live`, `clips` | helix API |
| `TWITCH_CLIENT_SECRET` | same | helix API OAuth |
| `KICK_CLIENT_ID` | `_lib.js`, `uk-rp-live` | Kick OAuth 2.1 |
| `KICK_CLIENT_SECRET` | same | Kick OAuth 2.1 |
| `ADMIN_TOKEN` | `admin/{discovery, submissions, beef, lore, backfill-avatars, discord-test}` | Bearer auth |
| `ADMIN_PASSWORD` | `_lib.js`'s `requireAdminAuth` | currently unused after cleanup; kept for legacy revival |
| `ANTHROPIC_API_KEY` | currently unused | reserved for Phase 4 AI summaries |
| `DISCORD_WEBHOOK_URL` | `admin/discord-test.js` | Live notifications. Confirmed working in production. Set via `npx wrangler pages secret put DISCORD_WEBHOOK_URL --project-name=contentlore` |
| `VAPID_PUBLIC_KEY` | `api/push/vapid-public-key.js` | Web Push public key (base64url, raw 65-byte uncompressed P-256 point). Same value as the scheduler's `VAPID_PUBLIC_KEY`. Generate with `npx web-push generate-vapid-keys`. |

**Planned (Phase 5+):**
| Var | Purpose |
|---|---|
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok Display + Embed APIs |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |

**Scheduler worker (`contentlore-scheduler`)**
| Var | Purpose |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | polling |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | polling (official API since Phase 1) |
| `ADMIN_PASSWORD` | gates `/trigger`, `/rebuild-sessions`, `/backfill-sessions` |
| `DISCORD_WEBHOOK_URL` | Used by `src/discord.js`'s `notifyGoLive` whenever `pollCurated` detects an offline → online transition. Set via `cd D:/contentlore-scheduler && npx wrangler secret put DISCORD_WEBHOOK_URL`. **Must be set on both Pages and the scheduler** — the Pages admin endpoint and the scheduler each call the webhook independently. **Confirmed firing in prod 2026-04-28**. |
| `VAPID_PUBLIC_KEY` | Web Push public key (same value as Pages-side). Used in the VAPID JWT `k=` header by `src/web-push.js`. |
| `VAPID_PRIVATE_KEY` | Web Push private key (base64url, raw 32-byte P-256 scalar). Scheduler-only — never exposed to clients. |
| `VAPID_SUBJECT` | VAPID JWT `sub` claim — must be a `mailto:` URI or a `https://` URL. Defaults to `mailto:noreply@contentlore.com` if unset. |

**Two-token gotcha:** the Pages admin endpoints use `ADMIN_TOKEN` (Bearer). The scheduler worker uses `ADMIN_PASSWORD` (`X-Admin-Password` header). The mod panel knows both — token for Pages calls, password for scheduler calls. Don't unify them without updating mod panel JS.

---

## 9. Deployment

### Pages site (auto-deploys from git)
```bash
git add -A
git commit -m "Description"
git push
# Cloudflare Pages picks up the push and redeploys in ~1-2 min
```
Watch progress at the Cloudflare dashboard. No build step — `pages_build_output_dir = "."` in `wrangler.toml` means the repo root is served as-is.

### Scheduler worker (manual)
```bash
cd D:/contentlore-scheduler
npx wrangler deploy
```
Updates take effect immediately. Cron continues on its existing schedule. The scheduler dir is **not a git repo** — version control happens via the Pages-side commit messages and the Cloudflare deploy log.

### Database migrations
```bash
# Production
npx wrangler d1 execute contentlore-db --file=migrations/00X_name.sql --remote
```
Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running is safe. Migration numbering has historical gaps and a duplicate (002, 004, two 005, 006, 008, 009, 010, 011 — no 003 or 007). Pick the next free number for new ones.

### Smoke tests after deploy
```bash
curl https://contentlore.com/api/uk-rp-live   | jq '.live_count, .count'
curl https://contentlore.com/api/live-now     | jq '.count'
curl https://contentlore.com/api/clips        | jq '.count'
curl https://contentlore.com/api/timeline     | jq '.count'
curl https://contentlore.com/api/analytics    | jq '.stats.total_hours, .stats.peak_concurrent'
curl https://contentlore.com/api/network      | jq '.node_count, .edge_count'
curl https://contentlore.com/api/digest       | jq '.stats.total_hours, .top_clips | length'
curl https://contentlore.com/api/cfx-populations | jq '.total_returned'
curl https://contentlore-scheduler.dynamomc2019.workers.dev/status | jq '.curated.snapshots_written'

# Discord webhook — should drop a test embed in the configured channel:
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://contentlore.com/api/admin/discord-test

# Web Push wiring — should return the VAPID public key:
curl https://contentlore.com/api/push/vapid-public-key | jq '.key'

# Public submission endpoint — should reject empty body with 400:
curl -X POST -H "Content-Type: application/json" \
  https://contentlore.com/api/submit -d '{}'

# Submissions queue (admin) — should return ok:true and the pending list:
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  'https://contentlore.com/api/admin/submissions?status=pending' | jq '.counts, .count'
```
Most should return non-zero. The scheduler `/status` shows the most recent poll summary including `discord.sent` count.

---

## 10. Conventions & gotchas

- **All handles are stored lowercase.** Compare lowercased on both sides
- **Allowlist source of truth** is `functions/api/uk-rp-live.js`. The `SERVERS` array on `gta-rp/servers/index.html` (mirrored in `functions/api/cfx-populations.js`) is the source for server metadata. When you add a new server with a CFX ID, update **both** locations.
- **`_redirects` has a SPA-style catch-all** (`/* /index.html 200`). Any unmatched route returns the homepage with HTTP 200, never a real 404. Useful for SEO continuity, but means broken links don't surface as errors.
- **`_routes.json` controls Function routing.** `include` list captures paths for Functions; everything else is static. New Function paths (e.g. `/creator-profile/*`, `/api/streaks/*`) must be added or they fall through to the catch-all and serve the homepage.
- **D1 platform records can drift from the curated allowlist.** Always source-of-truth the allowlist; treat `creator_platforms.platform` as a hint that needs reconciling. Tyrone (was `kick`+`rising`) and reeclare (was `kick`) got fixed in 2026-04-27 — they're now both `twitch`+`creator`. Bags has both a `twitch-bags` and a `kick` platform row under the same creator id (his allowlist platform is kick but a prior twitch-tagged discovery left the legacy id).
- **All 26 allowlisted creators are now in `creators`+`creator_platforms`** as of 2026-04-27 (migration `010_backfill_curated.sql`). New creators added to `functions/api/uk-rp-live.js` ALLOWLIST also need a backfill row in D1 + a matching entry in `contentlore-scheduler/src/curated.js` ALLOWLIST + a matching entry in `discovery.js` ALLOWLIST_HANDLES. Yes that's three places — eventually move to a shared D1 table or KV blob.
- **The curated allowlist is mirrored in 9 places** that must stay in sync: `functions/api/uk-rp-live.js` (canonical), `contentlore-scheduler/src/curated.js`, `contentlore-scheduler/src/discovery.js`, `functions/api/timeline.js` (`ALLOWED_HANDLES`), `functions/api/clips.js` (`TWITCH_HANDLES` + `HANDLE_TO_NAME`), `functions/api/analytics.js` (`ALLOWED_HANDLES`), `functions/api/network.js` (`ALLOWED_HANDLES`), `functions/api/digest.js` (`ALLOWED_HANDLES`), `functions/creator-profile/[handle].js`. When adding a creator, grep for `tyrone` to find every list. Eventually move to a shared D1 table or KV blob.
- **If `scene_snapshots` ever stalls again**, check (1) whether `snapshots` has fresh `is_live=1` rows in the last 30 minutes (`pollCurated` should be writing them every tick), (2) whether `stream_title` actually contains a tracked-server keyword — Tyrone's "Just Chatting" titles and Angels365's "@angels365 !breakice" don't match any server keyword and silently get skipped, which is correct.
- **If Kick API returns 401 from `/channels` or `/livestreams`** even though token grant succeeded, the `kick:app_token` in KV is probably stale (from an old/revoked Kick app). Purge with `wrangler kv key delete kick:app_token --namespace-id=f6c05b65a4e84c5baba997122ebcc8c6 --remote` — both Pages and the scheduler share this key. Burned us once on 2026-04-27.
- **Twitch iframe autoplay warning** — Twitch refuses `autoplay=true` if the iframe was hidden when the `src` was set. If multi-view loads tiles before the container is rendered, console fills with "Couldn't autoplay because of style visibility checks". Phase 2 multi-view improvements include the fix as an open item.
- **CFX server IDs are 6-character hashes**, not derivable from server names. Public server search isn't a documented FiveM API (the `/api/servers/?searchText=` endpoint returns 404; only `/api/servers/single/{id}` works for known IDs); use `gtaboom.com/servers/{id}` URLs from web search to discover candidates, then verify against `https://servers-frontend.fivem.net/api/servers/single/{id}`. 8 of our 13 RP servers are whitelist-only with IPs gated behind Discord — no public CFX ID available.
- **Site-wide animation policy: no flicker, no glitch, no CRT.** All such animations were stripped in `60c3450`. Only the static `body::before` scanline overlay remains. If a future feature needs motion, prefer subtle `transform`/`opacity` transitions on hover rather than ambient infinite animations.

---

## 11. Session Log

Brief notes on what shipped each working session. Dates are UTC.

### 2026-04-26 — Foundation cleanup + project bible
- **Cleanup sweep** (`7d02190`): removed 28 orphaned Functions, 12 dead asset files, 11k+ lines of stale CSS (~75% codebase reduction)
- **Critical fixes**: homepage nav (dead `/the-platform/` and `/about/` links), `/api/admin/discovery` schema mismatch, dropped duplicate `migrations/007_scene_snapshots.sql`
- **CLAUDE.md authored** (`998be77` initial, `63f8065` complete) — established the original 22-creator allowlist (later expanded to 26), 12 UK servers, competitive landscape, 5-phase roadmap

### 2026-04-27 — Phase 1 + Phase 2 + Phase 3 #1-2 (single-day push)
The big day. One working session shipped most of the roadmap.

**Phase 1 — Foundation** (`cb27388`)
Migrated Kick to official OAuth 2.1 API on both Pages and scheduler. Compressed logo 298 KB → 40 KB via System.Drawing. Added `cache-control: public, s-maxage=20` to `uk-rp-live` and `live-now`. Resolved `{width}x{height}` thumbnails server-side. Added optional `tiktok`/`youtube` allowlist fields. Re-skinned admin pages from Oswald/magenta to Bebas/oklch.

**Phase 2 — Clip Wall** (`7eeec3f`, `e7517f7`, `1252d9a`)
`/api/clips?range=24h|7d|30d` over Twitch helix for 16 broadcasters, batched via `Promise.allSettled`, game_name enriched via `/helix/games`. Filtered to GTA V (32982) + Just Chatting (509658). Masonry grid page with modal player. CSP allows `clips.twitch.tv` for the iframe.

**Phase 2 — Creator Profiles** (`1e669f7`, `60c3450`, `259d777`, `ed5752d`)
`/creator-profile/{handle}` server-rendered HTML. `_routes.json` updated to include the path. Cold-cache fallback to `/api/clips?range=30d`. Fixed 500 by destructuring `request` from the Function context.

**Phase 2 — Server Status Dashboard** (`b4fa869`, `4072502`)
Departures-board layout. Added live CFX populations from `servers-frontend.fivem.net` for 5 known UK servers (Unique, Orbit, Unmatched, New Era, Prodigy). Server-side fetch (no CORS on FiveM master), 60s KV cache.

**Phase 2 — Scene Timeline** (`2451bac`)
`/gta-rp/timeline/` Gantt visualisation per creator. `/api/timeline?range=today|yesterday|7d` joins `stream_sessions` to `creator_platforms` and annotates each row with detected server. 12-server colour palette, hover tooltip, ongoing-session pulse.

**Phase 2 — Multi-View improvements** (`fdbcd73`)
Layout presets (Focus/Duo/Quad/Six) cap selected count. Persistent `localStorage` for selections + layout. `?add=tyrone,stoker` URL share. Persistent info bar below each tile. Live-thumbnail empty-state cards with one-click add.

**Phase 3 #1 — Watch Streaks** (`86e1489`)
Migration `008_watch_streaks.sql` applied to prod. `POST /api/streaks/check-in` (idempotent within UTC day) + `GET /api/streaks/leaderboard`. Opt-in client `streak-checkin.js` defer-loaded on hub pages. `/gta-rp/streaks/` page with stats card, 3 badges, current/all-time leaderboard tabs.

**Phase 3 #2 — "Who Should I Watch?" Randomiser** (`87fcf87`)
Slot-machine modal on `/gta-rp/`. Deceleration animation 60ms→420ms over ~2s. Reveal card with Watch Now / Spin Again / Profile actions.

**Site-wide hygiene**
Stripped all CRT/flicker/glitch animations (`1252d9a`, `60c3450`) — content-heavy pages too distracting. Kept only static `body::before` scanline overlay. Fixed two D1 platform-record drift bugs (Tyrone + reeclare were wrongly tagged `kick`).

**CLAUDE.md sync** (`954a238`) — flipped Phase 1 + Phase 3 status, refreshed Current State / Architecture / KV-keys / Gotchas, added this Session Log.

**Phase 4 #1 — Scene snapshots restoration** (scheduler-only deploy)
Diagnosed why `scene_snapshots` had stayed at 0 rows since launch. Root causes in scheduler `src/scenes.js`: queried a non-existent `creator_snapshots` table; used wrong column names (`creator_name`/`viewer_count`/`snapshot_at` instead of `creator_id`/`viewers`/`captured_at`); SERVER_REGISTRY listed US servers (NoPixel, JESTRP, Lucid City) so even a working query would never match a UK creator's title. Whole function was wrapped in a try/catch returning `{ snapshots: 0, error }` so failures stayed silent. Rewrote against the real schema with the canonical 12-server UK registry mirrored from `functions/api/timeline.js`. Wired `captureSceneSnapshots` into the worker's `/trigger` endpoint for manual smoke testing. Deployed via `npx wrangler deploy`. Schema migration was unnecessary — `scene_snapshots` table itself was always correct.

**Phase 4 #2 — GTA 6 Deep Dive** (`5de8712`)
Rebuilt `/gta-rp/gta-6/` as a living intelligence briefing. Live JS countdown to 19 Nov 2026 console launch (with hero T-minus badge). Latest News card grid covering: release date lock, Take-Two 21 May earnings call / Trailer 3 expectations, FiveM 202k concurrent Steam record on 15 Mar 2026, Cfx.re Creator Platform Licence Agreement reissued 12 Jan 2026, "Project ROME" first-party modding rumour, UK scene posture inference. Updated Impact Matrix + Transition Scenarios to reflect Rockstar's Cfx.re ownership (FiveM is now first-party — server-infrastructure impact dropped to Low; "Smooth Coexistence" remains plausible but no longer dependent on a third-party rescue). Community Pulse poll: 4 options (Ready / Cautiously optimistic / Worried / Not thinking), anonymous one-vote-per-device with localStorage UUID, live results bar, change-vote-any-time. Backed by `GET|POST /api/gta6-pulse` and `gta6_pulse_votes` (migration 009 applied to prod).

**CLAUDE.md sync** (`76fda06`) — flipped Phase 4 statuses, recorded scenes-fix diagnosis as a permanent gotcha, added this entry.

**Phase 2 — Multi-View chat drawer** (`6374446`, `e491141`, `e3b97a6`)
Two iterations on chat. First attempt pushed chat into each tile (per-tile iframe stack); the Twitch embed reserves ~80px for its own header + community-points bar so quad/six left almost no scrollback. Second commit bumped per-tile heights but the math still didn't work. Final approach (`e3b97a6`): replaced per-tile chat with a fixed right-side drawer (380px), tabs at the top to pick which creator's chat to load, mobile <900px gets a bottom-up sheet covering the grid. iframe `src` only swaps on tab change so the chat doesn't reconnect on every 90-second poll. Drawer state + active tab persist in localStorage. Streams now use full viewport width when drawer is closed.

**Site-wide teal recolour** (`a3458d5`, `9f20f38`)
Swapped the deep-indigo palette to dark teal across all 13 hub HTML files. Two passes: first the four user-specified vars (`--bg`, `--card`, `--card2`, `--border`) plus their inline alpha variants; then the ink-faint, modal-backdrop, admin `--bg4` / `--border-a`. Twitch brand purple (`oklch(0.65 0.25 295)`) deliberately untouched.

**Allowlist 22 → 26 + discovery filter tightening** (`99c152b`)
Added 4 creators (essellz, lewthescot, angels365, fantasiasfantasy — all UK Twitch creators surfaced by the discovery scan after the schema bug was fixed). Tightened `looksUKGTARP()` in `discovery.js` to require both an RP keyword AND a UK server keyword (was: RP + (UK-tag OR server)) — fixes US streamers leaking through via their `UK`/`English` Twitch tags. Hardcoded the 26 ALLOWLIST_HANDLES Set into discovery so curated creators never re-leak into `pending_creators`. Synced the count across CLAUDE.md, clips, servers, streaks, timeline, mod, creator-profile.

**Kick: end-to-end fix** (scheduler-only deploy)
Set `KICK_CLIENT_ID` + `KICK_CLIENT_SECRET` secrets on the scheduler (they were missing entirely — explained why DB-driven `/api/live-now` never showed Kick activity). Diagnosed Pages-side `/api/uk-rp-live` returning all 6 Kick creators offline despite token grant succeeding: the `kick:app_token` in KV was stale (from an old Kick app that was revoked), and the OAuth grant succeeded but the resulting token was rejected by `/channels` and `/livestreams` with 401. Purged `kick:app_token` from KV; fresh token fixed it. Added a temporary `_kick_debug` field to `/api/uk-rp-live` for the diagnosis (stripped 24h later).

**Phase 4 #3 — Curated polling pass + downstream unblock** (`e24152f`)
Diagnosed the real reason `scene_snapshots`/timeline/profile-stats stayed empty even after the `scenes.js` fix: 20 of 26 curated creators weren't in the `creators` table, and the round-robin polling was on a ~6.7-day cadence per creator anyway. Three-part fix:
1. `migrations/010_backfill_curated.sql` — backfilled 20 missing curated rows into `creators` + `creator_platforms` (idempotent INSERT OR IGNORE; bags got a kick platform row attached to existing `twitch-bags`).
2. New `contentlore-scheduler/src/curated.js` (`pollCurated`) — batched Twitch `/streams` + Kick `/channels` calls for all 26 handles, writes one snapshot per creator per tick. Wired in as the first step of both `scheduled()` and `/trigger`.
3. Synced three more stale 22-handle allowlists in `timeline.js`, `clips.js`, `creator-profile/[handle].js` to the 26-handle current state.

Verified end-to-end after the 18:30 UTC cron tick: 26 fresh snapshots, 9 ongoing `stream_sessions`, 4 server rows in `scene_snapshots` (orbit/unmatched/d10/prodigy), `/api/timeline?range=today` went from 0 → 5+ sessions.

**Cleanup + CLAUDE.md sync** (this commit)
Deleted `functions/_scheduled.js` (legacy in-Pages cron handler — confirmed unused, no `[triggers]` in `wrangler.toml`, dropping it ends the "dead code preserved for reference" footnote). Stripped the temporary `_kick_debug` field from `uk-rp-live.js`. Refreshed Active Functions count, D1 tables status, data-pipeline description, KV keys list, and conventions/gotchas to match today's reality. Flipped scene_snapshots `[~]` → `[x]` on the Phase 4 roadmap and added two Phase 2 multi-view checkboxes that the drawer rebuild closed out.

### 2026-04-28 — Phase 4 closeout + Phase 5 kickoff (single-day push)
Marathon session: closed out every remaining Phase 4 item, opened Phase 5 with the Discord webhook, scaffolded social-share OG tags across the whole site, and corrected a stale homepage stat. Each ship is a separate commit.

**Phase 4 #1 — FiveM Enhanced rebuild** (`cd91188`)
Replaced the placeholder briefing on `/gta-rp/fivem-enhanced/` with three concrete data layers: framework compatibility (ESX testing, QBCore + QBOX ready) with rationale per row; per-server migration tracker for all 12 UK servers, status badges and Last Checked dates so the page can be re-graded without rewriting it; a technical changelog grounded in the Cfx.re Creator Platform Licence reissue, OneSync Infinity defaulting on, scheduler tightening, and the 202k Steam concurrent record. Added Analytics / Network / Digest links to the nav (those pages shipped immediately after).

**Phase 4 #2 — Scene Analytics page + API** (`cc2cb2a`)
New `/gta-rp/analytics/` surface backed by `/api/analytics`: viewers-over-time inline-SVG line+area, 7×24 dow×hour-of-day heatmap with six tinted intensity buckets, server-popularity horizontal bars (mins × peak ÷ 60), week-over-week creator growth card grid (top 5 fastest growing, with a "new this week" pill fallback when there's no prior-week data), and a stats strip (total hours / unique creators live / peak concurrent + ts / most active server). 5-min Cache API hit at `/cache/analytics/v1`. Sample-size threshold (<24 hour buckets) drops a "data accumulates over time" notice. Added Analytics link to nav across all hub pages.

**Phase 4 #3 — Creator Network Graph + API** (`326704e`)
New `/gta-rp/network/` surface backed by `/api/network`. Pure-SVG force-directed simulation, no external libs — Coulomb repulsion + spring attraction along edges + center gravity, 380 iterations with cooling step cap. Node radius scales with 30d avg viewers (log-mapped). Edge colour by interaction type (raid=cyan, host=green, shoutout=amber, mention=violet, co-stream=neutral). Click a node to focus its neighbourhood: others fade, a detail card lists the connected creators with edge type, weight and last-seen date. Stats strip: nodes / edges / most-connected / density %. Empty-state when `creator_edges` is sparse — shows the 26 nodes plus a "data is building" message rather than a broken canvas. 5-min Cache API hit at `/cache/network/v1`.

**Phase 4 #4 — Weekly Scene Digest + API** (`50dbf48`)
New `/gta-rp/digest/` surface backed by `/api/digest`. Headline panel: peak viewership moment of the week (creator, platform, ts, stream title) flanked by 4 KPIs. Hours leaderboard (top 5 by total hours streamed). Top Clips of the Week (delegates to `/api/clips?range=7d` server-side from inside the Function). New Creators Discovered (pending_creators rows with first_seen in last 7d). Rolling 7-day window — refreshed per request, 10-min Cache API hit at `/cache/digest/v1`.

**Phase 4 #5 — Creator Growth Tracker (follower trend)** (`ad04b4e`)
First half ("Fastest Growing This Week") had landed in the analytics commit; this commit added per-creator follower-trend sparklines (30d, daily-bucketed) to `/gta-rp/analytics/`. Cards show first → last follower count + delta %, sorted by absolute delta. Kick rows surface the Public-API limitation honestly with a dimmed style and an "API limitation" sub-line — better than appearing as flat-zero trends.

**Phase 5 #1 — Discord webhook bot** (`e7b1491` Pages-side)
Pages-side admin endpoint `GET|POST /api/admin/discord-test` (Bearer-authed): GET returns the configured webhook URL host + last 6 chars of the path so admins can verify wiring without leaking the secret; POST sends a test embed. Scheduler-side (in `D:/contentlore-scheduler` — separate `npx wrangler deploy` required) added `src/discord.js` exporting `notifyGoLive(env, transitions[])` which posts rich embeds (Twitch purple / Kick green colour-coded, profile URL, stream title, viewers, category, chunked at 10 embeds per message). Modified `pollCurated` to diff current liveness against `curated:livestate:v1` in KV; for each offline → online transition, enriches with display name and fires `notifyGoLive`. First-tick-ever liveness is treated as "was offline" so deploying on a busy day doesn't spam the channel. **Activation:** set `DISCORD_WEBHOOK_URL` on both Pages (`npx wrangler pages secret put DISCORD_WEBHOOK_URL --project-name=contentlore`) and the scheduler (`cd D:/contentlore-scheduler && npx wrangler secret put DISCORD_WEBHOOK_URL`), then `npx wrangler deploy` the scheduler.

**SEO/social — OG meta tags on every page** (`6305eb9`)
Every hub page now ships og:type / og:site_name / og:title / og:description / og:image / og:url plus the twitter:card=summary_large_image counterparts. Titles and descriptions mirror the existing `<title>` + meta description so nothing diverges. og:image points at `/logo.png` for now — proper per-page OG image generation (with live data) is still on the roadmap.

**Homepage stat fix — "7,770 TRACKED" → "26 CREATORS"** (`4fb51c5`)
The pulse strip was showing `total_creators` from `/api/stats` (which counts every row in the creators table including dead/legacy entries — falling back to 7770 when the call failed). Hardcoded 26 since the curated allowlist is fixed and dropped the redundant stats fetch.

**CLAUDE.md sync** (`2d2c880`) — flipped Phase 4 to fully done, marked Phase 5 #1 (Discord) and the OG-tag scaffold complete, refreshed Active Functions count (17 → 22), Active hub surfaces (14 → 17), Key URLs (added analytics/network/digest), data pipeline description (4 steps now, dropped legacy round-robin notation, called out the new Discord-on-go-live step), Architecture diagram, KV keys list (added `curated:livestate:v1`), Cache API keys list (split out from KV — most response caches moved to Cache API in commit `7bf7940`), env vars (DISCORD_WEBHOOK_URL added on both Pages and scheduler), allowlist-mirror gotcha now lists 9 places, and added smoke-test commands for the new endpoints + the Discord webhook test.

---

**Discord webhook live verification** (afternoon)
Set `DISCORD_WEBHOOK_URL` on both Pages and the scheduler, redeployed the scheduler. ABsTheName + Angels365 go-live transitions fired real Discord embeds in the configured channel — end-to-end pipeline confirmed working. No code changes needed.

**Mobile PWA + browser push** (`0456b66`, `c21cb63`, `3efba8e`, `dff7b86`)
Four-commit build of the full mobile/PWA story.

`0456b66` — manifest, service worker, install prompt scaffold. `manifest.json` with teal theme + four shortcuts (Live, Multi, Timeline, Digest). `sw.js` does cache-first for static shell, network-first for HTML with offline fallback to cached pages, pure-network for `/api/*`. `pwa.js` registers the SW, tracks visit count in localStorage, surfaces a dismissable install banner from visit 2 onward (Chromium beforeinstallprompt + iOS Safari "Add to Home Screen" hint). `_headers` updated with `Service-Worker-Allowed: /` for root scope. All 13 hub pages link the manifest, set `theme-color: #0d1f1f`, and load `pwa.js` deferred.

`c21cb63` — mobile multi-view at <=768px. `/gta-rp/multi/` swaps the desktop grid + drawer for a single full-width 16:9 stream + info bar + chat iframe + 64px bottom tabbar. Tabbar shows one square per selected creator (avatar + live dot + active highlight) + a "+" button at the right end that opens a slide-up roster sheet. Tap a tab to switch; iframe cache keys prevent reload churn on the 90s poll. Desktop layout untouched (>=769px).

`3efba8e` — hamburger nav drawer at <=900px. Single-file change in `pwa.js` that injects a hamburger button + 280px right-side slide-in drawer on every hub page that has a `nav.nav > .nav-links` structure. Mirrors the page's nav links with active-state preservation. ESC + overlay tap + link click all close. Bumped SW_VERSION to evict the stale shell.

`dff7b86` — Web Push end-to-end. `migrations/011_push_subscriptions.sql` adds the table (endpoint UNIQUE, p256dh/auth keys, user_uuid, filter_handles). New endpoints `/api/push/{vapid-public-key,subscribe,unsubscribe}`. New `<span data-cl-notify>` button hydrator in `pwa.js` — `data-cl-notify="all"` on the live hub for global opt-in, `data-cl-notify="<handle>"` on creator profiles for per-creator opt-in. Scheduler-side `D:/contentlore-scheduler/src/web-push.js` is a pure-Workers RFC 8291 (aes128gcm) implementation with ES256 VAPID JWT signing — no npm dependency, all crypto from `SubtleCrypto`. `pollCurated`'s transition path now fans out push alongside Discord, prunes 410-Gone endpoints from the table after each tick. Activation needs the migration run + `VAPID_PUBLIC_KEY` on Pages + all three VAPID secrets on the scheduler + a redeploy.

**Multi-platform creator profiles** (`8ad2ef5`)
Every ALLOWLIST entry in `functions/api/uk-rp-live.js` now carries a `socials: { twitch, kick, tiktok, youtube, x, instagram, discord }` object with seven fixed slots. Confirmed multi-platform handles populated for dynamoses + bags (both have D1 platform rows on both sides per migration 010). Everyone else gets `{primary}: handle` and null for the other six — TikTok/YouTube/X/Instagram/Discord all null today, to be filled in via `/submit/` or manual edits. New `entrySocials()` helper backfills the primary handle defensively. Both build paths (`buildTwitchEntry`, `buildKickEntry`) and the offline stub emit `socials` in the API response. Top-level `tiktok` / `youtube` retained for back-compat. Creator profile pages got a proper "Platforms" section: branded square buttons with inline-SVG icons + handle subtext, three new colours (X near-white, Instagram pink, Discord blurple). Roster cards on `/gta-rp/` now show small brand-coloured pills (TW/KK/YT/TT/X/IG/DC) under each name. Verified before changes via `curl /api/uk-rp-live` that dynamoses appears in the response (offline at the moment, avatar null because Kick avatars only warm-cache from `/livestreams` when broadcaster is live).

**Public creator submission form** (`a0bb8fb`)
New `/submit/` page — GTA-styled form with display name, optional Twitch/Kick/TikTok/YouTube/X handles, 12 server checkboxes, free-text bio, and a hidden honeypot for spam. Posts to `/api/submit` (no auth, KV-rate-limited 3 / IP / UTC day via key `submit:rl:{ip}:{yyyy-mm-dd}`). The endpoint sanitises handles (strips @, URL prefixes; rejects anything not in `[A-Za-z0-9._-]`), validates server values against a whitelist, dedupe-rejects against `creator_platforms` so submissions for the curated 26 don't pollute the queue. INSERTs into `pending_creators` with `discovery_count=0`, `status='pending'`, and `notes` prefixed with the literal `SUBMITTED:` followed by the full JSON payload (socials, servers, bio, ip, user_agent). The sentinel is what separates form submissions from auto-discovery rows in the same table — no schema migration needed. New `/api/admin/submissions` endpoint (Bearer auth) lists/decides them, and `/mod/` got a new "Submissions" tab with filter chips (Pending / Approved / Rejected), live pending-count badge on the tab name, and per-card Approve/Reject buttons. Footer "Submit your channel →" link added on every hub page that has one (skipped multi-view since its sticky chat drawer doesn't leave room for a footer).

**CLAUDE.md sync** (this commit) — refreshed Active Functions count (22 → 27, with the five new endpoints), Active hub surfaces (17 → 18, /submit/), added the PWA paragraph below the surface counts, expanded the allowlist section to call out the new `socials` shape and the two confirmed multi-platform creators, added `push_subscriptions` to the D1 tables list, flipped the rest of Phase 5 (Discord, OG tags, Mobile PWA, multi-platform footprint, public submission form) to done with commit refs, refreshed the Architecture diagram (push endpoints + push fanout + /submit + push_subscriptions table + the PWA footer block), added `submit:rl:*` to KV keys, added VAPID_* env vars on both Pages and scheduler, added migration 011 to the migration numbering note, added smoke-test curl commands for `/api/push/vapid-public-key`, `/api/submit`, `/api/admin/submissions`, and added this entry. Also flipped the "Discord confirmed working in production" status into the Phase 5 roadmap entry.

### 2026-04-29 — Servers overhaul (rebrand + Chase RP + Avg column)
Renamed the servers surface from "UK RP" to "RP" across the site, on the basis that several tracked servers (Prodigy, New Era, D10, Chase) are American servers UK creators play on, not UK servers. Touched `/gta-rp/servers/` (title, hero, footer, OG tags), `/gta-rp/fivem-enhanced/` ("Server Migration Tracker" heading + the 13-server stat + briefing/changelog wording), `/gta-rp/gta-6/` (impact analysis text), `/gta-rp/analytics/` (server-hours panel description), `/gta-rp/digest/` (discovery empty-state), homepage card, submit form fieldset.

**Server roster: 12 → 13.** Added Chase RP as a new entry (American server, dedicated UK following, police/criminal focused, no public CFX ID, keywords `['chase rp','chaserp']` — bare 'chase' deliberately excluded to avoid matching "police chase" in titles). Renamed "The Endz" → "The Ends RP" with the user's new description and merged keyword set spanning both spellings (`['the ends','theends','ends rp','theendsrp','the endz','endz rp','endz']`). Rewrote Prodigy / New Era / D10 server descriptions to accurately frame them as American servers with UK creator presence (was previously labelled "UK GTA RP server").

**New endpoint `/api/scene-averages`** — 7-day rolling AVG of `streamer_count` + `total_viewers` per server from `scene_snapshots`. Powers the new "Avg" column on the servers status board. 5-min Cache API hit at `/cache/scene-averages`. Shows `—` with tooltip "Building data" when sample size <3 snapshots.

**Status-board Players column tightened** — servers with no CFX ID previously showed "private" (implied deliberate hiding). Changed to `—` with tooltip "Player count unavailable — CFX ID not configured" since the 8 unknown-CFX servers are mostly whitelist-gated, not actively private. Servers with a known CFX ID that are momentarily unreachable also show `—` with a different tooltip.

**Server-keyword sync across 5 files** — `functions/api/timeline.js`, `functions/api/analytics.js`, `functions/api/cfx-populations.js`, `gta-rp/servers/index.html`, `D:/contentlore-scheduler/src/scenes.js`, `D:/contentlore-scheduler/src/discovery.js`. The legacy `D:/contentlore/scheduler/` mirror is unimported and skipped (still has US-server entries from before the project pivoted to UK scene — flag for future cleanup or deletion).

**Discovery research that came up empty:** the FiveM master's `/api/servers/?searchText=` endpoint returns 404 — the public frontend has no documented search API, only `/api/servers/single/{id}` for known CFX IDs. The streaming list at `/api/servers/streamRedir/` redirects to a custom binary format that needs FiveM's own decoder. So I couldn't bulk-search for CFX IDs of the 8 unknown servers. D1 query against `snapshots` (last 500 live titles) confirmed no untracked servers in active use — every detected `X RP` token mapped to an existing entry, including 2 hits for "THE ENDS" which validated the Endz/Ends merge.

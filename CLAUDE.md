# ContentLore — Project Bible

A living document for anyone (or any agent) working on this repo. Update as the project evolves.

---

## 1. Project Overview

**ContentLore** is a UK GTA RP streaming intelligence platform. It tracks a curated 22-creator allowlist across Twitch and Kick, surfaces who's live, and provides a multi-stream viewer for the UK roleplay scene. The differentiator vs. competitors (HasRoot, StreamsCharts, etc.) is **UK-scene focus** — none of them specialise in British GTA RP.

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
- `https://contentlore.com/gta-rp/` — live hub (the curated 22)
- `https://contentlore.com/gta-rp/now/` — real-time scene ticker
- `https://contentlore.com/gta-rp/multi/` — 6-tile multi-view
- `https://contentlore.com/gta-rp/clips/` — Clip Wall (Twitch clips, masonry)
- `https://contentlore.com/gta-rp/timeline/` — scene activity Gantt
- `https://contentlore.com/gta-rp/streaks/` — opt-in daily-visit tracker
- `https://contentlore.com/gta-rp/servers/` — UK RP server status board
- `https://contentlore.com/gta-rp/fivem-enhanced/` — platform deep-dive
- `https://contentlore.com/gta-rp/gta-6/` — platform deep-dive
- `https://contentlore.com/creator-profile/{handle}` — per-creator profile (dynamic Function)
- `https://contentlore.com/mod/` — admin dashboard (requires `ADMIN_TOKEN`)
- `https://contentlore.com/admin/content.html` — beef + lore editor
- `https://contentlore.com/admin/discovery.html` — pending creator triage
- `https://contentlore-scheduler.dynamomc2019.workers.dev/status` — last poll/session summaries

---

## 2. Current State

**Active hub surfaces (14):**
- Static pages (10): `/`, `/gta-rp/{,now/,multi/,clips/,timeline/,streaks/,servers/,fivem-enhanced/,gta-6/}`
- Admin pages (3): `/mod/`, `/admin/content.html`, `/admin/discovery.html`
- Dynamic page (1): `/creator-profile/{handle}` rendered by `functions/creator-profile/[handle].js`

The repo also contains several legacy directories (`about/`, `contact/`, `creators/`, `ethics/`, `ledger/`, `rising/`, `signals/`, `the-platform/`, `gta-rp/beef/`, `gta-rp/lore/`) that survived the 2026-04-26 cleanup sweep but aren't part of the active navigation. They serve via `_redirects` catch-all if anyone deep-links them. Worth a re-audit eventually.

**Active Pages Functions (17, plus 2 helpers):**

| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/uk-rp-live` | `api/uk-rp-live.js` | Curated 22 live state (direct platform APIs, 30s KV cache) |
| `GET /api/live-now` | `api/live-now.js` | DB-backed live list (anyone in `creators` table) |
| `GET /api/clips?range=24h\|7d\|30d` | `api/clips.js` | Top Twitch clips for the 16 Twitch handles, GTA V + Just Chatting filtered, 5-min KV cache |
| `GET /api/timeline?range=today\|yesterday\|7d` | `api/timeline.js` | `stream_sessions` rows overlapping window for the 22, server-id annotated, 5-min KV |
| `GET /api/cfx-populations` | `api/cfx-populations.js` | Live FiveM player counts for 5 known UK server CFX IDs, 60s KV |
| `POST /api/streaks/check-in` | `api/streaks/check-in.js` | Idempotent daily-visit increment (anonymous UUID), badge state |
| `GET /api/streaks/leaderboard?order=current\|max` | `api/streaks/leaderboard.js` | Top opt-in users with display names, 5-min KV |
| `GET\|POST /api/gta6-pulse` | `api/gta6-pulse.js` | Anonymous one-vote-per-device GTA 6 readiness poll, 30s KV tallies cache |
| `GET /api/creators` | `api/creators.js` | Paged creator directory (D1) |
| `GET /api/stats` | `api/stats.js` | Aggregate counters (D1) |
| `GET /api/beefs` | `api/beefs.js` | Editorial beef list (D1) |
| `GET /api/lore-arcs` | `api/lore-arcs.js` | Editorial lore arc list (D1) |
| `* /creator-profile/{handle}` | `creator-profile/[handle].js` | Server-rendered profile page (HTML response, not JSON) |
| `GET\|POST /api/admin/discovery` | `api/admin/discovery.js` | Pending creator triage (Bearer auth) |
| `GET\|POST /api/admin/beef` | `api/admin/beef.js` | Beef CRUD (Bearer auth) |
| `GET\|POST /api/admin/lore` | `api/admin/lore.js` | Lore arc CRUD (Bearer auth) |
| `GET\|POST /api/admin/backfill-avatars` | `api/admin/backfill-avatars.js` | One-shot Twitch avatar backfill (Bearer auth) |
| _helper_ | `_lib.js` | `jsonResponse`, `getTwitchToken`, `getKickToken`, `fetchKickChannel`, etc. |
| _dead code_ | `_scheduled.js` | Legacy in-Pages cron handler — kept for reference, doesn't fire (Pages doesn't run crons) |

**22-creator allowlist** (source of truth: `functions/api/uk-rp-live.js`)
- 16 Twitch: tyrone, lbmm, reeclare, stoker, samham, deggyuk, megsmary, tazzthegeeza, wheelydev, rexality, steeel, justj0hnnyhd, cherish_remedy, lorddorro, jck0__, absthename
- 6 Kick: kavsual, shammers, bags, dynamoses, dcampion, elliewaller

**12 UK servers tracked** (source of truth: `SERVERS` array in `gta-rp/servers/index.html`, mirrored in `functions/api/cfx-populations.js` for live populations)
- With known CFX IDs (5): Unique RP `ok4qzr`, Orbit RP `5j8edz`, Unmatched RP `r43qej`, New Era RP `z5okp5`, Prodigy RP `775kda`
- CFX ID unknown / private (7): TNG, D10, VeraRP, The Endz, Let's RP, Drill UK, British Life RP

**D1 tables** (verified 2026-04-27 against prod schema)
- `creators` (id, display_name, role, bio, categories, origin_story, avatar_url, accent_colour, created_at, updated_at)
- `creator_platforms` (creator_id, platform, handle, platform_id, is_primary, verified, verified_at — PK on creator_id+platform)
- `creator_edges` (raid/host/shoutout social graph)
- `snapshots` (per-poll observations of live state)
- `stream_sessions` (derived sessions from snapshots — 950 rows, 768 creators as of 2026-04-27)
- `scene_snapshots` (server-clustered scene captures — scheduler `scenes.js` rewritten and redeployed 2026-04-27 against the real `snapshots` schema and the 12-server UK registry; first rows expected on the next cron tick)
- `pending_creators` (discovery triage — **0 rows in prod** as of 2026-04-27)
- `beefs`, `lore_arcs` (editorial)
- `watch_streaks` (Phase 3 — anon UUID, current/max streak, total_visits, optional display_name)
- `gta6_pulse_votes` (Phase 4 — anon UUID, choice ∈ {ready, optimistic, worried, not-thinking}, voted_at)

**Data pipeline:** Scheduler worker (every 15 min) → polls Twitch/Kick → `snapshots` → `stream_sessions` → `scene_snapshots`. `/api/uk-rp-live` bypasses DB entirely and queries Twitch + Kick official APIs directly for the 22 allowlisted creators (30s KV cache).

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
- [ ] Mobile layout — single stream with swipeable tabs for switching creators + chat
- [ ] Bigger tiles in Focus mode — partly addressed by Focus preset (1×1 stretches to viewport) but no dedicated full-bleed mode yet
- [ ] Picture-in-picture mode — pop out a stream while browsing other pages
- [ ] Quick-add from live page — button on each stream card that adds directly to multi-view without navigating
- [ ] Fix Twitch autoplay warning — ensure iframe is visible before loading `src` to satisfy Twitch's style-visibility requirement

### PHASE 3 — GAMIFICATION
- [x] **Watch Streaks** — D1 `watch_streaks` table, opt-in client (`/streak-checkin.js` defer-loaded on hub pages), `POST /api/streaks/check-in` (idempotent within UTC day) + `GET /api/streaks/leaderboard`, `/gta-rp/streaks/` page with stats card, 3 badges (Week Warrior 7d / Month Regular 30d / Scene Veteran 100d), and current-vs-all-time leaderboard. Anonymous by default; display name optional and only required to appear on the leaderboard. Migration `008_watch_streaks.sql` applied to prod.
- [x] **"Who Should I Watch?" Randomiser** — slot-machine modal on `/gta-rp/`. Deceleration animation 60ms→420ms over ~2s, locks onto a random live creator with flash + glow. Reveal card has Watch Now / Spin Again / Profile actions. Time-of-day-aware empty state when nobody is live.
- [—] **Predictions / Polls** — deferred (needs community traction first)
- [—] **RP Awards** — deferred (needs community traction first)
- [—] **Scene Bingo** — deferred (needs community traction first)

### PHASE 4 — INTELLIGENCE (data depth)
- [x] **GTA 6 Deep Dive** — `/gta-rp/gta-6/` rebuilt as a living briefing. Live ticking countdown to 19 Nov 2026 console launch. Latest News feed (release lock, Trailer 3 expectations, FiveM 202k Steam record, Cfx Platform Licence update, Project ROME rumour, UK scene posture). Updated Impact Matrix + Transition Scenarios reflecting Cfx.re/Rockstar ownership. Community Pulse poll with anonymous one-vote-per-device + live results bars, backed by `gta6_pulse_votes` table (migration 009). Endpoint `GET\|POST /api/gta6-pulse`. Impact calculator ("if X% migrate") still open as a follow-up.
- [~] **Restore `scene_snapshots` capture** — scheduler's `scenes.js` was reading from a non-existent `creator_snapshots` table with wrong column names and a US-server registry (NoPixel, JESTRP, Lucid City). Rewritten 2026-04-27 against the real `snapshots` table and the canonical 12-server UK list (mirrored from `functions/api/timeline.js`). Bonus: `/trigger` endpoint now also calls `captureSceneSnapshots` for manual smoke testing. Awaiting first cron tick to confirm rows landing in prod. **No migration needed** — table schema was correct all along.
- [ ] **FiveM Enhanced Deep Dive** — real migration status per server (not just "monitoring" — actual data from server owners). Technical changelog per update. Framework compatibility matrix (ESX, QBCore, QBOX Enhanced-readiness). Creator impact section (who's mentioned Enhanced on stream via title keyword detection).
- [ ] **Historical Analytics** — viewer trends over time per creator. Server population charts. Scene activity heatmap (hours × days of week showing when UK scene is busiest).
- [ ] **Creator Network Graph** — visual graph showing who raids/hosts who. Data already in `creator_edges` table. Interactive network visualisation.
- [ ] **Weekly Scene Digest** — auto-generated "This Week in UK GTA RP" page: peak moments, new creators, server changes, top clips. Could also push to Discord webhook.
- [ ] **Creator Growth Tracker** — follower/viewer growth over time per creator. "Fastest growing" weekly highlight.

### PHASE 5 — GROWTH (external reach)
- [ ] **Discord Bot** — when any allowlist creator goes live, post to Discord channel with embed (thumbnail, game, viewers). Free marketing that drives traffic back to site.
- [ ] **Browser Push Notifications** — opt-in alerts when favourite creators go live.
- [ ] **Social Sharing** — OG images auto-generated for each page. Share cards for clips, creator profiles, scene summaries.
- [ ] **Mobile PWA** — service worker, offline support, install prompt. Multi-view needs mobile layout (one stream + swipeable chat tabs).
- [ ] **Character Wiki** — community-contributed character database. Who plays who on which server. Search by character name. Huge for RP — viewers know character names not streamer names.
- [ ] **Sound Alerts** — GTA-themed sound when someone goes live (optional, toggleable). Vice City radio jingle vibes.

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
│  (Cloudflare Worker)    │  │   /api/uk-rp-live    (curated 22)    │
│  cron */15 * * * *      │  │   /api/clips         (Twitch helix)  │
│                         │  │   /api/cfx-populations (FiveM master)│
│  polling → snapshots    │  │   /api/streaks/check-in  (D1 write)  │
│  sessions → stream_     │  │  All 30s-300s KV-cached              │
│             sessions    │  └──────────────┬───────────────────────┘
│  scenes  → scene_       │                 │
│             snapshots   │                 │
│  discovery → pending_   │                 │
│              creators   │                 │
│                         │                 │
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
└──────────┬───────────────┘                │
           │                                │
           ▼                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Pages Functions (read-side, D1-backed)                            │
│   /api/live-now          DB-backed live list                       │
│   /api/timeline          stream_sessions overlap window            │
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
│   /gta-rp/            curated hub        (uk-rp-live)              │
│   /gta-rp/now/        scene ticker       (live-now)                │
│   /gta-rp/multi/      6-tile player      (uk-rp-live)              │
│   /gta-rp/clips/      Clip Wall          (clips)                   │
│   /gta-rp/timeline/   scene Gantt        (timeline)                │
│   /gta-rp/streaks/    daily-visit ranks  (streaks/*)               │
│   /gta-rp/servers/    status board       (uk-rp-live + cfx-pops)   │
│   /gta-rp/fivem-enhanced/  intel deep-dive                         │
│   /gta-rp/gta-6/      intel deep-dive                              │
│   /mod/, /admin/*     admin surface                                │
└────────────────────────────────────────────────────────────────────┘
```

**Two live-state paths exist by design:**
- `/api/uk-rp-live` for the **curated 22** — direct platform API, deterministic, bypasses noisy DB
- `/api/live-now` for **anyone in the DB** — used by `/now` because it wants to surface non-allowlist activity (servers page now uses uk-rp-live too, post-Phase-2 rebuild)

**Routing rule:** `_routes.json` `include` list determines which paths hit Functions vs. fall through to static + the `_redirects` catch-all. Currently includes `/api/*` and `/creator-profile/*`. Any new Function path **must** be added here or it 404s into the homepage.

**KV keys in use** (mostly TTL'd, safe to clear if anything goes weird):
- `twitch:app_token`, `kick:app_token` — OAuth caches (~55 min)
- `twitch:user-id:{handle}` — permanent user-id resolver
- `kick:avatar:{slug}` — Kick profile_picture cache (7 days, populated when broadcaster is live)
- `cron:live-scan:cursor`, `cron:pass-count`, `cron:handle-map:v1` — scheduler state
- `cron:last-run`, `sessions:last-run` — diagnostic summaries (7-day TTL)
- `uk-rp-live:cache` — endpoint response cache (30s)
- `clips:{24h|7d|30d}:cache` — Clip Wall response cache (5 min)
- `timeline:{today|yesterday|7d}:cache` — Timeline response cache (5 min)
- `cfx:populations:cache` — CFX populations cache (60s)
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
| `ADMIN_TOKEN` | `admin/{discovery, beef, lore, backfill-avatars}` | Bearer auth |
| `ADMIN_PASSWORD` | `_lib.js`'s `requireAdminAuth` | currently unused after cleanup; kept for legacy revival |
| `ANTHROPIC_API_KEY` | currently unused | reserved for Phase 4 AI summaries |

**Planned (Phase 4+):**
| Var | Purpose |
|---|---|
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok Display + Embed APIs |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `DISCORD_WEBHOOK_URL` | Phase 5 live notifications |

**Scheduler worker (`contentlore-scheduler`)**
| Var | Purpose |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | polling |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | polling (official API since Phase 1) |
| `ADMIN_PASSWORD` | gates `/trigger`, `/rebuild-sessions`, `/backfill-sessions` |

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
Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running is safe. Migration numbering has historical gaps and a duplicate (002, 004, two 005, 006, 008, 009 — no 003 or 007). Pick the next free number for new ones.

### Smoke tests after deploy
```bash
curl https://contentlore.com/api/uk-rp-live   | jq '.live_count, .count'
curl https://contentlore.com/api/live-now     | jq '.count'
curl https://contentlore.com/api/clips        | jq '.count'
curl https://contentlore.com/api/timeline     | jq '.count'
curl https://contentlore.com/api/cfx-populations | jq '.total_returned'
curl https://contentlore-scheduler.dynamomc2019.workers.dev/status | jq '.poll.creators_processed'
```
All should return non-zero. The scheduler `/status` shows the most recent poll summary.

---

## 10. Conventions & gotchas

- **All handles are stored lowercase.** Compare lowercased on both sides
- **Allowlist source of truth** is `functions/api/uk-rp-live.js`. The `SERVERS` array on `gta-rp/servers/index.html` (mirrored in `functions/api/cfx-populations.js`) is the source for server metadata. When you add a new server with a CFX ID, update **both** locations.
- **`_redirects` has a SPA-style catch-all** (`/* /index.html 200`). Any unmatched route returns the homepage with HTTP 200, never a real 404. Useful for SEO continuity, but means broken links don't surface as errors.
- **`_routes.json` controls Function routing.** `include` list captures paths for Functions; everything else is static. New Function paths (e.g. `/creator-profile/*`, `/api/streaks/*`) must be added or they fall through to the catch-all and serve the homepage.
- **D1 platform records can drift from the curated allowlist.** Always source-of-truth the allowlist; treat `creator_platforms.platform` as a hint that needs reconciling. Tyrone (was `kick`+`rising`) and reeclare (was `kick`) got fixed in 2026-04-27 — they're now both `twitch`+`creator`.
- **16 of 22 allowlisted creators aren't in the `creators` table yet.** Only bags, dynamoses, kavsual, reeclare, samham, tyrone exist there as of 2026-04-27. Profile stats / server affinity / timeline rows are empty for the other 16 until the scheduler discovers and adds them. Code path is correct; data is sparse.
- **`scene_snapshots` was empty for weeks** because the scheduler's `scenes.js` queried a non-existent `creator_snapshots` table with wrong column names AND used a US-server keyword registry. Fix deployed 2026-04-27 — `scenes.js` now reads `snapshots` joined to `creators`/`creator_platforms` with the canonical UK 12-server list (mirrored from `functions/api/timeline.js`'s SERVERS array). If `scene_snapshots` ever stalls again, check (1) whether `snapshots` has fresh `is_live=1` rows in the last 30 minutes, (2) whether `stream_title` actually contains a UK server keyword — non-RP titles (e.g. just "GTA RP UK") will skip the row.
- **Twitch iframe autoplay warning** — Twitch refuses `autoplay=true` if the iframe was hidden when the `src` was set. If multi-view loads tiles before the container is rendered, console fills with "Couldn't autoplay because of style visibility checks". Phase 2 multi-view improvements include the fix as an open item.
- **`functions/_scheduled.js`** is the legacy in-Pages cron handler. **Cloudflare Pages doesn't fire crons for Pages Functions** — only the standalone Worker (`contentlore-scheduler`) actually runs on a schedule. The Pages-side file is dead code preserved for reference until safely removed.
- **CFX server IDs are 6-character hashes**, not derivable from server names. Public server search isn't a documented FiveM API; use `gtaboom.com/servers/{id}` URLs from web search to discover candidates, then verify against `https://servers-frontend.fivem.net/api/servers/single/{id}`. 7 of our 12 UK servers are whitelist-only with IPs gated behind Discord — no public CFX ID available.
- **Site-wide animation policy: no flicker, no glitch, no CRT.** All such animations were stripped in `60c3450`. Only the static `body::before` scanline overlay remains. If a future feature needs motion, prefer subtle `transform`/`opacity` transitions on hover rather than ambient infinite animations.

---

## 11. Session Log

Brief notes on what shipped each working session. Dates are UTC.

### 2026-04-26 — Foundation cleanup + project bible
- **Cleanup sweep** (`7d02190`): removed 28 orphaned Functions, 12 dead asset files, 11k+ lines of stale CSS (~75% codebase reduction)
- **Critical fixes**: homepage nav (dead `/the-platform/` and `/about/` links), `/api/admin/discovery` schema mismatch, dropped duplicate `migrations/007_scene_snapshots.sql`
- **CLAUDE.md authored** (`998be77` initial, `63f8065` complete) — established the 22-creator allowlist, 12 UK servers, competitive landscape, 5-phase roadmap

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

**CLAUDE.md sync** (this commit) — flipped Phase 4 statuses, recorded scenes-fix diagnosis as a permanent gotcha, added this entry.

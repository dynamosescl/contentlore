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
  - Scheduler worker: `D:/contentlore-scheduler` (separate repo, deploy via `npx wrangler deploy`)

**Key URLs**
- `https://contentlore.com/` — homepage
- `https://contentlore.com/gta-rp/` — live hub (the curated 22)
- `https://contentlore.com/gta-rp/multi/` — 6-tile multi-view
- `https://contentlore.com/gta-rp/now/` — real-time scene ticker
- `https://contentlore.com/gta-rp/servers/` — UK RP server directory
- `https://contentlore.com/mod/` — admin dashboard (requires `ADMIN_TOKEN`)
- `https://contentlore.com/admin/content.html` — beef + lore editor
- `https://contentlore.com/admin/discovery.html` — pending creator triage
- `https://contentlore-scheduler.dynamomc2019.workers.dev/status` — last poll/session summaries

---

## 2. Current State (post-cleanup)

**Active pages (10):** `/`, `/gta-rp/{,now/,multi/,servers/,fivem-enhanced/,gta-6/}`, `/mod/`, `/admin/{content,discovery}.html`

**Active Functions (11):** `uk-rp-live`, `live-now`, `creators`, `stats`, `beefs`, `lore-arcs`, `admin/{discovery, beef, lore, backfill-avatars}` — plus `_lib.js`, `_scheduled.js`

**22-creator allowlist:**
- 16 Twitch: tyrone, lbmm, reeclare, stoker, samham, deggyuk, megsmary, tazzthegeeza, wheelydev, rexality, steeel, justj0hnnyhd, cherish_remedy, lorddorro, jck0__, absthename
- 6 Kick: kavsual, shammers, bags, dynamoses, dcampion, elliewaller

**12 UK servers tracked:** Unique, TNG, Orbit, New Era, Prodigy, D10, Unmatched, VeraRP, The Endz, Let's RP, Drill UK, British Life

**Data pipeline:** Scheduler worker (every 15 min) → polls Twitch/Kick → `snapshots` → `stream_sessions` → `scene_snapshots`. `/api/uk-rp-live` bypasses DB entirely and queries Twitch + Kick APIs directly for the 22 allowlisted creators (30s KV cache).

**Codebase size:** ~4,000 lines after cleanup (was ~15,000). Zero orphaned Functions. Zero dead assets. Zero pink/magenta surfaces remaining (all electric blue/cyan).

---

## 3. Competitive Landscape

**HasRoot** (`gtarp.hasroot.com`) is the closest competitor — US-focused, tracks NoPixel + 20 other servers. Features ContentLore doesn't have yet:
- Clip Activity Feed (auto-pulls trending Twitch clips)
- Clip Search across all tracked creators
- VOD History browser
- Streamer Activity Timeline (visual schedule heatmap)
- Character Database (who plays which character on which server)
- Server-specific subdomains
- Streamer Login (creators claim their profile)
- Browser push notifications when tracked creators go live

**Other analytics platforms:**
- **StreamsCharts** — multi-platform live stats
- **SullyGnome** — Twitch deep analytics
- **TwitchTracker** — Twitch stats and charts
- **GTA Genius** — GTA RP specific

**Niche advantage:** none of them focus on the UK scene. That's our wedge — be the definitive UK GTA RP discovery + intelligence surface.

---

## 4. Platform Expansion

The site currently tracks Twitch + Kick. Expansion plan:

**Kick — migrate to official API**
Now has official public API at `docs.kick.com` with OAuth 2.1. Endpoints: channels, livestreams, categories. Has webhooks for `stream.online` / `stream.offline` events. ContentLore should migrate from v1/v2 endpoint scraping to the official API. `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` already set in env.

**TikTok — content discovery layer**
Most UK GTA RP creators post highlights to TikTok. Display API gives profile info + recent videos. Embed API shows TikTok videos inline. Use for surfacing clips/highlights — not live tracking. Requires TikTok developer registration + app review (3-7 days).

**YouTube — long-form content footprint**
Some creators upload VODs and edited content. YouTube Data API v3 gives channel stats, recent uploads, live stream status. Free tier generous (10,000 quota/day). Useful for creator profiles showing full content footprint.

---

## 5. Design Direction

**Established (DONE):**
- Site-wide colour: electric blue/cyan `oklch(0.82 0.20 195)` — zero pink remaining
- Fonts: Bebas Neue (display), Inter (body), JetBrains Mono (code)
- Effects: scanline overlay, CRT flicker, neon glow animations on hub pages
- Logo: CL monogram with play button (ChatGPT-generated, recoloured to blue)

**Outstanding:**
- More animations / micro-interactions
- Hero background videos
- Card depth (shadow layering, parallax)
- Mobile-first multi-view layout
- Homepage CRT flicker animation (`body::after` missing — present on `/gta-rp/*` but not `/`)
- Compress `logo.png` from 298 KB to ~50 KB
- Admin pages (`admin/content.html`, `admin/discovery.html`) still use old Oswald/magenta design — port to Bebas/oklch or merge into `/mod/`

---

## 6. Roadmap

Phase boundaries are guidelines, not contracts. Reorder freely. `[x]` = done, `[~]` = code complete pending verification, `[ ]` = open.

### PHASE 1 — FOUNDATION (quick wins)
- [ ] Switch to official Kick API (drop v1/v2 endpoint reliance in both `functions/api/uk-rp-live.js` and `contentlore-scheduler/src/polling.js`)
- [ ] Fix homepage CRT flicker (missing `body::after` animation)
- [ ] Compress `logo.png` (298 KB → ~50 KB via WebP or PNG optimisation)
- [ ] Move stream thumbnail `{width}x{height}` substitution server-side in `uk-rp-live`
- [ ] Add cache headers to hot endpoints (`s-maxage=20` on `uk-rp-live` and `live-now`)
- [ ] Add TikTok + YouTube handle fields to allowlist data structure
- [ ] Port `admin/content.html` and `admin/discovery.html` to Bebas/oklch design (or merge into mod panel)
- [~] Fix `/api/admin/discovery` approve flow (schema mismatch — fixed in commit `7d02190`, **needs smoke test against live D1**)
- [x] Delete `migrations/007_scene_snapshots.sql` (conflict with 004) — done in cleanup
- [x] Scheduler: fix broken Kick HTML regex in `contentlore-scheduler/src/polling.js` — done in commit `0ff3d31` (replaced with v1→v2 fallback; will be superseded by official Kick API migration)

### PHASE 2 — ENGAGEMENT (the features that drive repeat visits)

- [ ] **Clip Wall** — auto-pull top clips from Twitch Clips API + Kick clips for all 22 creators. Masonry grid, filterable by creator/server/platform/date. Click to play inline. Share button. **#1 traffic driver.**
- [ ] **Creator Profiles** — individual page per creator at `/creator/{handle}`. Multi-platform presence (Twitch, Kick, TikTok, YouTube links with follower counts). Stream history heatmap (30 days). Stats (avg viewers, peak, hours, top servers). Recent clips. Server affinity from title detection. Social links. "Claim this profile" flow for creators to verify and add info.
- [ ] **Server Status Dashboard** — "flight departures board" aesthetic. CFX API integration for real-time player counts (`https://servers-frontend.fivem.net/api/servers/single/{server_id}`). Rows: Server Name | Status | Players/Max | Peak Today | Top Streamer. Historical population line charts. Health indicator (growing/stable/declining from 30-day trend). Alert when server hits peak. Refreshes every 60s.
- [ ] **Scene Timeline / "What Happened Today"** — visual timeline showing who was live when, which server, how long. Like a TV guide for RP. Review yesterday's scene at a glance. Uses `scene_snapshots` data from scheduler.

#### Multi-View Improvements
- [ ] Mobile layout — single stream with swipeable tabs for switching creators + chat
- [ ] Bigger tiles — when only 1-2 streams selected, make them fill the screen properly
- [ ] Stream info overlay — show game name, viewer count, uptime below each tile (not just badges)
- [ ] Picture-in-picture mode — pop out a stream while browsing other pages
- [ ] Quick-add from live page — button on each stream card that adds directly to multi-view without navigating
- [ ] Layout presets — 1×1 (focus), 2×1 (side by side), 2×2 (quad), 3×2 (six pack)
- [ ] Persistent selections — remember your last multi-view setup across sessions (localStorage)
- [ ] Better empty state — show previews/thumbnails of who's live with one-click add buttons instead of just "Stage's empty"
- [ ] Fix Twitch autoplay warning — ensure iframe is visible before loading `src` to satisfy Twitch's style-visibility requirement

### PHASE 3 — GAMIFICATION (community stickiness)
- [ ] **Watch Streaks** — track daily visits (opt-in, persistent storage API). Streak counter. Badges: Week Warrior (7d), Month Regular (30d), Scene Veteran (100d). Leaderboard. Could tie into Discord roles for verified streak holders.
- [ ] **"Who Should I Watch?" Randomiser** — button picks a currently-live creator and loads their stream. Fun discovery mechanism.
- [ ] **Predictions / Polls** — "Who will have most viewers tonight?", "Which server busiest this weekend?" Community votes with tracked results.
- [ ] **RP Awards** — monthly community vote: Best Newcomer, Most Dramatic Scene, Best Police Chase, Funniest Moment. Drives engagement and creator recognition.
- [ ] **Scene Bingo** — auto-generated bingo card per session: "Someone gets pulled over", "Gang war starts", "Tyrone does something chaotic". Community marks off squares.

### PHASE 4 — INTELLIGENCE (data depth)
- [ ] **GTA 6 Deep Dive** — live news feed (RSS / web sources) about GTA 6 RP modding progress. Community sentiment tracker poll with historical results. Creator transition plans (survey data). Visual countdown timeline with milestones. Impact calculator ("If X% viewers move to GTA 6, here's what happens to UK scene").
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
│   Twitch helix          Kick v1/v2 (→ official API in Phase 1)     │
│   (Future: TikTok Display API, YouTube Data API v3)                │
└──────────────┬───────────────────────────┬─────────────────────────┘
               │                           │
               ▼                           ▼
┌─────────────────────────┐    ┌──────────────────────────┐
│  contentlore-scheduler  │    │  Pages Function          │
│  (Cloudflare Worker)    │    │  /api/uk-rp-live         │
│  cron */15 * * * *      │    │  per-request fetch       │
│                         │    │  30s KV cache            │
│  polling → snapshots    │    │                          │
│  sessions → stream_     │    │  bypasses DB entirely    │
│             sessions    │    │                          │
│  scenes  → scene_       │    └──────────────┬───────────┘
│             snapshots   │                   │
│  discovery → pending_   │                   │
│              creators   │                   │
└──────────┬──────────────┘                   │
           │                                  │
           ▼                                  │
┌──────────────────────────┐                  │
│  D1: contentlore-db      │                  │
│   creators               │                  │
│   creator_platforms      │                  │
│   creator_edges          │                  │
│   snapshots              │                  │
│   stream_sessions        │                  │
│   scene_snapshots        │                  │
│   pending_creators       │                  │
│   beefs                  │                  │
│   lore_arcs              │                  │
└──────────┬───────────────┘                  │
           │                                  │
           ▼                                  ▼
┌──────────────────────────────────────────────────────┐
│  Pages Functions (read-side)                         │
│   /api/live-now    DB-backed live list               │
│   /api/creators    paged directory                   │
│   /api/stats       aggregates                        │
│   /api/beefs       /api/lore-arcs   editorial        │
│   /api/admin/*     write surface (Bearer token)      │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Static HTML pages                                   │
│   /gta-rp/         curated hub          (uk-rp-live) │
│   /gta-rp/multi/   6-tile player        (uk-rp-live) │
│   /gta-rp/now/     scene ticker         (live-now)   │
│   /gta-rp/servers/ server dir           (live-now)   │
│   /                homepage             (live-now)   │
│   /mod/            admin dashboard      (mixed)      │
└──────────────────────────────────────────────────────┘
```

**Two live-state paths exist by design:**
- `/api/uk-rp-live` for the **curated 22** — direct platform API, deterministic, bypasses noisy DB
- `/api/live-now` for **anyone in the DB** — used by `/now` and `/servers` because they want to surface non-allowlist activity

**KV keys in use** (mostly TTL'd, safe to clear if anything goes weird):
- `twitch:app_token`, `kick:app_token` — OAuth caches (~55 min)
- `twitch:user-id:{handle}` — permanent user-id resolver
- `cron:live-scan:cursor`, `cron:pass-count`, `cron:handle-map:v1` — scheduler state
- `cron:last-run`, `sessions:last-run` — diagnostic summaries (7-day TTL)
- `uk-rp-live:cache` — endpoint response cache (30s)

---

## 8. Credentials (env vars)

Set in the Cloudflare dashboard for each project. **Never commit values.**

**Pages (`contentlore`)**
| Var | Used by | Purpose |
|---|---|---|
| `TWITCH_CLIENT_ID` | `_lib.js`, `uk-rp-live` | helix API |
| `TWITCH_CLIENT_SECRET` | same | helix API OAuth |
| `KICK_CLIENT_ID` | `_lib.js`, future official API client | Kick OAuth 2.1 |
| `KICK_CLIENT_SECRET` | same | Kick OAuth 2.1 |
| `ADMIN_TOKEN` | `admin/{discovery, beef, lore, backfill-avatars}` | Bearer auth |
| `ADMIN_PASSWORD` | `_lib.js`'s `requireAdminAuth` | currently unused after cleanup; kept for legacy revival |
| `ANTHROPIC_API_KEY` | currently unused | reserved for Phase 4 AI summaries |

**Planned (Phase 1+):**
| Var | Purpose |
|---|---|
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok Display + Embed APIs |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `DISCORD_WEBHOOK_URL` | Phase 5 live notifications |

**Scheduler worker (`contentlore-scheduler`)**
| Var | Purpose |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | polling |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | polling (and official API after migration) |
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
Updates take effect immediately. Cron continues on its existing schedule.

### Database migrations
```bash
# Local dry-run
npx wrangler d1 execute contentlore-db --file=migrations/00X_name.sql

# Production
npx wrangler d1 execute contentlore-db --file=migrations/00X_name.sql --remote
```
Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running is safe. **Migration numbering has duplicates** (two `005_` files). Pick the next free number for new ones.

### Smoke tests after deploy
```bash
curl https://contentlore.com/api/uk-rp-live | jq '.live_count, .count'
curl https://contentlore.com/api/live-now   | jq '.count'
curl https://contentlore-scheduler.dynamomc2019.workers.dev/status | jq '.poll.creators_processed'
```
All three should return non-zero numbers. The scheduler `/status` shows the most recent poll summary.

---

## 10. Conventions & gotchas

- **All handles are stored lowercase.** Compare lowercased on both sides
- **Allowlist source of truth** is `functions/api/uk-rp-live.js`. Phase 2's "in-UI allowlist editor" task will move it to D1/KV for editability
- **Kick v1/v2 endpoint scraping** is the current fallback chain after the HTML regex died (Kick switched to Next.js streaming hydration in April 2026). Phase 1's official API migration replaces both
- **`_redirects` has a SPA-style catch-all** (`/* /index.html 200`). Any unmatched route returns the homepage with HTTP 200, never a real 404. Useful for SEO continuity, but means broken links don't surface as errors
- **Tyrone's record has `role='rising'`** in the live D1, which excludes him from `/api/live-now` (that query filters `WHERE role = 'creator'`). One-off oddity — fix manually in the dashboard if it matters; or rely on `/api/uk-rp-live` which doesn't touch the DB
- **Twitch iframe autoplay warning** — Twitch refuses `autoplay=true` if the iframe was hidden when the `src` was set. If the multi-view loads tiles before the container is rendered, console fills with "Couldn't autoplay because of style visibility checks". Phase 2 multi-view improvements include the fix
- **`functions/_scheduled.js`** is the legacy in-Pages cron handler. **Cloudflare Pages doesn't fire crons for Pages Functions** — only the standalone Worker (`contentlore-scheduler`) actually runs on a schedule. The Pages-side file is dead code preserved for reference until safely removed

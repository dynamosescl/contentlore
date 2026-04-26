# ContentLore — Project Guide

A living document for anyone (or any agent) working on this repo. Update as the project evolves.

---

## 1. Project Overview

**ContentLore** is a UK GTA RP streaming intelligence platform. It tracks a curated 22-creator allowlist across Twitch and Kick, surfaces who's live, and provides a multi-stream viewer for the UK roleplay scene.

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

## 2. Current State

**Active pages (10):**
- `index.html`, `gta-rp/{,now/,multi/,servers/,fivem-enhanced/,gta-6/}`, `mod/`, `admin/{content,discovery}.html`
- Top-level redirect stubs (kept for SEO continuity): `about/`, `contact/`, `creators/`, `ethics/`, `ledger/`, `rising/`, `signals/`, `the-platform/{,element-club/,frameworks/,tebex-audit/,2026/04/...}`, `gta-rp/{beef,lore}/`

**Active Functions (11):**
- Public read: `uk-rp-live` (curated allowlist, bypasses DB), `live-now` (DB-backed full live list), `creators`, `stats`, `beefs`, `lore-arcs`
- Admin (Bearer `ADMIN_TOKEN`): `admin/{discovery, beef, lore, backfill-avatars}`
- Shared: `_lib.js` (Twitch/Kick OAuth, helpers), `_scheduled.js` (legacy in-Pages cron, superseded by the worker)

**Data pipeline (every 15 min):**
1. Worker `scheduler/polling.js` → polls 12 creators round-robin via `cron:live-scan:cursor`, writes `snapshots` (live state + viewer count + title), scrapes mentions into `creator_edges`
2. Worker `scheduler/sessions.js` → stitches consecutive `is_live=1` snapshots into `stream_sessions` (gap > 20 min closes a session)
3. Worker `scheduler/scenes.js` → groups live creators by detected server → writes `scene_snapshots`
4. Worker `scheduler/discovery.js` → scans Twitch GTA V category for new UK RP streams → upserts into `pending_creators`
5. `/api/uk-rp-live` does NOT use this DB pipeline — it queries Twitch + Kick directly per request (30s KV cache) for the 22 curated handles

**Critical caveat:** the curated 22 are mostly NOT in the DB. The DB has ~7,766 auto-discovered creators that don't matter for the product. The hub bypasses this entirely via `/api/uk-rp-live`.

---

## 3. Roadmap

Phase boundaries are guidelines, not contracts. Reorder freely.

### Phase 1 — Polish (quick wins)
- [ ] Add the missing `body::after` CRT flicker animation to `index.html` so the homepage matches the rest of `/gta-rp/*`
- [ ] Compress `logo.png` (298 KB → ~50 KB target). Loaded eagerly on every page; biggest single asset
- [ ] Move Twitch thumbnail `{width}x{height}` substitution from `gta-rp/index.html`'s `getThumb()` into `/api/uk-rp-live` server-side (return concrete URLs for two sizes)
- [ ] Add cache headers to hot endpoints: `s-maxage=20` on `/api/uk-rp-live`, `s-maxage=15` on `/api/live-now`. The KV cache already de-dupes; CF edge cache would let multiple users share one fetch
- [ ] Unify admin design: port `admin/content.html` and `admin/discovery.html` from Oswald/magenta-cyan to Bebas/oklch — or fold both into `/mod/` as new tabs and retire `admin/*.html`

### Phase 2 — Features
- [ ] Creator profile pages: `/creator/{handle}` showing stream history, peak/avg viewers, primary servers, follower trend. Source: `stream_sessions` + `snapshots` for the curated 22
- [ ] Server detail pages with CFX live player counts (CFX has a public API). Currently `/gta-rp/servers/` only shows live-streaming creator counts
- [ ] Scene detection: auto-tag which server each creator is on from their stream title. Reuse the keyword logic in `scheduler/scenes.js`
- [ ] `/now` page enrichment once `scene_snapshots` has accumulated multiple weeks: server-population deltas, "trending up/down" servers
- [ ] Mod panel: in-UI allowlist editor — currently the 22-creator list is hardcoded in `functions/api/uk-rp-live.js`. Move to D1 or KV so it can be edited without a deploy

### Phase 3 — Growth
- [ ] Expand allowlist beyond 22 — fix the discovery-to-approval pipeline (also covers the C2 schema bug fix from the cleanup pass; smoke-test live before relying on it)
- [ ] Social sharing — generate OG images per page (homepage, hub, multi, individual creators). The old `og/*` Functions were deleted in cleanup; re-add when needed
- [ ] Discord webhook on allowlisted creator going live (poll-based: scheduler detects state transition `is_live: false → true`)
- [ ] Weekly digest — server-rendered page or email summarising scene activity (top creators by hours, biggest single streams, new beefs)
- [ ] Mobile PWA — manifest + service worker; the multi-view especially benefits from "add to home screen" on tablets

### Phase 4 — Intelligence
- [ ] Historical analytics — viewer trends per creator, server population charts. `stream_sessions` already has the data; needs a chart-rendering surface
- [ ] Creator network graph — render `creator_edges` (raid/host/shoutout) as an interactive graph. Old `assets/network.js` had a draft; deleted in cleanup but recoverable from git history
- [ ] Server health scores — composite of live-creator count, total viewers, viewer retention; surface trend arrows on `/gta-rp/servers/`
- [ ] Automated daily/weekly scene reports — AI-generated summaries of what happened. `ANTHROPIC_API_KEY` is already provisioned (was used by the deleted `enrich-batch.js`)

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                               │
│   Twitch helix API           Kick v1/v2 API + HTML scrape          │
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
│   /api/live-now    DB-backed live list                │
│   /api/creators    paged directory                    │
│   /api/stats       aggregates                         │
│   /api/beefs       /api/lore-arcs   editorial         │
│   /api/admin/*     write surface (Bearer token)       │
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

## 5. Credentials (env vars)

Set in the Cloudflare dashboard for each project. **Never commit values.**

**Pages (`contentlore`)**
| Var | Used by | Purpose |
|---|---|---|
| `TWITCH_CLIENT_ID` | `_lib.js`, `uk-rp-live` | helix API |
| `TWITCH_CLIENT_SECRET` | same | helix API OAuth |
| `KICK_CLIENT_ID` | `_lib.js` | optional — public Kick API |
| `KICK_CLIENT_SECRET` | same | optional |
| `ADMIN_TOKEN` | `admin/{discovery, beef, lore, backfill-avatars}` | Bearer auth |
| `ADMIN_PASSWORD` | `_lib.js`'s `requireAdminAuth` | currently unused after cleanup; kept for future legacy revival |
| `ANTHROPIC_API_KEY` | currently unused after cleanup | reserved for Phase 4 AI summaries |

**Scheduler worker (`contentlore-scheduler`)**
| Var | Purpose |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | polling |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | optional |
| `ADMIN_PASSWORD` | gates `/trigger`, `/rebuild-sessions`, `/backfill-sessions` |

**Two-token gotcha:** the Pages admin endpoints use `ADMIN_TOKEN` (Bearer). The scheduler worker uses `ADMIN_PASSWORD` (`X-Admin-Password` header). The mod panel knows both — token for Pages calls, password for scheduler calls. Don't unify them without updating mod panel JS.

---

## 6. Deployment

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
Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running is safe. **Migration numbering has duplicates** (two `005_` files, `004` and `007` both for scene_snapshots before the 007 cleanup). Pick the next free number for new ones.

### Smoke tests after deploy
```bash
curl https://contentlore.com/api/uk-rp-live | jq '.live_count, .count'
curl https://contentlore.com/api/live-now   | jq '.count'
curl https://contentlore-scheduler.dynamomc2019.workers.dev/status | jq '.poll.creators_processed'
```
All three should return non-zero numbers. The scheduler `/status` shows the most recent poll summary.

---

## 7. Conventions & gotchas

- **All handles are stored lowercase.** Compare lowercased on both sides
- **The 22-creator allowlist** is duplicated between `gta-rp/index.html` and `gta-rp/multi/index.html` (legacy) and `functions/api/uk-rp-live.js` (canonical). The HTML copies are no longer used since the endpoint returns the full list — safe to drop on next touch
- **Kick HTML scraping is dead** — Kick moved to Next.js streaming hydration (April 2026). Don't try to regex the page; use v1 with v2 fallback (already done in `uk-rp-live.js` and `scheduler/polling.js`)
- **`_redirects` has a SPA-style catch-all** (`/* /index.html 200`). Any unmatched route returns the homepage with HTTP 200, never a real 404. Useful for SEO continuity, but means broken links don't surface as errors
- **Tyrone's record has `role='rising'`** in the live D1, which excludes him from `/api/live-now` (that query filters `WHERE role = 'creator'`). One-off oddity — fix it manually in the dashboard if it matters

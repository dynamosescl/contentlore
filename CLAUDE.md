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
- `https://contentlore.com/gta-rp/health/` — Scene Health dashboard (week-over-week deltas + trend banner + cross-server drama feed)
- `https://contentlore.com/gta-rp/compare/` — head-to-head server comparison tool
- `https://contentlore.com/gta-rp/party/` — Watch Party (synced viewing + shared chat)
- `https://contentlore.com/gta-rp/streaks/` — opt-in daily-visit tracker
- `https://contentlore.com/gta-rp/servers/` — RP server status board
- `https://contentlore.com/gta-rp/fivem-enhanced/` — FiveM Enhanced migration tracker
- `https://contentlore.com/gta-rp/gta-6/` — platform deep-dive
- `https://contentlore.com/creator-profile/{handle}` — per-creator profile (dynamic Function)
- `https://contentlore.com/wrapped/{handle}` — Spotify-Wrapped-style monthly recap (dynamic Function)
- `https://contentlore.com/submit/` — public creator submission form (rate-limited 3/IP/day)
- `https://contentlore.com/mod/` — admin dashboard (requires `ADMIN_TOKEN`)
- `https://contentlore.com/admin/content.html` — beef + lore editor
- `https://contentlore.com/admin/discovery.html` — pending creator triage
- `https://contentlore-scheduler.dynamomc2019.workers.dev/status` — last poll/session summaries

---

## 2. Current State

**Active hub surfaces (22):**
- Static pages (17): `/`, `/submit/`, `/gta-rp/{,now/,multi/,party/,clips/,timeline/,analytics/,network/,health/,streaks/,servers/,compare/,rankings/,fivem-enhanced/,gta-6/}`
- Admin pages (3): `/mod/`, `/admin/content.html`, `/admin/discovery.html`
- Dynamic pages (4): `/creator-profile/{handle}` rendered by `functions/creator-profile/[handle].js`; `/wrapped/{handle}` rendered by `functions/wrapped/[handle].js` (Spotify-Wrapped-style monthly recap, _routes.json includes `/wrapped/*`); `/api/shoutout-card/{handle}` is also a server-rendered HTML page (it's under `/api/` only by URL convention, but it returns HTML and serves as the og:image target for profile pages); `/api/widget/{handle}` ditto — server-rendered 300×100 HTML for embedding.

Every hub page is now a PWA candidate — manifest linked, theme-color set, service worker registered via `/pwa.js`. Mobile (<=768px) gets a fork of `/gta-rp/multi/` (single stream + chat below + bottom tabbar + roster bottom-sheet); the global nav collapses to a hamburger drawer at <=900px.

The repo also contains several legacy directories (`about/`, `contact/`, `creators/`, `ethics/`, `ledger/`, `rising/`, `signals/`, `the-platform/`, `gta-rp/beef/`, `gta-rp/lore/`) that survived the 2026-04-26 cleanup sweep but aren't part of the active navigation. They serve via `_redirects` catch-all if anyone deep-links them. Worth a re-audit eventually.

**Active Pages Functions (50, plus 2 helpers):**

| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/curated-list` | `api/curated-list.js` | Public read of `curated_creators` D1 table. 5-min Cache API. Used by anything outside the Functions runtime that needs the canonical allowlist; within Functions, prefer `import { getCuratedList } from '../_curated.js'` directly. |
| `GET\|POST\|PUT\|DELETE /api/admin/curated` | `api/admin/curated.js` | Bearer-authed CRUD over `curated_creators`. POST = upsert, PUT = partial update, DELETE = soft-deactivate (`?hard=1` to drop the row). Every mutation calls `invalidateCuratedCache()` in `_curated.js` so subsequent reads see fresh data. |
| `GET /api/uk-rp-live` | `api/uk-rp-live.js` | Curated allowlist live state with full multi-platform `socials` per entry (direct platform APIs, 30s Cache API). Allowlist sourced from D1 via `_curated.js`. |
| `GET /api/live-now` | `api/live-now.js` | DB-backed live list (anyone in `creators` table) |
| `GET /api/clips?range=24h\|7d\|30d` | `api/clips.js` | Top Twitch clips for the 20 Twitch handles, GTA V + Just Chatting filtered, 5-min Cache API |
| `GET /api/timeline?range=today\|yesterday\|7d` | `api/timeline.js` | `stream_sessions` rows overlapping window for the 26, server-id annotated, 5-min Cache API |
| `GET /api/analytics` | `api/analytics.js` | 7d hourly viewer buckets, 7×24 heatmap, server-hours bars, week-over-week growth, 30d follower trend per creator. 5-min Cache API |
| `GET /api/network` | `api/network.js` | Curated-26 nodes (avg viewer weight) + curated-only edges from `creator_edges`. 5-min Cache API |
| `GET /api/digest` | `api/digest.js` | "This week in UK GTA RP" report — peak moment, top creators, top clips (delegates to `/api/clips?range=7d`), new pending_creators, server hours. 10-min Cache API |
| `GET /api/scene-recap` | `api/scene-recap.js` | Claude-generated 200-word narrative recap of last 7d. Pulls digest + analytics, calls Anthropic API (`claude-sonnet-4-6`, 500 max_tokens, ephemeral cache_control on system prompt), 6h Cache API. Falls back to deterministic prose template if `ANTHROPIC_API_KEY` is missing or the call fails. |
| `GET\|POST /api/daily-recap` | `api/daily-recap.js` | Daily AI-written narrative for one UTC day. GET returns most recent stored row (or `?date=YYYY-MM-DD`/`?days=N`). POST (Bearer-authed) computes that day's metrics from D1 and asks Claude for a ~150-word recap; idempotent UPSERT into `daily_recaps`. Used by `/gta-rp/digest/` (Yesterday section) and the Discord daily summary. |
| `GET\|POST /api/clip-of-day` | `api/clip-of-day.js` | One AI-picked clip per UTC day with a ~50-word caption. POST (Bearer-authed) sends yesterday's top-10 clips by view count to Claude and stores `{index, caption}` in `clip_of_day`. Falls back to first-by-views if Anthropic fails. Surfaced as a hero card on `/gta-rp/clips/` and the homepage feed. |
| `GET /api/server-reviews` | `api/server-reviews.js` | Weekly auto-graded report card per RP server (last 7d): hours, unique streamers, viewer-hours, week-over-week growth, top 3 streamers, A/B/C/D/F grade. One batched Anthropic call returns a one-sentence summary per server. Falls back to a deterministic sentence per row if Claude fails. 1h Cache API. Powers the report-cards section on `/gta-rp/servers/`. |
| `GET /api/rankings` | `api/rankings.js` | Weekly Power Rankings — composite 0-100 score per curated streamer (avg viewers 40% + hours 30% + sessions 20% + growth 10%). Movement = last_week_rank - this_week_rank. Includes 7-day daily-bucketed sparkline per row. 5-min Cache API. Powers `/gta-rp/rankings/`. |
| `POST /api/submit-clip` | `api/submit-clip.js` | Public clip submission. Parses Twitch + Kick clip URLs, validates the creator is in the curated allowlist. KV rate limit 5/IP/UTC day. Dedupes by URL. Inserts into `clip_submissions` with status='pending'. |
| `GET\|POST /api/admin/clip-submissions` | `api/admin/clip-submissions.js` | Bearer-authed list (filter by status) + decide (approve/reject with optional note). |
| `GET /api/widget/{handle}` | `api/widget/[handle].js` | Self-contained 300×100 HTML card meant to be iframe-embedded on creators' linktrees / sites. Avatar + name + LIVE pill + viewer count + platform pills. 60s edge cache + 60s soft-reload. CSP frame-ancestors:* so it can be embedded anywhere. |
| `GET /api/scene-health` | `api/scene-health.js` | Week-over-week deltas (viewer-hours, active creators, sessions, total hours), server distribution, peak hour-of-day, trend label (Growing / Stable / Cooling / Building). 5-min Cache API. Powers `/gta-rp/health/`. |
| `GET /api/server-switches` | `api/server-switches.js` | "Cross-Server Drama Tracker" — for each curated creator, compares this-week's most-played server against last-week's. Emits one row per detected switch (only when both weeks ≥60 mins on the dominant side, so churn doesn't spam). Sorted by this-week minutes descending. 5-min Cache API. Powers the "Recent server switches" section on `/gta-rp/health/`. |
| `GET /api/peak-prediction` | `api/peak-prediction.js` | Predicts tonight's scene peak from 30 days of `snapshots`. Collapses concurrent polls onto a 10-minute time grid (so curators sharing one tick roll into "scene total at moment T"), buckets by UK day-of-week × hour-of-day, picks today's dow's hour with the highest mean. Predicted peak count = top-quartile mean of polls in that hour. Confidence flag (high/moderate/thin/building) based on sample count. 1h Cache API. Surfaced on the homepage above the Live Right Now feed. |
| `POST /api/clip-react` | `api/clip-react.js` | Increments (or decrements when `undo:true`) the count for one clip+emoji pair. Emoji allowlist: 🔥 😂 😱 ❤️. Per-IP rate limit 30/UTC day in KV (`react:rl:{ip}:{ymd}`). Returns the resulting count. |
| `GET /api/clip-reactions?ids=a,b,c` | `api/clip-reactions.js` | Batch lookup of reaction counts. Max 200 IDs per request. SHA-1 hashed cache key, 60s edge cache. Used by `/gta-rp/clips/` grid and feed mode. |
| `GET /api/spotlight` | `api/spotlight.js` | Daily Spotlight pick. Algorithm rewards consistency (≥ median sessions in last 7d) then surfaces the underdog (lowest avg viewers in that pool), indexed by day-of-year. Falls back to alphabetical rotation. 24h Cache API keyed on UTC date — naturally rolls over at midnight. |
| `GET /api/hype` | `api/hype.js` | Live "scene energy" gauge. Compares current live count + viewer total to rolling 7-day avg for this UTC hour. Returns band + ratio_pct. 60s Cache API. |
| `GET /api/cfx-populations` | `api/cfx-populations.js` | Live FiveM player counts for 5 known server CFX IDs, 60s Cache API |
| `GET /api/scene-averages` | `api/scene-averages.js` | 7-day avg streamers/viewers per server from `scene_snapshots`, 5-min Cache API. Powers the "Avg" column on the servers status board |
| `POST /api/streaks/check-in` | `api/streaks/check-in.js` | Idempotent daily-visit increment (anonymous UUID), badge state |
| `GET /api/streaks/leaderboard?order=current\|max` | `api/streaks/leaderboard.js` | Top opt-in users with display names, 5-min Cache API |
| `GET\|POST /api/gta6-pulse` | `api/gta6-pulse.js` | Anonymous one-vote-per-device GTA 6 readiness poll, 30s Cache API tallies |
| `GET /api/push/vapid-public-key` | `api/push/vapid-public-key.js` | Hands `env.VAPID_PUBLIC_KEY` to clients for `pushManager.subscribe()` |
| `POST /api/push/subscribe` | `api/push/subscribe.js` | Upserts a `push_subscriptions` row keyed by endpoint (idempotent re-subscribes) |
| `POST /api/push/unsubscribe` | `api/push/unsubscribe.js` | Deletes a subscription by endpoint (anon — endpoint is the secret) |
| `POST /api/submit` | `api/submit.js` | Public creator-submission endpoint. KV-rate-limited 3 / IP / UTC day. Inserts into `pending_creators` with `notes` prefixed `SUBMITTED:` |
| `POST /api/party/create` | `api/party/create.js` | Creates a Watch Party. 6-char id (ambiguous I/O/0/1 excluded), 32-char host_token. Allowlist-validated handle. Rate-limited 10 / IP / UTC day. Returns `{id, host_token, expires_at}`. |
| `GET /api/party/{id}` | `api/party/[id].js` | Party state: current_handle, current_platform, expires_at, recent ≤50 messages. `?since=<unix-sec>` returns delta only. `cache-control: no-store` so chat polls always see fresh state. |
| `POST /api/party/{id}/message` | `api/party/[id]/message.js` | Append chat message. 1–32 char username, 1–280 char message (server-trims, strips control chars). 15 messages / IP / minute KV rate limit. Opportunistic 24h-old message cleanup on every write. |
| `PUT /api/party/{id}/stream` | `api/party/[id]/stream.js` | Host-only mutation: change which creator the party is watching. Requires `host_token`. Posts a `★ host` system message in chat so non-host viewers see the switch. |
| `* /api/shoutout-card/{handle}` | `api/shoutout-card/[handle].js` | Server-rendered 1200×630 HTML page acting as the social card for each curated creator. Used as og:image on `/creator-profile/{handle}`. html2canvas-driven "Download as image" button on the page. |
| `GET /api/creators` | `api/creators.js` | Paged creator directory (D1) |
| `GET /api/stats` | `api/stats.js` | Aggregate counters (D1) |
| `GET /api/beefs` | `api/beefs.js` | Editorial beef list (D1) |
| `GET /api/lore-arcs` | `api/lore-arcs.js` | Editorial lore arc list (D1) |
| `* /creator-profile/{handle}` | `creator-profile/[handle].js` | Server-rendered profile page (HTML response). Renders the multi-platform PLATFORMS section from `entry.socials`. Now also surfaces "Often plays with" peer cards (top 6 curated creators by stream-session overlap over the last 90 days) and a schedule-pattern strip above the heatmap (most-active days, typical start hour, "likely live next 3h" pill, next-likely-slot label). |
| `* /wrapped/{handle}` | `wrapped/[handle].js` | Spotify-Wrapped-style monthly recap. Up to 9 colour-gradient cards covering hours, home server, peak viewers, average, days streamed, peak hour, scene rank, top peer, best community clip. 10-min edge cache. Linked from the Monthly Report Card on `/creator-profile/{handle}` via "✨ View Wrapped". |
| `GET\|POST /api/admin/discovery` | `api/admin/discovery.js` | Pending creator triage (Bearer auth) |
| `GET\|POST /api/admin/submissions` | `api/admin/submissions.js` | List + approve/reject form submissions (Bearer auth). Filters by the `SUBMITTED:` notes prefix. |
| `GET\|POST /api/admin/beef` | `api/admin/beef.js` | Beef CRUD (Bearer auth) |
| `GET\|POST /api/admin/lore` | `api/admin/lore.js` | Lore arc CRUD (Bearer auth) |
| `GET\|POST /api/admin/backfill-avatars` | `api/admin/backfill-avatars.js` | One-shot Twitch avatar backfill (Bearer auth) |
| `GET\|POST /api/admin/discord-test` | `api/admin/discord-test.js` | Discord webhook config status + test embed (Bearer auth) |
| _helper_ | `_lib.js` | `jsonResponse`, `getTwitchToken`, `getKickToken`, `fetchKickChannel`, etc. |
| _helper_ | `_curated.js` | `getCuratedList(env)` / `getHandlesSet(env)` / `getCuratedEntry(env, handle)` / `invalidateCuratedCache()`. 5-min per-isolate cache; module-level `let _cache` keyed off Date.now(). Single source of truth for the curated allowlist. |

**26-creator allowlist** (source of truth: `functions/api/uk-rp-live.js`; mirrored in `contentlore-scheduler/src/discovery.js` as `ALLOWLIST_HANDLES`)
- 20 Twitch primary: tyrone, lbmm, reeclare, stoker, samham, deggyuk, megsmary, tazzthegeeza, wheelydev, rexality, steeel, justj0hnnyhd, cherish_remedy, lorddorro, jck0__, absthename, essellz, lewthescot, angels365, fantasiasfantasy
- 6 Kick primary: kavsual, shammers, bags, dynamoses, dcampion, elliewaller
- Confirmed multi-platform (entry has both `socials.twitch` AND `socials.kick` populated): **dynamoses**, **bags** (both have D1 platform rows on both sides per migration 010)

Each ALLOWLIST entry now carries a `socials: { twitch, kick, tiktok, youtube, x, instagram, discord }` object with seven fixed slots — each either a username string (no @, no full URL) or null. Discord is the exception: it stores a full invite URL since `discord.gg/{code}` codes are opaque. The shape is fixed so consumers iterate predictably without null-guarding the object itself. TikTok / YouTube / X / Instagram are all null today — populated as creators submit them via `/submit/` or via manual edits to the allowlist file.

**13 RP servers tracked** (source of truth: `SERVERS` array in `gta-rp/servers/index.html`, mirrored in `functions/api/cfx-populations.js` for live populations). Mix of UK-founded servers (Unique, TNG, Orbit, Drill UK, British Life, The Ends) and American servers UK creators play on (New Era, Prodigy, D10, Chase, plus the rest with mixed/unverified origin). Don't blanket-label as "UK servers" — it's not accurate.
- With known CFX IDs (5): Unique RP `ok4qzr`, Orbit RP `5j8edz`, Unmatched RP `r43qej`, New Era RP `z5okp5`, Prodigy RP `775kda`
- CFX ID unknown / private (8): TNG, D10, Chase, VeraRP, The Ends RP (formerly The Endz), Let's RP, Drill UK, British Life RP

**D1 tables** (verified 2026-04-29 against prod schema)
- `creators` (id, display_name, role, bio, categories, origin_story, avatar_url, accent_colour, created_at, updated_at)
- `creator_platforms` (creator_id, platform, handle, platform_id, is_primary, verified, verified_at — PK on creator_id+platform)
- `creator_edges` (raid/host/shoutout social graph)
- `snapshots` (per-poll observations of live state)
- `stream_sessions` (derived sessions from snapshots — actively growing as `pollCurated` writes 30 fresh rows per tick)
- `scene_snapshots` (server-clustered scene captures — actively populating; ~4 server rows per tick during peak hours)
- `pending_creators` (discovery triage; refills on each cron tick when fresh UK GTA RP candidates appear, including raid/host targets surfaced by `interactions.js`)
- `beefs`, `lore_arcs` (editorial)
- `watch_streaks` (Phase 3 — anon UUID, current/max streak, total_visits, optional display_name)
- `gta6_pulse_votes` (Phase 4 — anon UUID, choice ∈ {ready, optimistic, worried, not-thinking}, voted_at)
- `push_subscriptions` (Phase 5 PWA — endpoint UNIQUE, p256dh, auth, user_uuid, filter_handles. Migration `011_push_subscriptions.sql`. Driven by the scheduler's `pollCurated` go-live transition path via `src/web-push.js`)
- `curated_creators` (Phase 8 — handle PK, display_name, primary_platform, socials JSON, added_at, active. Index on active. Migration `013_curated_creators.sql`. **The single source of truth for the curated allowlist (30 streamers)** — replaces all hardcoded copies across the Functions + scheduler. Read via `functions/_curated.js` on Pages, `contentlore-scheduler/src/curated-list.js` on the scheduler. CRUD via `/api/admin/curated` (Bearer-authed) and the mod panel "Curated" tab.)
- `parties` (Phase 6 — id PK, host_token, current_handle, current_platform, host_name, created_at, updated_at, expires_at. Index on expires_at. Migration `012_watch_party.sql`. Used by `/gta-rp/party/`.)
- `party_messages` (Phase 6 — id auto, party_id, username, message, created_at. Indexes on party_id+created_at and on created_at. Self-trims via opportunistic delete on every write.)
- `daily_recaps` (date PK, content, source, model, data_snapshot JSON, generated_at — migration `015_daily_recaps.sql`. Stores one Claude-generated narrative per UTC day. Used by `/gta-rp/digest/` Yesterday section + Discord daily summary. Generated by the scheduler at 00:00 UTC and again at 06:00 UTC as a backup.)
- `clip_of_day` (date PK, clip_id, clip_data JSON, caption, picked_by, model, candidates, generated_at — migration `016_clip_of_day.sql`. Stores one Claude-picked clip per UTC day. Generated by the scheduler at 06:00 UTC. Surfaced as a hero card on `/gta-rp/clips/` and the homepage.)
- `clip_submissions` (id auto, url, platform, clip_id, creator_handle, description, submitted_by_ip, user_agent, status, decided_at, decided_note, submitted_at — migration `017_clip_submissions.sql`. Public clip submissions. Approved rows surface in `/api/clips` with `community_pick:true` so the wall renders a yellow Community Pick badge.)
- `clip_reactions` (clip_id TEXT, emoji TEXT, count INTEGER, updated_at — PK on (clip_id, emoji). Migration `019_clip_reactions.sql`. Per-device de-dupe is enforced in localStorage (`cl:react:v1`); the server only enforces the emoji allowlist + per-IP rate limit. Read via `/api/clip-reactions?ids=...`, written via `POST /api/clip-react`.)

Legacy tables dropped by migration `018_drop_legacy_tables.sql` on 2026-04-29: `category_editorial_notes`, `claims`, `lore_entries`, `rising_posts`, `transition_changelog`, `transition_creators`, `transition_servers`, `transition_timeline`. Total = 19 user tables in prod after migration `019_clip_reactions.sql` (verified 2026-04-29).

**Data pipeline:** Scheduler worker (every 15 min) runs five steps in order:
1. `pollCurated` — batched Twitch + Kick fetch for **all 30 curated streamers**, writes one snapshot per streamer (~3.5s). After writes, diffs current liveness against `curated:livestate:v1` in KV; for each offline → online transition, calls `notifyGoLive` (`src/discord.js`) which posts a rich embed to `env.DISCORD_WEBHOOK_URL` and fans out web-push. After snapshots, calls `detectInteractions` (`src/interactions.js`) which scans the live stream titles for raid/host/shoutout patterns and writes targets to `pending_creators` (with `source='raid'|'host'`, `raid_sources` JSON array of who pointed at them) — these surface in the `/mod/` Discovery "Recommended" tab ranked by distinct-source count.
2. `rebuildSessions` — stitches new snapshots into `stream_sessions`.
3. `captureSceneSnapshots` — groups currently-live curated streams by detected RP server, writes one row per active server.
4. `discoverCreators` — scans top 300 GTA V Twitch streams for new UK RP candidates, writes to `pending_creators` with `source='discovery'`.
5. `runDiscordCards` (`src/discord-cards.js`) — gates itself on the cron event's UTC hour/minute. Four time-windowed jobs:
   - **Quick Links** at minute 0 of UTC hours 0/6/12/18 (every 6h)
   - **Daily Scene Summary** at minute 0 of UTC hour 0 — first generates yesterday's `daily_recaps` row by calling `POST /api/daily-recap`, then posts the recap content to Discord
   - **Daily recap backup** at minute 0 of UTC hour 6 — re-attempts generation in case midnight failed (idempotent)
   - **Clip of the Day** at minute 0 of UTC hour 6 — calls `POST /api/clip-of-day` to pick + caption yesterday's best clip via Claude
   All use KV idempotency keys so a clock-skew double-tick can't double-post.

`/api/uk-rp-live` bypasses D1 entirely and queries Twitch + Kick official APIs directly for the curated streamers (30s KV cache).

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
- [~] **Per-page generated OG images** — `/api/shoutout-card/{handle}` (`830c8c8`) ships a 1200×630 server-rendered HTML card per creator with avatar / monthly stats / rank, used as the og:image on creator profiles and the dedicated download/screenshot surface. **Caveat: the og:image is HTML, not a real PNG, so it doesn't render as a preview image on Twitter/Discord** — only on services that respect HTML og:image targets. Wiring Cloudflare Browser Rendering to flatten the HTML to a PNG is the next step. The page itself works as a download surface today (html2canvas-based "Download as image" button).
- [ ] **Per-page OG images for non-creator surfaces** — clips, weekly digest, scene health snapshot. Same approach as shoutout cards once the PNG renderer is in place.
- [ ] **Character Wiki** — community-contributed character database. Who plays who on which server. Search by character name. Huge for RP — viewers know character names not streamer names.
- [ ] **Sound Alerts** — GTA-themed sound when someone goes live (optional, toggleable). Vice City radio jingle vibes.
- [ ] **Submission → ALLOWLIST automation** — today's submission flow ends at "approved in D1". To actually start tracking an approved creator the allowlist file needs editing + the 14 mirrors updated + a deploy. A future automation could read approved submissions from D1 at runtime instead of compile-time, removing the deploy step entirely.

### PHASE 6 — ENGAGEMENT (DONE)
- [x] **Live Hype Meter** (`59d4c05`) — `/api/hype` + `/gta-rp/` hero gauge. Compares current live-state vs 7d hour-of-day average, four bands (quiet / normal / heating / fire).
- [x] **Daily Spotlight rotation** (`460f0fa`) — `/api/spotlight` + cards on `/` and `/gta-rp/`. Underdog-boosting algorithm + alphabetical fallback. 24h cache rolls at UTC midnight.
- [x] **Clip Highlights Reel** (`106529f`) — Top-5 weekly carousel + "Watch the Week" autoplay sequence on `/gta-rp/clips/`.
- [x] **AI Scene Recap** (`0b60fc5`) — `/api/scene-recap` (Claude Sonnet 4.6, 6h Cache API) renders on `/gta-rp/digest/`. Falls back to template prose if the API call fails.
- [x] **Scene Health Dashboard** (`beb2c1d`) — `/gta-rp/health/` + `/api/scene-health`. Trend banner, week-over-week stats, server distribution, peak hour.
- [x] **Monthly Report Cards** (`7caded9`) — Per-creator monthly stats + rank + sparkline on `/creator-profile/{handle}`. Share-link button.
- [x] **Creator Shoutout Cards** (`830c8c8`) — `/api/shoutout-card/{handle}` 1200×630 HTML card for social sharing. Used as og:image on profiles. html2canvas download.

### PHASE 7 — REAL-TIME (in progress)
- [x] **Watch Party Mode** (`e5b2384`) — `/gta-rp/party/` synced viewing + shared chat. 4 endpoints + migration 012. Host_token-gated stream switching, 24h auto-expiry, opportunistic 24h-old message cleanup.
- [x] **Discord scheduled cards** (scheduler version `32ffcae8`) — Step 5 of the cron pipeline. Quick Links every 6h at minute 0 of UTC hours 0/6/12/18; Daily Scene Summary at 00:00 UTC sourcing the AI recap. KV idempotency keys prevent double-posts.
- [ ] **WebSocket-based party chat** — replace 3s polling with Cloudflare Durable Objects for sub-second message delivery. Polling works fine at current scale but won't if a party crosses ~50 active users.
- [ ] **Live reactions / emoji spam during a stream** — let party viewers float emojis over the embed.

### PHASE 8 — INFRASTRUCTURE (DONE)
- [x] **Curated allowlist → D1** — replaced all hardcoded copies of the curated list with a single `curated_creators` table. New `_curated.js` helper (Pages) + `curated-list.js` helper (scheduler), both with the same API (`getCuratedList`, `getHandlesSet`, `getCuratedEntry`). Pages helper has 5-min per-isolate cache; scheduler has none (one SELECT per cron tick). New `/api/admin/curated` Bearer-authed CRUD endpoint and a "Curated" tab in `/mod/` for add/edit/deactivate. Adding a new creator is now one mod-panel click that propagates to every endpoint within 5 minutes (cache TTL) — no code edit, no deploy. Migration `013_curated_creators.sql`.

### PHASE 9 — DAILY AI + COMMUNITY (DONE 2026-04-29)
- [x] **Daily AI scene recap** — `/api/daily-recap` endpoint + `daily_recaps` D1 table (migration 015). Scheduler hits POST at 00:00 UTC (and 06:00 backup) to generate yesterday's narrative. `/gta-rp/digest/` shows a "Yesterday in UK GTA RP" section above the existing weekly recap. The Discord daily summary uses the same content.
- [x] **Clip of the Day** — `/api/clip-of-day` endpoint + `clip_of_day` D1 table (migration 016). Scheduler at 06:00 UTC sends yesterday's top-10 clips by view count to Claude and stores `{index, caption}`. Hero card on `/gta-rp/clips/` and the homepage feed.
- [x] **Power Rankings** — `/api/rankings` endpoint + `/gta-rp/rankings/` page. Composite 0-100 score (avg viewers 40% + hours 30% + sessions 20% + growth 10%), week-over-week movement arrows, sparklines, "Share these rankings" button. Linked from primary nav.
- [x] **Server Reviews** — `/api/server-reviews` endpoint + Weekly Server Report Cards section on `/gta-rp/servers/`. A/B/C/D/F grades by activity, AI one-liner per server (one batched Claude call), top streamer per server.
- [x] **TikTok-style vertical clip Feed Mode** — Feed Mode button on `/gta-rp/clips/` opens a fullscreen vertical overlay; one clip per viewport with scroll-snap, swipe + arrow-key nav, lazy iframe mounting on the active slide.
- [x] **Community clip submissions** — `/api/submit-clip` (KV-rate-limited 5/IP/UTC day) + `clip_submissions` table (migration 017) + `/api/admin/clip-submissions` decide endpoint + `/mod/` Submissions tab now includes a Clip Submissions section. Approved clips fold into `/api/clips` with `community_pick:true` and render with a yellow "Community Pick" badge.
- [x] **Creator dashboard ("This Week")** — Prominent dashboard section on every `/creator-profile/{handle}` showing weekly hours/avg/peak/sessions + weekly rank tile, best clip with embed (loaded client-side), server-split bar chart, 7×24 schedule heatmap (UK time, computed from 90-day session window).
- [x] **Embeddable widget** — `/api/widget/{handle}` returns a self-contained 300×100 HTML card iframe-embeddable on linktrees / sites. Modal on creator profiles to grab the iframe snippet.
- [x] **Raid-based auto-discovery** (already in `interactions.js`; this round polished `/mod/` Recommended badges to read "★ Raided by tyrone" / "★★ Hosted by stoker +2").
- [x] **Drop 8 legacy D1 tables** — migration 018. 23 user tables → 18.
- [x] **rickysonone primary platform** flipped from Twitch → Kick (curated_creators + creator_platforms).

### PHASE 10 — DEPTH PASS (DONE 2026-04-29)
- [x] **Remove Digest page** — `/gta-rp/digest/` deleted. AI recap (daily + weekly) cards moved onto the homepage as a "Scene Report" section. `/api/daily-recap`, `/api/scene-recap`, `daily_recaps` table, `clip_of_day` table all retained — only the user-facing destination changed. Digest references stripped from nav/footer/manifest across 16 pages.
- [x] **Onboarding section** — homepage "New to UK GTA RP?" rebuilt as a 3-column explainer (What it is / Where it happens / Where to start) plus a 6-term glossary (IC/OOC, Character, Server, Whitelist, Raid/Host, Story arc).
- [x] **Clip reactions** — `clip_reactions` D1 table (migration 019), `/api/clip-react` (POST, rate-limited 30/IP/UTC day in KV `react:rl:*`), `/api/clip-reactions?ids=...` (GET, batch lookup, 60s edge cache). Four-emoji bar (🔥 😂 😱 ❤️) under every clip card on the wall and inside Feed Mode. localStorage `cl:react:v1` enforces one-per-device with optimistic UI on tap.
- [x] **Creator-to-creator connections** — "Often plays with" section on `/creator-profile/{handle}`. Self-join over `stream_sessions` summing time-overlap minutes per peer pair across the last 90 days. Top 6 peers by overlap shown as cards (avatar + display name + overlap-hours + session count) linking to each peer's profile.
- [x] **Monthly Wrapped** — new `/wrapped/{handle}` Function (`wrapped/[handle].js`, _routes.json updated). Spotify-Wrapped-style colour-gradient cards: hours, home server, peak viewers, average, days, peak hour-of-day, scene rank, top peer, best clip. 10-min edge cache. Linked from the Monthly Report Card on the creator profile.
- [x] **Content Calendar / schedule prediction** — schedule-pattern strip above the existing 7×24 heatmap on creator profiles. Lights up the "Likely streaming next 3h" pill when the upcoming 3-hour window is in the top quartile of the streamer's historical activity. Today's row in the heatmap is highlighted with a cyan band + bold "today" tag. Adds top-3-most-active days, typical start hour, and next-likely-slot label cells.
- [x] **Server Comparison Tool** — new page `/gta-rp/compare/`. Two `<select>` dropdowns; reuses `/api/server-reviews` so the data matches the Servers page report cards exactly. Side-by-side cards highlight the winner on each metric (hours / streamers / viewer-hours / WoW growth). URL state via `?a=&b=`. Linked from homepage Explore grid + Servers nav + More dropdown.
- [x] **Cross-Server Drama Tracker** — new `/api/server-switches` endpoint. For each curated creator, finds this-week's most-played server vs last-week's; emits a switch when the leader differs AND both weeks have ≥60 minutes. New "Recent server switches" feed on `/gta-rp/health/` renders one card per move (FROM → TO with hours per side).
- [x] **Peak Time Predictor** — new `/api/peak-prediction` endpoint. Pulls 30 days of `snapshots`, collapses concurrent polls onto a 10-minute time grid so per-creator counts roll up into "scene total at moment T", buckets by UK day-of-week × hour-of-day, picks today's dow's highest-mean hour and reports the top-quartile-mean count as the predicted peak. Confidence flag (high/moderate/thin/building). Surfaced on the homepage above the Live Right Now feed.
- [x] **Sound Alerts** — new `/sound-alerts.js` (defer-loaded). Drop a `<button data-cl-sound>` and the script auto-styles a 🔔/🔕 toggle. State + last-seen-live-set persist in localStorage (`cl:sound:on`, `cl:sound:lastset:v1`). Polls `/api/uk-rp-live` every 60s and plays a synthesised two-note Web Audio chime (A5→D6, ~300ms total) on each new go-live transition while toggled on. First poll on a fresh device records the live set without alerting. Mounted on `/gta-rp/` and the homepage.
- [x] **Discord Bot Commands — richer daily embed** — `D:/contentlore-scheduler/src/discord-cards.js` (version `bfe917b6`). Daily Scene Summary embed at 00:00 UTC now includes: AI recap (truncated to 1400 chars), stat chips (hours/streamers/sessions/peak moment/top server), 🏆 Power Rankings top 3 with movement arrows, ⭐ Clip of the Day with caption + link, 🎯 Top 3 servers this week with letter-grade emoji. All five sub-fetches run in parallel, each section is best-effort. Quick Links also updated — dropped Digest, added Rankings.

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
- `react:rl:{ip}:{yyyy-mm-dd}` — clip-reactions rate limit, 25h TTL. Counter increments on each `/api/clip-react` POST; rejects with 429 once it hits 30 in a UTC day. Best-effort — if KV is unavailable the request still succeeds.
- `party:rl:{ip}:{yyyy-mm-dd}` — Watch Party creation rate limit, 25h TTL. Capped at 10 parties / IP / UTC day.
- `party:msg:rl:{id}:{ip}` — Watch Party chat rate limit, 60s TTL. Capped at 15 messages / IP / minute per party.
- `discord:last-quicklinks:{ymd}-h{0|6|12|18}` — scheduler-side idempotency key for the 6-hourly Quick Links Discord embed, 7h TTL.
- `discord:last-summary:{ymd}` — scheduler-side idempotency key for the daily 00:00 UTC Scene Summary Discord embed, 25h TTL.

**Cache API keys** (Cloudflare's edge HTTP cache, _not_ KV — that's where response caches now live since commit `7bf7940`. Cleared automatically after their TTL; manual busting requires a Cloudflare cache purge):
- `https://contentlore.com/cache/uk-rp-live` — `/api/uk-rp-live` payload (30s)
- `https://contentlore.com/cache/cfx-populations` — `/api/cfx-populations` (60s)
- `https://contentlore.com/cache/clips/{24h|7d|30d}` — Clip Wall response (5 min)
- `https://contentlore.com/cache/timeline/{today|yesterday|7d}` — Timeline response (5 min)
- `https://contentlore.com/cache/analytics/v1` — `/api/analytics` payload (5 min)
- `https://contentlore.com/cache/network/v1` — `/api/network` payload (5 min)
- `https://contentlore.com/cache/digest/v1` — `/api/digest` payload (10 min)
- `https://contentlore.com/cache/curated-list/v1` — `/api/curated-list` payload (5 min). Note: in-Functions consumers go through `_curated.js` (per-isolate memo), so this Cache API entry is only hit by the public endpoint.
- `https://contentlore.com/cache/scene-recap/{yyyymmdd}-{0|1|2|3}` — `/api/scene-recap` AI narrative, 6h Cache API keyed on a 6h UTC bucket
- `https://contentlore.com/cache/scene-health/v1` — `/api/scene-health` (5 min)
- `https://contentlore.com/cache/server-switches/v1` — `/api/server-switches` (5 min)
- `https://contentlore.com/cache/peak-prediction/v1` — `/api/peak-prediction` (1h)
- `https://contentlore.com/cache/clip-reactions/{sha1}` — `/api/clip-reactions` per-id-set hash (60s)
- `https://contentlore.com/cache/spotlight/{yyyy-mm-dd}` — `/api/spotlight` daily pick, 24h Cache API keyed on UTC date
- `https://contentlore.com/cache/hype/v1` — `/api/hype` scene-energy gauge (60s)
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
Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`). Re-running is safe. Migration numbering has historical gaps and a duplicate (002, 004, two 005, 006, 008, 009, 010, 011, 012, 013, …, 019 — no 003 or 007). Pick the next free number for new ones (next: 020).

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

# Phase 8 — curated allowlist source-of-truth:
curl https://contentlore.com/api/curated-list  | jq '.count, (.creators | map(.handle) | length)'

# Phase 6/7 endpoints:
curl https://contentlore.com/api/hype          | jq '.ratio_pct, .band.label'
curl https://contentlore.com/api/spotlight     | jq '.pick.handle, .reason'
curl https://contentlore.com/api/scene-health  | jq '.trend.label, .delta.viewer_hours_pct'
curl https://contentlore.com/api/scene-recap   | jq '.source, (.recap | length)'

# Watch Party — should create + read + post + delete a party round-trip:
curl -X POST -H 'Content-Type: application/json' https://contentlore.com/api/party/create \
  -d '{"handle":"tyrone","host_name":"smoke"}' | jq

# Discord scheduled cards (force-fire both, scheduler-side):
curl -X POST -H "X-Admin-Password: $SCHEDULER_ADMIN_PASSWORD" \
  'https://contentlore-scheduler.dynamomc2019.workers.dev/post-cards?force=1' | jq
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
- **The curated allowlist lives in D1 — single source of truth.** Table `curated_creators` (migration `013_curated_creators.sql`). Pages Functions read via `functions/_curated.js` (`getCuratedList(env)`, `getHandlesSet(env)`, `getCuratedEntry(env, handle)`) which has a 5-min per-isolate cache. Scheduler reads via `D:/contentlore-scheduler/src/curated-list.js` with the same API but no cache (one SELECT per cron tick is cheap enough). Adding/removing/editing a creator is now a single mod-panel action at `/mod/` → "Curated" tab — no code edit, no deploy. Both helpers carry a hardcoded FALLBACK array for the brief gap between schema deploy and seed migration; in production it should never execute. The 14-place mirror gotcha that lived here historically is GONE.
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

### 2026-04-30 — Phase 6 + Phase 7 (engagement features + Watch Party + Discord cards) + audit

Big day. Nine new pieces of engagement surface area plus a full audit. Each shipped as a separate commit.

**Live Hype Meter** (`59d4c05`) — `/api/hype` compares the current curated-26 live count + viewer total against the rolling 7-day average for the same UTC hour, blends the two ratios 50/50, returns one of four bands (quiet / normal / heating / fire) with emoji + colour. New gauge in the `/gta-rp/` hero refreshes with the 90s live poll. 60s Cache API.

**Daily Spotlight** (`460f0fa`) — `/api/spotlight` picks one creator per UTC day. Algorithm rewards consistency (≥ median session count over the last 7 days) then surfaces the underdog (lowest avg viewers in that pool), indexed by day-of-year so the pick shifts daily even if the pool is identical. Falls back to alphabetical rotation through the 26 if no session data. 24h Cache API keyed on UTC date — naturally rolls over at midnight. Big spotlight card on `/`, compact banner on `/gta-rp/` above the live section.

**Clip Highlights Reel** (`106529f`) — Top-5 view-counted clips of the last 7 days as a horizontal carousel above the masonry grid on `/gta-rp/clips/`. Independent of the page's date filter (always 7d). "Watch the Week" button starts an autoplay sequence inside the existing modal, advancing on the clip's known duration + 5s grace (Twitch embeds don't reliably emit `ended`). HUD strip below the iframe shows position, progress bar, Next/Stop. Closing the modal halts the queue.

**AI Scene Recap** (`0b60fc5`) — `/api/scene-recap` fetches `/api/digest` + `/api/analytics`, hands the structured data to Claude (`claude-sonnet-4-6`, 500 max_tokens, ephemeral cache_control on the system prompt), prompts it for a sports-reporter-style 200-word UK-English narrative. 6h Cache API keyed on a 6-hour UTC bucket. Falls back to a deterministic prose template if `ANTHROPIC_API_KEY` is missing or the call fails. Renders on `/gta-rp/digest/` as an "AI Scene Report" card above Top Performers, with model name, generation time, raw data chips for verification, and a yellow callout when the fallback ran. **Verified live**: `source: anthropic` confirmed in production response.

**Scene Health Dashboard** (`beb2c1d`) — New `/gta-rp/health/` page + `/api/scene-health`. State-of-the-nation framing: trend banner at top (Growing / Stable / Cooling / Building) sized off this-week vs last-week viewer-hours change. Stat grid for viewer-hours, active creators, sessions, peak hour-of-day. Server distribution as horizontal bars. Week-over-week comparison table. New creators discovered. Trend computed server-side: ≥10% up = growing, ≤-10% = cooling, otherwise stable. Health link added to nav across all hub pages.

**Creator Report Cards** (`7caded9`) — Monthly Report Card section added to `/creator-profile/{handle}` above Stats. Shows current-month hours / sessions / avg viewers / peak viewers / most-played server / rank among the 26 (computed via one extra D1 GROUP BY query). Daily sparkline highlights today's bar. Rank gets a medal emoji for top 3 (🥇🥈🥉), star for top 10, growth arrow otherwise. "Share this report" button copies the canonical URL with `#report-card` hash. Empty state when the creator hasn't streamed this month.

**Creator Shoutout Cards** (`830c8c8`) — `/api/shoutout-card/{handle}` returns a server-rendered HTML page sized exactly 1200×630 (canonical Twitter / Discord / Facebook social ratio). Per creator: avatar, name, platform pill, monthly rank badge with medal emoji, four stats (hours / peak / avg / sessions), most-played server. Pulls one D1 query for all 26's MTD totals to derive rank in O(1). Page chrome above/below the card has a "Download as image" button (html2canvas via CDN) and "Copy share link". Card scales to viewport on smaller screens via CSS transform. Profile pages now set og:image + twitter:image to the shoutout card URL and link to it from the Monthly Report Card section. (Caveat: og:image is HTML, not PNG — Twitter/Discord won't render it as a preview image until we wire Cloudflare Browser Rendering. The page still works as a screenshot/download surface today.)

**Watch Party Mode** (`e5b2384`) — New `/gta-rp/party/` plus four endpoints (`POST /api/party/create`, `GET /api/party/{id}`, `POST /api/party/{id}/message`, `PUT /api/party/{id}/stream`) and migration `012_watch_party.sql`. Synced viewing experience: host picks a creator from the curated 26, gets a 6-char party id (alphabet excludes ambiguous I/O/0/1) + a 32-char host_token in localStorage, shares the URL. Joiners see the same iframe embed plus a poll-every-3s chat with `?since=<unix>` delta polling. Host can switch streams on the fly via host_token-gated PUT — switch posts a `★ host` system message in chat so non-hosts see it happened. Parties self-expire after 24h; expiry timestamp stored on the row + index makes cleanup queries cheap. Rate limits: 10 parties / IP / day (KV); 15 messages / IP / minute per party (KV). Opportunistic 24h-old message cleanup on every write. Party nav link added to all 14 hub pages, submit, and creator profiles.

**Discord scheduled cards** (scheduler-only deploy — version `32ffcae8`) — New `D:/contentlore-scheduler/src/discord-cards.js` exporting `runDiscordCards(env, event)`. Wired in as step 5 of the cron pipeline after `pollCurated` / `rebuildSessions` / `captureSceneSnapshots` / `discoverCreators`. Two scheduled embeds:
  - **Quick Links** (every 6h at minute 0 of UTC hours 0/6/12/18) — `🎮 ContentLore — Quick Links` embed listing Live, Multi-View, Watch Party, Clips, Analytics, Digest, Scene Health, each with an emoji and a hyperlink. Cyan brand colour (signal cyan).
  - **Daily Scene Summary** (once per UTC day at 00:00) — `📰 Today in UK GTA RP` embed. Description = the AI recap from `/api/scene-recap` (truncated to 1900 chars). Fields surface hours streamed, creators live, peak moment, top server. Twitch-purple colour. Links to `/gta-rp/digest/`. Falls through if `/api/scene-recap` returns no recap (instead of posting half-empty content).
  
  Both gates run on every cron tick; each idempotency-protects via KV (`discord:last-quicklinks:{ymd}-h{h}` 7h TTL; `discord:last-summary:{ymd}` 25h TTL) so a clock-skew double-tick can't double-post. New scheduler endpoint `POST /post-cards?force=1` (admin-auth) drops the keys and synthesises a 00:00 event for testing.

**Site audit (2026-04-30)** — Probed every hub page (16) + admin (3) + sample creator profiles → all 200 OK (admin pages 308 → 200 because Cloudflare Pages strips `.html` from URLs, normal). Probed every API endpoint (22) → all 200, all return `{ok:true}`. Found and fixed two stale references:
  - `/gta-rp/clips/` hero said "all 22 tracked creators" — bumped to "20 Twitch creators in the curated 26" since the clip wall is Twitch-only (Kick has no clips API).
  - Stale TODO comment in `gta-rp/servers/index.html` about a "Peak today" column "once scene_snapshots is producing rows" — `scene_snapshots` has been producing rows since Phase 4 (160 rows in prod). Removed.
  
  Pre-existing data quality issue noted but not fixed: Tyrone's `creators.avatar_url` row in D1 holds a `files.kick.com/...` URL (legacy from when his platform was wrongly tagged as kick before the 2026-04-27 reconciliation). `/api/uk-rp-live` overrides this with the correct Twitch CDN avatar so the canonical surface looks right; only D1-backed `/api/live-now` shows the wrong avatar. Fix is one targeted UPDATE; deferring until the next maintenance pass.
  
  Nav consistency: every hub page (15) plus submit have both Party and Health links. Verified by grep.
  
  D1 prod state at audit time: 31,901 snapshots / 1,033 stream_sessions / 160 scene_snapshots / 7,790 creators (26 active + ~7,764 legacy/discovery rows) / 197 pending_creators (discovery + form submissions) / 0 parties (just shipped) / 0 push_subscriptions (no subscribers yet) / 2 watch_streaks / 1 gta6_pulse vote. DB size 7.23 MB. 23 user tables (8 are legacy: `category_editorial_notes`, `claims`, `lore_entries`, `rising_posts`, `transition_changelog`, `transition_creators`, `transition_servers`, `transition_timeline` — none are touched by current Functions or scheduler).
  
  KV write budget: ~419 writes/day baseline (cron diagnostic blobs + livestate + token refresh + 5 Discord card idempotency keys), well under the 1,000/day free tier ceiling. Per-request rate-limit keys (`submit:rl:*`, `party:rl:*`, `party:msg:rl:*`) add at most ~30/day at current traffic levels.

### 2026-04-29 (continued) — Visual overhaul, jargon strip, daily AI loop, community submissions, widget

Marathon day. Six sequential pushes earlier in the session shipped the Tier-1 visual rebuild + Tier-2 Power Rankings + daily AI infrastructure. This second wave shipped 10 more items end-to-end:

**Visual overhaul (commits `3480166`, `a688bff`, `789629e`, `2413283`, `7e7c093`, `547de0f`)** — animated background + glassmorphism + nav restructure + homepage live-feed redesign + `/gta-rp/rankings/` + daily AI recap pipeline. Then a follow-up jargon strip (`0f2326b`) across every user-facing page (no more "scheduler", "polling", "snapshots", "26-creator scene" leaking to viewers — only `/mod/` and `/admin/` keep internals). Then a background swap (`3c18264`) — dropped the gradient mesh + noise in favour of a perspective city-street grid + 18 floating CSS particles + vignette.

**Item 1 — Clip of the Day** (`427ca1d`): migration 016 → `clip_of_day` table. New `/api/clip-of-day` (GET returns latest, POST admin generates). Scheduler `maybeGenerateClipOfDay` at 06:00 UTC sends yesterday's top-10 clips to Claude and stores `{index, caption}`. Hero card on `/gta-rp/clips/` above the reel + on the homepage live feed.

**Item 2 — Server Reviews** (`11024c1`): `/api/server-reviews` computes per-server hours / streamers / viewer-hours / WoW growth / top streamers, assigns A-F grade by weighted activity score, batches one Claude call for a one-sentence summary per server. Renders as colour-coded grade cards on `/gta-rp/servers/`.

**Item 3 — TikTok-style vertical feed** (`2a1f386`): "Feed Mode" button on `/gta-rp/clips/` opens a fullscreen scroll-snap overlay. One clip per viewport, swipe / arrow-key nav, lazy iframe mounting on the active slide, click-to-play on neighbours, action rail (Open / Share).

**Item 4 — Community clip submissions** (`8990a6d`): migration 017 → `clip_submissions`. Public `POST /api/submit-clip` parses Twitch + Kick clip URLs, validates against the curated allowlist, KV-rate-limited 5/IP/UTC day. Approved clips fold into `/api/clips` with `community_pick:true` and render with a yellow "Community Pick" badge. New "Clip Submissions" section in `/mod/` Submissions tab.

**Item 5 — Creator dashboard** (`05fcbbe`): Prominent "This Week" section on every `/creator-profile/{handle}`. Stats row (5 cards including weekly rank), best clip embed (loaded client-side), server-split bars, 7×24 schedule heatmap (UK time). Server-rendered from existing session data plus a single new `queryWeekRanks` D1 query parallelised with the existing month query.

**Item 6 — Embeddable widget** (`c583dfb`): `/api/widget/{handle}` returns a self-contained 300×100 HTML card. Avatar + name + LIVE pill + viewer count + platform pills + "Powered by ContentLore". Iframe-embeddable anywhere (CSP frame-ancestors:* + X-Frame-Options:ALLOWALL). 60s edge cache. "Get widget code" modal on creator profiles with copy-paste snippet.

**Item 7 — Raid-based auto-discovery** (`a9b8104`): pipeline already existed in `scheduler/src/interactions.js`. This round polished `/mod/` Recommended badges to read "★ Raided by tyrone" / "★★ Hosted by stoker +2" with colour coding by source count.

**Item 8 — Drop 8 legacy D1 tables** (`7f296ff`): migration 018 drops `category_editorial_notes`, `claims`, `lore_entries`, `rising_posts`, and the four `transition_*` tables. 23 user tables → 18.

**Item 9 — rickysonone → Kick primary** (`b6e587f`): one-shot migration `_oneshot_2026_04_29_rickysonone_kick_primary.sql` flips `curated_creators.primary_platform` and the `creator_platforms.is_primary` flags accordingly. `chloekins95` confirmed resolving on Twitch (page metadata returns the Chloe Wylder bio) — no change needed.

**Scheduler deploys**: two redeploys today — once for the daily-recap hooks (`bb771acc`), once for the clip-of-day hook (`223538c3`).

**Remaining manual step**: scheduler still needs `ADMIN_TOKEN` secret set so the daily-recap and clip-of-day generators can call back into Pages. Run `cd D:/contentlore-scheduler && npx wrangler secret put ADMIN_TOKEN`.

### 2026-04-29 (continued) — Phase 10 depth pass

Twelve-item push that fills in connective tissue across the existing surfaces. Each item shipped as its own commit + push.

**Item 1 — Remove Digest page** (`d6c1c53`). The page duplicated KPIs already on the homepage and put the AI recap behind an extra click. Deleted `/gta-rp/digest/index.html` + directory; folded daily + weekly AI recap cards into a new "Scene Report" section on the homepage, side by side. Stripped Digest from nav across 16 hub/admin pages, the creator-profile Function, the rankings footer, the submit footer, and `pwa.js` (More dropdown + mobile drawer Intelligence group). Dropped the Digest shortcut from `manifest.json`, added Rankings + Clips. `/api/digest` retained (no longer linked but cheap to keep). `daily_recaps`, `clip_of_day`, `scene_recap` endpoints + tables unchanged.

**Item 2 — Onboarding** (`6e24697`). Homepage "New to UK GTA RP?" rebuilt as a 3-column explainer: What it is (RP definition + IC concept) / Where it happens (the 13 servers grouped UK-built / US-with-UK-scene / mixed) / Where to start (5 numbered steps). Plus a 6-term glossary footer (IC/OOC, Character, Server, Whitelist, Raid/Host, Story arc). First thing newcomers see now actually explains the scene.

**Item 3 — Clip reactions** (`9ad0fc3`). Migration 019 adds `clip_reactions(clip_id, emoji, count, updated_at)` with PK on (clip_id, emoji). Two endpoints: `POST /api/clip-react` (rate-limited 30/IP/UTC day in KV `react:rl:*`) and `GET /api/clip-reactions?ids=...` (batch, max 200, SHA-1-hashed cache key, 60s edge cache). Four allowed emoji: 🔥 😂 😱 ❤️. Reactions row rendered under every clip card on the wall and inside Feed Mode. Optimistic UI on tap, reconciles to server count on response. Switching emojis decrements the previous and bumps the new one. localStorage `cl:react:v1` enforces one-per-device. Feed-mode buttons restyled with backdrop-filter glass for the dark gradient backdrop.

**Item 4 — Creator connections** (`5ef08ca`). New `queryConnections(env, handle)` in `/creator-profile/[handle].js` does one self-join over `stream_sessions`: A's sessions × every other curated creator's sessions, summing `MAX(0, MIN(end_a, end_b) - MAX(start_a, start_b))`. INNER JOIN on `curated_creators` with `active=1` keeps non-curated discovery rows out of the peer set. Top 6 peers rendered as cards (avatar + display name + overlap-hours + session count) between Server Affinity and Recent Clips. Whole card links to the peer's profile so the creator graph is browsable in one tap.

**Item 5 — Monthly Wrapped** (`e2e8c37`). New Pages Function `functions/wrapped/[handle].js`; `_routes.json` updated to include `/wrapped/*`. Up to 9 colour-gradient cards covering hours streamed (with WoM delta), home server, peak viewers (with title + date), average viewers, days live (with longest single stream), peak hour-of-day in UK time, scene rank, top peer, best community clip. Five parallel D1 queries: sessions for this+last month, monthly leaderboard, profile lookup, best clip, top peer. Distinct gradients per card to mimic Spotify Wrapped. Empty state if no streams this month yet. Share box copies the canonical URL. Linked from Monthly Report Card on `/creator-profile/{handle}` (✨ View Wrapped button).

**Item 6 — Schedule pattern strip** (`6f6355b`). `buildWeeklyDashboard` extended to compute schedule insights from the existing 7×24 heatmap data — no new D1 query. Pattern strip above the heatmap shows: "Likely streaming next 3h" pill (lights up cyan when the upcoming 3-hour window is in the top quartile of the streamer's schedule), Most-active-days, Typical start hour-of-day, Next-likely-slot label ("Today 9pm" / "Tomorrow 8pm"). Today's row in the heatmap gets a subtle cyan band + bold "today" tag so the viewer can compare current hour against the streamer's pattern.

**Item 7 — Server Comparison Tool** (`ed9ca5a`). New static page `/gta-rp/compare/`. Two `<select>` dropdowns auto-populated from `/api/server-reviews` (defaults to top two by viewer-hours). Side-by-side cards highlight winner per metric (hours / streamers / viewer-hours / WoW growth) with cyan tint + ▲ marker. Each column shows grade badge (A-F coloured), top 3 streamers (linked), AI summary. URL state via `?a=&b=` for shareable comparisons. Linked from homepage Explore grid (⚖️ Compare card), Servers page nav, More dropdown on desktop, Explore mobile drawer group.

**Item 8 — Cross-Server Drama Tracker** (`5a1dcf1`). New endpoint `/api/server-switches`. Pulls 14 days of curated-creator sessions, buckets minutes by detected server per creator per week, finds each creator's leader server in week N and N-1. Emits a switch when the leader differs AND both weeks have ≥60 minutes on the dominant side (filters out one-off visits). Sorted by this-week minutes descending. New "Recent server switches" section on `/gta-rp/health/` renders one card per switch (avatar, name, FROM → TO arrow, hours-per-side). 5-min Cache API.

**Item 9 — Peak Time Predictor** (`eb4e9cc`). New endpoint `/api/peak-prediction`. Pulls 30 days of `snapshots` (curated allowlist, is_live=1), collapses concurrent polls onto a 10-minute time grid so per-creator counts roll up into "scene total at moment T", buckets by UK day-of-week × hour-of-day, picks today's dow's hour with the highest mean total. Predicted peak count = top-quartile mean of polls in that hour over the window — more robust than the raw mean. Confidence flag (high/moderate/thin/building) based on sample count. 1h Cache API. Surfaced on the homepage above the Live Right Now feed; verb adapts past/future ("predicted to peak around" → "peaked around"). Hides if no signal.

**Item 10 — Sound Alerts** (`ac07c57`). New `/sound-alerts.js` defer-loaded on `/gta-rp/` and the homepage. Drop a `<button data-cl-sound>` anywhere and the script auto-styles a 🔔/🔕 toggle. localStorage state (`cl:sound:on`) + last-seen-live set (`cl:sound:lastset:v1`). Polls `/api/uk-rp-live` every 60s; plays a synthesised two-note Web Audio chime (A5 880Hz → D6 1175Hz, 180-300ms with fast attack + exponential decay envelope, capped at 0.22 volume) on each new go-live transition. First click runs a tiny test chime + confirm toast (also unlocks the AudioContext most browsers suspend until a gesture). First poll on a fresh device just records the set — opening the page mid-busy-window doesn't dump a chime per creator already on.

**Item 11 — Discord daily embed enriched** (scheduler-only, version `bfe917b6`). Edited `D:/contentlore-scheduler/src/discord-cards.js` and `npx wrangler deploy`. Daily Scene Summary at 00:00 UTC now renders five sections instead of just the AI recap. Description = recap (1400 chars). Fields after that: stat chips (hours/streamers/sessions/peak moment/top server), 🏆 Power Rankings top 3 with movement arrows, ⭐ Clip of the Day (title + creator + caption + link), 🎯 Top 3 servers this week with letter-grade emoji 🟢/🟡/🟠/🔴. Five sub-fetches run in parallel; each section is best-effort, recap is the only gating requirement. Quick Links also updated — dropped Digest (page deleted in item 1), added Rankings. Footer/url on the daily summary now point to homepage instead of `/gta-rp/digest/`.

**Item 12 — CLAUDE.md sync** (this commit). Refreshed Active Pages Functions count (47 → 50), Active hub surfaces list (added compare/, removed digest/), Dynamic pages (added /wrapped/), D1 tables (added clip_reactions + dropped one digest reference), KV keys (added react:rl), Cache API keys (added server-switches, peak-prediction, clip-reactions), migration numbering note (next: 020), added a Phase 10 roadmap block, this Session Log entry. The hub-mirror in the Architecture diagram + the smoke-test commands list weren't updated this round — flagged as a TODO for the next sync.

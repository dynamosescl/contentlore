# ContentLore Product Roadmap (April 2026)

This roadmap turns the current rebuild into clear delivery milestones.

## North Star
Build the default live intelligence hub for UK streaming culture: fast discovery, high-trust creator profiles, and real-time momentum signals.

---

## Phase 1 — Foundation hardening (Now)
**Goal:** Make the current homepage + discovery surfaces reliable and coherent.

### In scope
- [x] Unified homepage count hydration (`/api/stats`) across hero, sidebar, pulse, vault, index
- [x] Scene Pulse interactive filters (platform + Top 7/14)
- [ ] Remove remaining hard-coded fallback copy drift in homepage metadata/text
- [ ] Add smoke checks for core API endpoints:
  - `/api/stats`
  - `/api/momentum`
  - `/api/live-now`
- [ ] Add lightweight client error telemetry for failed homepage API calls

### Exit criteria
- No contradictory core counts across homepage sections
- Pulse widgets degrade gracefully on API failure
- Core API health visible in admin status view

---

## Phase 2 — Discovery + Profiles quality pass (Next)
**Goal:** Make discovering and evaluating creators faster.

### In scope
- [ ] Discover UX pass:
  - stronger sort controls
  - clearer active-filter states
  - empty-state guidance
- [ ] People/profile pass:
  - consistent avatar rendering and fallback behavior
  - cleaner profile metadata hierarchy
  - better related-links section
- [ ] Add momentum context snippets on profile pages

### Exit criteria
- Discover supports "find in < 15 seconds" workflow for active viewers
- Profile page gives enough context to judge creator identity at a glance

---

## Phase 3 — Editorial desk expansion (Then)
**Goal:** Turn the desk from modules into a true daily operating surface.

### In scope
- [ ] Scene leaderboard surface with configurable windows (24h / 7d)
- [ ] Scene graph storytelling cards (not just raw edges)
- [ ] Release feed/changelog page for product + editorial updates
- [ ] Weekly issue framing components reusable across feature pages

### Exit criteria
- Desk can be used as a daily briefing tool by editor + community
- Weekly issue production requires minimal manual stitching

---

## Phase 4 — Section expansion (Later)
**Goal:** Launch missing pillars without diluting quality.

### In scope
- [ ] Places section MVP
- [ ] Community section MVP
- [ ] Platform expansion signals (YouTube/TikTok ingestion plan)
- [ ] Public methodology page updates aligned to new signals

### Exit criteria
- All nav pillars have useful first-party surfaces
- Methodology and ethics docs match the live product behavior

---

## Working cadence
- **Daily:** small deployable pushes on feature branches
- **Weekly:** one "issue-quality" homepage/state-of-product pass
- **Monthly:** roadmap checkpoint and reprioritization

## Immediate next 3 pushes
1. Add core API smoke-check endpoint + simple homepage failure banner fallback.
2. Tighten Discover filter UX (active-state + clear-all + URL state sync).
3. Add profile momentum mini-module fed by creator stats endpoint.

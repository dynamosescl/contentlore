# ContentLore — Restoration Deploy

This deploys the full dynamic platform back to Cloudflare Pages at the apex domain (`contentlore.com`). The editorial content you shipped on 18/19 April is preserved; the dynamic pieces (admin, creator profiles, claim, momentum, OG cards, enrichment) are restored from the 17 April foundation.

**Timing:** ~30 minutes of clicks over maybe an hour with DNS wait.
**Rollback:** If anything breaks, swap the DNS CNAMEs back to `dynamosescl.github.io` and GitHub Pages takes over again within minutes.

---

## Phase 1 — Get the code into your GitHub repo

Your GitHub repo is already connected to the domain via GitHub Pages. Rather than create a second repo, we'll push this new code to the existing one. Cloudflare Pages will then pull from GitHub on every commit.

**Step 1a — unpack the zip into your local `D:\contentlore`.**

Unzip `contentlore-restoration.zip` somewhere (your Desktop is fine). You'll see a folder with `functions/`, `wrangler.toml`, `_routes.json`, `admin/`, `about/`, `the-platform/`, `index.html`, etc.

**Step 1b — replace your local repo contents.**

Open `D:\contentlore` in File Explorer. Delete everything EXCEPT the `.git` folder. (Leave `.git` — that's your GitHub connection.)

Then copy the entire contents of the unzipped restoration folder into `D:\contentlore`.

**Step 1c — commit and push.**

```
cd /d D:\contentlore
git add -A
git commit -m "Restoration: Cloudflare Pages with Functions (foundation rebuild)"
git push
```

---

## Phase 2 — Create the Cloudflare Pages project (~8 clicks)

In your browser:

1. Open https://dash.cloudflare.com
2. Left sidebar → **Workers & Pages**
3. Click **Create application** (top right)
4. Tab: **Pages**
5. Click **Connect to Git**
6. Authorise GitHub if prompted. Select `dynamosescl/contentlore`.
7. **Production branch**: `main`
8. **Build settings**:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: *(leave empty — the default `/` is what we want, matching `pages_build_output_dir = "."` in wrangler.toml)*
9. Click **Save and Deploy**

Cloudflare will build and give you a URL like `contentlore-xxxx.pages.dev`. It might error on first build because secrets aren't set yet — that's expected. Move to Phase 3.

---

## Phase 3 — Set bindings and secrets (~8 clicks)

In the new Pages project:

1. Settings → **Variables and Secrets** (or "Environment variables" in older UI)
2. Make sure you're on the **Production** environment.

### Add secrets (type: **Secret**, NOT plaintext)

Click **Add variable** for each of these. Reuse your existing values.

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | `contentlore2026` |
| `ANTHROPIC_API_KEY` | Your existing `sk-ant-api03-...` (contentlore-prod-v3) |
| `TWITCH_CLIENT_ID` | `7capyzccshldovjmzuun55wet7p5co` |
| `TWITCH_CLIENT_SECRET` | Your existing Twitch secret |
| `KICK_CLIENT_ID` | `01KPDCMN6VX2KFV2091B10Y5B0` |
| `KICK_CLIENT_SECRET` | Your existing Kick secret |

**Important: use the dashboard, not Notepad.** Click into the value field, paste directly. Do NOT go via Notepad — we saw that corrupt keys with invisible characters on 17 April.

### Add D1 binding

1. Settings → **Bindings** (or "Functions" → "D1 database bindings" in some UI versions)
2. Click **Add binding** → **D1 database**
3. Variable name: `DB`
4. D1 database: `contentlore-db`
5. Save

### Add KV binding

1. Same page → **Add binding** → **KV Namespace**
2. Variable name: `KV`
3. KV namespace: pick the existing one (ID `f6c05b65a4e84c5baba997122ebcc8c6`)
4. Save

### Redeploy to pick up bindings

Deployments tab → latest deployment → **⋮** menu → **Retry deployment**. Or just push a trivial commit (README edit).

---

## Phase 4 — Test the preview URL (~5 min) — DO NOT SKIP

Before we touch DNS, verify the new site works at the Cloudflare preview URL. This is your safety net — if anything is wrong here, the live site at `contentlore.com` stays on GitHub Pages, no visitor sees anything.

Open: `https://contentlore-xxxx.pages.dev` (the URL Cloudflare gave you)

Verify each of these:

- **Homepage loads** — dark theme, ticker, editorial
- **Editorial pages** — visit `/about/`, `/ethics/`, `/the-platform/`, `/gta-rp/`
- **Creator profile** — visit `/creator/bobu` (or any approved creator ID). Should show name, bio, platforms, sparkline placeholder
- **Momentum API** — visit `/api/momentum?limit=5` and you should get JSON back
- **Admin page** — visit `/admin`, password prompt appears, enter `contentlore2026`, panel loads
- **Pending list** — admin panel should show ~182 pending
- **OG card** — visit `/api/og/home` and you should see the branded SVG

**If any of these fail, STOP HERE and send me the error.** Do not touch DNS until the preview URL works for everything.

---

## Phase 5 — DNS swap (5 min + 5-30 min propagation)

This is the moment the live domain switches from GitHub Pages to Cloudflare Pages. Reversible in 2 clicks if needed.

1. Cloudflare dashboard → click `contentlore.com` in the domain list
2. Left sidebar → **DNS** → **Records**
3. Find the two CNAME records currently pointing to `dynamosescl.github.io`:
   - `contentlore.com` (apex) → `dynamosescl.github.io`
   - `www` → `dynamosescl.github.io`
4. For the DNS swap, we actually don't edit these directly — Cloudflare Pages creates the right records for you when you attach the custom domain:

### Attach custom domain in Cloudflare Pages

1. Back in your Pages project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter `contentlore.com` → **Continue**
4. Cloudflare will offer to update the existing DNS record to point at the Pages project. Click **Activate domain**.
5. It'll issue an SSL cert automatically (~1 min).
6. Repeat for `www.contentlore.com`.

Visit `https://contentlore.com` — the new site should load within 1-5 minutes. Cloudflare DNS propagates fast because you're editing within the same DNS zone.

---

## Phase 6 — Verify and retire GitHub Pages (~5 min)

### Verify the live domain

Same checklist as Phase 4 but on `https://contentlore.com`:

- Homepage, editorial pages, `/creator/bobu`, `/api/momentum`, `/admin`, `/api/og/home`

### Turn off GitHub Pages

1. Go to https://github.com/dynamosescl/contentlore/settings/pages
2. Under "Build and deployment" → **Source**: change to **None**

### Optional: enable orange cloud proxy

Back on Cloudflare DNS records, change both CNAMEs from grey cloud (DNS only) to orange cloud (Proxied). This gives you Cloudflare's CDN, DDoS protection, and analytics. Safe to do once HTTPS is confirmed working.

---

## What's now live

**Static editorial (preserved exactly):**
- `/`, `/about/`, `/contact/`, `/ethics/`, `/ledger/`
- `/gta-rp/`, `/gta-rp/servers/`
- `/the-platform/` and its six sub-pages

**Dynamic endpoints (restored):**
- `/creator/[slug]` — server-rendered creator profile with D1 data
- `/claim` — self-claim portal
- `/admin` — password-gated admin panel (all 182 pending visible)
- `/api/creators` — list all 189 creators
- `/api/creator/[slug]` — creator detail JSON
- `/api/momentum?days=7` — Rising movers (powers Scene Pulse)
- `/api/admin/pending` — admin pending list
- `/api/admin/pending/[id]/approve`, `/reject`
- `/api/admin/pending/approve-all`, `/reject-all`
- `/api/admin/creators/enrich-all` — Claude Haiku bio enrichment
- `/api/claim/start`, `/api/claim/verify`
- `/api/og/home`, `/api/og/claim`, `/api/og/creator/[slug]` — dynamic SVG share cards

**D1 and KV data (untouched, fully connected):**
- 189 creators with enriched bios
- 182 pending reviews queued and visible in `/admin`
- 24,740 snapshots ready to power sparklines and Scene Pulse
- All lore entries, rising posts, claims preserved

---

## If something breaks

**Immediate rollback** (60 seconds):
1. Cloudflare Pages → Custom domains → remove `contentlore.com`
2. Cloudflare DNS → recreate the CNAME pointing `contentlore.com` → `dynamosescl.github.io`
3. GitHub Pages starts serving again as soon as DNS propagates

**Common issues:**

- **Admin password 401**: Check `ADMIN_PASSWORD` secret is set to exactly `contentlore2026` with no trailing whitespace. Re-edit via Cloudflare dashboard, not Notepad.
- **`/api/*` returns 404**: Missing `_routes.json` or build didn't pick up the `functions/` folder. Trigger a redeploy.
- **Creator profile says "Error"**: D1 binding not set. Check Settings → Bindings → DB variable binds to `contentlore-db`.
- **OG card fails**: Not urgent, doesn't affect user flows. Likely a D1 query error — check browser console and Cloudflare Real-time Logs.
- **Enrichment fails with 401**: Anthropic key corrupted on paste. Regenerate the key in the Anthropic console and re-paste via Cloudflare dashboard.

---

## Post-deploy backlog (not blocking)

1. **Rotate leaked credentials** — Twitch/Kick secrets, admin password, Anthropic key all leaked in prior chats. Rotate when you have energy.
2. **Rebuild the four cron workers** (`contentlore-cron`, `contentlore-lore`, `contentlore-rising`, `contentlore-backups`). Their source isn't in this repo. We can reconstruct them from the transcripts in a follow-up sprint — but they might already still be running on Cloudflare and writing to D1, in which case nothing's urgent.
3. **Scene Pulse** — once foundation is verified working, we design and build the homepage flagship visualisation using `/api/momentum` and the snapshot series.
4. **The `/the-platform/tebex-audit/` page** — you killed Tebex Audit but the public methodology page is still live promising an audit in May. Two options: (a) replace the page with a "coverage paused" statement that reads as honest editorial, or (b) quietly take the page down. Either is fine from an Ethics-page consistency point of view — just don't leave the broken promise standing.

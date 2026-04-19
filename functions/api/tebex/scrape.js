// Cloudflare Pages Function: /api/tebex/scrape
// POST to trigger a scrape run. Fetches all include_in_audit=1 servers,
// parses their Tebex stores, writes products + summaries + flags to D1.
//
// Simple admin auth: expects ?key=<ADMIN_KEY> query parameter.
// ADMIN_KEY should match the existing admin panel password.

// ---- PLA keywords for automated flag detection ----
const PLA_KEYWORDS = [
  'priority queue', 'priority spawn', 'priority access',
  'whitelist access', 'pay to skip', 'exclusive vehicle',
  'exclusive weapon', 'custom loadout', 'extra health',
  'faster respawn', 'starter pack', 'starter kit',
  'exclusive job', 'premium job', 'gold status',
  'vip status', 'vip access'
];

// ---- Main handler ----
export async function onRequestPost({ request, env }) {
  // Simple auth
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || key !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Optional: limit to N servers (for test runs)
  const limit = parseInt(url.searchParams.get('limit') || '0', 10);
  const runType = url.searchParams.get('type') || 'manual';

  try {
    const result = await runScrape(env.DB, limit, runType);
    return json(result);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}

// ---- Core scrape logic ----
async function runScrape(db, limit, runType) {
  const startedAt = new Date();
  const runId = makeRunId(startedAt);

  // Load targets
  const query = `SELECT * FROM tebex_targets WHERE include_in_audit = 1 AND tebex_url != '' ORDER BY server_name`;
  const { results: targets } = await db.prepare(query).all();

  let active = targets;
  if (limit > 0) active = active.slice(0, limit);

  // Insert run record (incomplete initially, updated at end)
  await db.prepare(
    `INSERT INTO tebex_runs (run_id, started_at, run_type, servers_attempted, scraper_version)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(runId, startedAt.toISOString(), runType, active.length, '1.0.0').run();

  // Fetch FX rate once
  const fxRate = await fetchFxRate();

  // Process each target
  const stats = { attempted: 0, successful: 0, productsCollected: 0, errors: [] };

  for (const target of active) {
    stats.attempted++;
    try {
      const products = await scrapeServer(target, fxRate);
      if (products.length > 0) {
        await writeProducts(db, runId, target.server_name, products);
        const summary = buildSummary(runId, target.server_name, products);
        await writeSummary(db, summary);
        const flags = detectFlags(runId, target.server_name, products, summary);
        if (flags.length > 0) await writeFlags(db, flags);
        stats.successful++;
        stats.productsCollected += products.length;
      } else {
        await writeSummary(db, {
          run_id: runId, server_name: target.server_name,
          total_products: 0, fetch_status: 'FETCH_FAILED',
          notes: 'No products returned'
        });
        stats.errors.push(`${target.server_name}: 0 products`);
      }
    } catch (e) {
      stats.errors.push(`${target.server_name}: ${e.message}`);
      await writeSummary(db, {
        run_id: runId, server_name: target.server_name,
        total_products: 0, fetch_status: 'ERROR',
        notes: e.message.substring(0, 500)
      });
    }
    // Polite 1s between servers
    await sleep(1000);
  }

  const completedAt = new Date();
  const durationSec = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

  await db.prepare(
    `UPDATE tebex_runs SET completed_at = ?, servers_successful = ?, products_collected = ?,
       errors = ?, duration_sec = ? WHERE run_id = ?`
  ).bind(
    completedAt.toISOString(),
    stats.successful,
    stats.productsCollected,
    stats.errors.join(' | '),
    durationSec,
    runId
  ).run();

  return {
    runId,
    attempted: stats.attempted,
    successful: stats.successful,
    productsCollected: stats.productsCollected,
    durationSec,
    errors: stats.errors
  };
}

// ---- Fetch one Tebex store and parse products ----
async function scrapeServer(target, fxRate) {
  const baseUrl = cleanUrl(target.tebex_url);

  // Try JSON endpoints first
  const jsonEndpoints = [
    `${baseUrl}/api/packages`,
    `${baseUrl}/api/storefront/packages`
  ];

  for (const endpoint of jsonEndpoints) {
    try {
      const resp = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ContentLore-TebexAudit/1.0 (+https://contentlore.com/the-platform/tebex-audit/)'
        },
        cf: { cacheEverything: false }
      });
      if (resp.ok) {
        const body = await resp.text();
        if (body && (body.startsWith('[') || body.startsWith('{'))) {
          const products = parseJson(body, fxRate);
          if (products.length > 0) return products;
        }
      }
    } catch { /* try next */ }
  }

  // Fallback: HTML scrape
  try {
    const resp = await fetch(baseUrl, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'ContentLore-TebexAudit/1.0 (+https://contentlore.com/the-platform/tebex-audit/)'
      },
      redirect: 'follow'
    });
    if (resp.ok) {
      const body = await resp.text();
      return parseHtml(body, fxRate);
    }
  } catch { /* give up */ }

  return [];
}

// ---- Parse JSON product arrays ----
function parseJson(body, fxRate) {
  let data;
  try { data = JSON.parse(body); } catch { return []; }

  const packages = Array.isArray(data) ? data : (data.data || data.packages || []);
  if (!Array.isArray(packages)) return [];

  const products = [];
  for (const pkg of packages.slice(0, 100)) {
    const p = normalizePackage(pkg, fxRate);
    if (p) products.push(p);
  }
  return products;
}

function normalizePackage(pkg, fxRate) {
  if (!pkg || typeof pkg !== 'object') return null;
  const name = pkg.name || pkg.title || pkg.package_name;
  if (!name) return null;

  const { amount, currency } = extractPrice(pkg);
  const { priceGbp, priceUsd } = normalizeCurrency(amount, currency, fxRate);

  let category = '';
  if (pkg.category) {
    category = typeof pkg.category === 'object'
      ? (pkg.category.name || pkg.category.title || '')
      : String(pkg.category);
  }

  const description = stripHtml(String(pkg.description || pkg.content || '')).substring(0, 500);
  const recurring = !!(pkg.type === 'subscription' || pkg.recurring || pkg.is_recurring ||
    (pkg.price_type && String(pkg.price_type).toLowerCase() === 'subscription'));

  return {
    name: String(name).substring(0, 200),
    price_native: amount,
    currency,
    price_gbp: priceGbp,
    price_usd: priceUsd,
    category: category.substring(0, 100),
    description,
    product_url: String(pkg.url || pkg.link || '').substring(0, 400),
    recurring
  };
}

function extractPrice(pkg) {
  let amount = 0;
  let currency = 'USD';

  if (typeof pkg.price === 'number') amount = pkg.price;
  else if (typeof pkg.price === 'string') amount = parseFloat(pkg.price) || 0;
  else if (pkg.price && typeof pkg.price === 'object') {
    amount = parseFloat(pkg.price.amount || pkg.price.value || 0) || 0;
    if (pkg.price.currency) {
      currency = typeof pkg.price.currency === 'object'
        ? (pkg.price.currency.iso_4217 || pkg.price.currency.code || 'USD')
        : String(pkg.price.currency);
    }
  }

  if (amount === 0 && pkg.base_price !== undefined) amount = parseFloat(pkg.base_price) || 0;
  if (pkg.currency && typeof pkg.currency === 'string') currency = pkg.currency;

  return { amount, currency: currency.toUpperCase() };
}

function normalizeCurrency(amount, currency, fxRate) {
  let priceUsd = 0, priceGbp = 0;
  switch (currency) {
    case 'GBP':
      priceGbp = amount;
      priceUsd = fxRate > 0 ? amount / fxRate : 0;
      break;
    case 'EUR':
      priceGbp = amount * 0.85;
      priceUsd = fxRate > 0 ? priceGbp / fxRate : 0;
      break;
    default: // USD or unknown
      priceUsd = amount;
      priceGbp = amount * fxRate;
  }
  return {
    priceGbp: Math.round(priceGbp * 100) / 100,
    priceUsd: Math.round(priceUsd * 100) / 100
  };
}

// ---- HTML fallback — try embedded JSON hydration blobs ----
function parseHtml(body, fxRate) {
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
    /window\.__TEBEX_STATE__\s*=\s*(\{[\s\S]*?\});/,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && match[1]) {
      try {
        const obj = JSON.parse(match[1]);
        const packages = findPackagesDeep(obj);
        if (packages.length > 0) {
          return packages.slice(0, 100).map(p => normalizePackage(p, fxRate)).filter(Boolean);
        }
      } catch { /* try next */ }
    }
  }
  return [];
}

function findPackagesDeep(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' &&
        (obj[0].name || obj[0].title) && (obj[0].price !== undefined || obj[0].base_price !== undefined)) {
      return obj;
    }
    return [];
  }
  for (const key of ['packages', 'products', 'items', 'data']) {
    if (obj[key]) {
      const result = findPackagesDeep(obj[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  for (const key of Object.keys(obj)) {
    const result = findPackagesDeep(obj[key], depth + 1);
    if (result.length > 0) return result;
  }
  return [];
}

// ---- FX rate ----
async function fetchFxRate() {
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (resp.ok) {
      const data = await resp.json();
      if (data?.rates?.GBP) return data.rates.GBP;
    }
  } catch {}
  return 0.74; // fallback
}

// ---- Summary + flag builders (editorial review gated) ----
function buildSummary(runId, serverName, products) {
  if (products.length === 0) {
    return {
      run_id: runId, server_name: serverName,
      total_products: 0, fetch_status: 'OK', notes: 'No products returned'
    };
  }

  const gbpPrices = products.filter(p => p.price_gbp > 0).map(p => p.price_gbp).sort((a, b) => a - b);
  const subs = products.filter(p => p.recurring && p.price_gbp > 0).map(p => p.price_gbp).sort((a, b) => a - b);
  const plaMatches = products.filter(p => {
    const text = `${p.name} ${p.description}`.toLowerCase();
    return PLA_KEYWORDS.some(kw => text.includes(kw));
  }).length;

  return {
    run_id: runId, server_name: serverName,
    total_products: products.length,
    min_price_gbp: gbpPrices[0] ?? null,
    max_price_gbp: gbpPrices[gbpPrices.length - 1] ?? null,
    median_price_gbp: gbpPrices.length > 0 ? gbpPrices[Math.floor(gbpPrices.length / 2)] : null,
    has_subscription_tiers: subs.length > 0 ? 1 : 0,
    subscription_tier_count: subs.length,
    entry_tier_gbp: subs[0] ?? null,
    top_tier_gbp: subs[subs.length - 1] ?? null,
    pla_keyword_matches: plaMatches,
    marketing_honesty_flags: 0,
    fetch_status: 'OK',
    notes: ''
  };
}

function detectFlags(runId, server, products, summary) {
  const flags = [];
  let idx = 0;

  const pushFlag = (dimension, flagType, severity, description, evidenceUrl = '') => {
    const slug = server.replace(/[^A-Za-z0-9]/g, '').substring(0, 20);
    const padded = String(++idx).padStart(3, '0');
    flags.push({
      flag_id: `${runId}-${slug}-${padded}`,
      run_id: runId, server_name: server,
      dimension, flag_type: flagType, severity,
      description, evidence_url: evidenceUrl, auto_or_editorial: 'auto'
    });
  };

  // Pricing flags
  if (summary.entry_tier_gbp != null) {
    const entryUsd = summary.entry_tier_gbp / 0.74;
    if (entryUsd >= 30) {
      pushFlag('Pricing posture', 'High entry tier', 1,
        `Entry-tier subscription at £${summary.entry_tier_gbp.toFixed(2)} (approx $${entryUsd.toFixed(2)}).`);
    }
  }
  if (summary.top_tier_gbp != null) {
    const topUsd = summary.top_tier_gbp / 0.74;
    if (topUsd >= 150) {
      pushFlag('Pricing posture', 'High top tier', 2,
        `Top-tier subscription at £${summary.top_tier_gbp.toFixed(2)} (approx $${topUsd.toFixed(2)}). Editorial review required.`);
    }
  }
  if (summary.entry_tier_gbp > 0 && summary.top_tier_gbp / summary.entry_tier_gbp >= 5) {
    pushFlag('Pricing posture', 'Aggressive tier ladder', 2,
      `Top tier is ${(summary.top_tier_gbp / summary.entry_tier_gbp).toFixed(1)}x entry tier.`);
  }

  // Catalogue flags
  if (summary.total_products >= 80) {
    pushFlag('Catalogue breadth', 'Large catalogue', 1,
      `${summary.total_products} products listed. Large catalogues suggest aggressive monetisation shape.`);
  } else if (summary.total_products > 0 && summary.total_products <= 3) {
    pushFlag('Catalogue breadth', 'Very small catalogue', 1,
      `Only ${summary.total_products} products found. Verify parse succeeded.`);
  }

  // PLA keyword matches — one flag per matched product
  for (const p of products) {
    const text = `${p.name} ${p.description}`.toLowerCase();
    const matched = PLA_KEYWORDS.filter(kw => text.includes(kw));
    if (matched.length > 0) {
      const severity = matched.length >= 2 ? 3 : 2;
      pushFlag('PLA alignment', 'PLA keyword match', severity,
        `Product "${p.name}" matches PLA-sensitive keyword(s): ${matched.join(', ')}. Price: £${p.price_gbp.toFixed(2)}. ${p.recurring ? 'Subscription.' : 'One-time.'} Editorial review required before any public flag.`,
        p.product_url);
    }
  }

  // Marketing honesty — "free"/"donation" label with non-zero price
  for (const p of products) {
    const name = p.name.toLowerCase();
    if (p.price_gbp > 0 && (name.includes('free') || name.includes('donation') || name.includes('donate'))) {
      pushFlag('Marketing honesty', 'Pricing/labelling mismatch', 2,
        `"${p.name}" labelled suggesting free/donation but priced at £${p.price_gbp.toFixed(2)}.`,
        p.product_url);
    }
  }

  return flags;
}

// ---- DB writers ----
async function writeProducts(db, runId, server, products) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO tebex_products (run_id, server_name, product_name, price_native, currency,
       price_gbp, price_usd, category, description, product_url, recurring, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = products.map(p => stmt.bind(
    runId, server, p.name, p.price_native, p.currency,
    p.price_gbp, p.price_usd, p.category, p.description,
    p.product_url, p.recurring ? 1 : 0, now
  ));
  if (batch.length > 0) await db.batch(batch);
}

async function writeSummary(db, s) {
  await db.prepare(
    `INSERT OR REPLACE INTO tebex_summaries
     (run_id, server_name, total_products, min_price_gbp, max_price_gbp, median_price_gbp,
      has_subscription_tiers, subscription_tier_count, entry_tier_gbp, top_tier_gbp,
      pla_keyword_matches, marketing_honesty_flags, fetch_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    s.run_id, s.server_name, s.total_products || 0,
    s.min_price_gbp ?? null, s.max_price_gbp ?? null, s.median_price_gbp ?? null,
    s.has_subscription_tiers ?? 0, s.subscription_tier_count ?? 0,
    s.entry_tier_gbp ?? null, s.top_tier_gbp ?? null,
    s.pla_keyword_matches ?? 0, s.marketing_honesty_flags ?? 0,
    s.fetch_status || 'OK', s.notes || ''
  ).run();
}

async function writeFlags(db, flags) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO tebex_flags (flag_id, run_id, server_name, dimension, flag_type,
       severity, evidence_url, description, auto_or_editorial)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = flags.map(f => stmt.bind(
    f.flag_id, f.run_id, f.server_name, f.dimension, f.flag_type,
    f.severity, f.evidence_url || '', f.description, f.auto_or_editorial
  ));
  if (batch.length > 0) await db.batch(batch);
}

// ---- Utilities ----
function makeRunId(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function cleanUrl(url) {
  url = String(url).trim();
  while (url.endsWith('/')) url = url.slice(0, -1);
  if (!url.startsWith('http')) url = 'https://' + url;
  return url;
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

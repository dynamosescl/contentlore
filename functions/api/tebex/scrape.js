// Cloudflare Pages Function: /api/tebex/scrape
// v2.1 — targets Tebex classic template stores with robust per-product parsing
//
// Fixes from v2.0:
//  - Run ID now includes seconds (fixes UNIQUE constraint collisions)
//  - Product block parser rewritten using split-on-boundary approach
//  - Better resilience against regex backtracking on large HTML
//  - Additional category paths covered

// ---- PLA keywords for automated flag detection ----
const PLA_KEYWORDS = [
  'priority queue', 'priority spawn', 'priority access',
  'whitelist access', 'pay to skip', 'exclusive vehicle',
  'exclusive weapon', 'custom loadout', 'extra health',
  'faster respawn', 'starter pack', 'starter kit',
  'exclusive job', 'premium job', 'gold status',
  'vip status', 'vip access', 'prio'
];

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const COMMON_PATHS = [
  '/',
  '/category/prio',
  '/category/priority',
  '/category/prio-1',
  '/category/packages',
  '/category/subscriptions',
  '/category/vip',
  '/category/misc',
  '/category/cars',
  '/category/vehicles',
  '/category/donations',
  '/category/tebex',
  '/category/shop',
  '/category/store'
];

// ---- Main handler ----
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || key !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }

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

  const query = `SELECT * FROM tebex_targets WHERE include_in_audit = 1 AND tebex_url != '' ORDER BY server_name`;
  const { results: targets } = await db.prepare(query).all();

  let active = targets;
  if (limit > 0) active = active.slice(0, limit);

  await db.prepare(
    `INSERT INTO tebex_runs (run_id, started_at, run_type, servers_attempted, scraper_version)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(runId, startedAt.toISOString(), runType, active.length, '2.1.0').run();

  const fxRate = await fetchFxRate();
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
          notes: 'No products found across attempted paths'
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
    await sleep(1500);
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

// ---- Scrape one Tebex store ----
async function scrapeServer(target, fxRate) {
  const baseUrl = cleanUrl(target.tebex_url);
  const allProducts = new Map();

  const homepageHtml = await fetchPage(baseUrl);
  if (!homepageHtml) return [];

  const categoryPaths = discoverCategories(homepageHtml);
  for (const p of COMMON_PATHS) {
    if (!categoryPaths.includes(p)) categoryPaths.push(p);
  }

  // Parse products from homepage first
  for (const product of parseProducts(homepageHtml, fxRate, baseUrl, '')) {
    allProducts.set(product.product_url, product);
  }

  // Fetch each discovered category page
  const toFetch = categoryPaths.slice(0, 15);
  for (const path of toFetch) {
    if (path === '/' || path === '') continue;
    try {
      const html = await fetchPage(baseUrl + path);
      if (!html) continue;
      for (const product of parseProducts(html, fxRate, baseUrl, path)) {
        allProducts.set(product.product_url, product);
      }
    } catch { /* skip */ }
    await sleep(400);
  }

  return Array.from(allProducts.values());
}

// ---- Fetch a single page ----
async function fetchPage(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// ---- Discover category paths ----
function discoverCategories(html) {
  const paths = new Set();
  const pattern = /href="(\/category\/[^"#?]+)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    paths.add(match[1]);
  }
  return Array.from(paths);
}

// ---- Parse products from Tebex classic template HTML ----
// v2.1: rewrote to use package ID as the anchor, then find associated name + price
function parseProducts(html, fxRate, baseUrl, categoryPath) {
  const products = [];
  const seenIds = new Set();

  // Find all unique package IDs referenced in this HTML
  const idPattern = /\/package\/(\d+)/g;
  let idMatch;
  const positions = [];
  while ((idMatch = idPattern.exec(html)) !== null) {
    const id = idMatch[1];
    if (!seenIds.has(id)) {
      seenIds.add(id);
      positions.push({ id, pos: idMatch.index });
    }
  }

  // For each package ID, extract a window of HTML around its first occurrence
  // and parse the product data from that window
  for (const { id, pos } of positions) {
    // Window: 200 chars before to 800 chars after the ID position
    // This covers the surrounding <div class="package card"> ... </div> block
    const windowStart = Math.max(0, pos - 200);
    const windowEnd = Math.min(html.length, pos + 800);
    const window = html.substring(windowStart, windowEnd);

    const product = parseFromWindow(id, window, fxRate, baseUrl, categoryPath);
    if (product) products.push(product);
  }

  return products;
}

// ---- Parse a product from its window of HTML ----
function parseFromWindow(packageId, window, fxRate, baseUrl, categoryPath) {
  // Find name — inside an <h4>...<a>...NAME</a></h4> pattern
  // Allow <h4> with any attributes, any whitespace/newlines
  const nameMatch = window.match(/<h4[^>]*>[\s\S]{0,200}?<a[^>]*href="\/package\/\d+"[^>]*>([^<]+)<\/a>/);
  if (!nameMatch) return null;
  const name = decodeHtml(nameMatch[1]).trim();
  if (!name || name.length < 2) return null;

  // Find price — looking for NUMBER CCC pattern (e.g. "15.00 GBP")
  // Must be close to the name and package link
  // Use a more specific pattern: inside a span with class containing "text-primary" or "font-weight"
  const priceMatch = window.match(/<span[^>]*(?:text-primary|font-weight-bold|price)[^>]*>\s*([\d.,]+)\s+([A-Z]{3})\s*<\/span>/i);

  let amount = 0;
  let currency = 'GBP';
  if (priceMatch) {
    amount = parseFloat(priceMatch[1].replace(',', '.')) || 0;
    currency = priceMatch[2];
  } else {
    // Fallback: any number + 3-letter currency code in window
    const fallbackMatch = window.match(/>\s*([\d]+(?:\.[\d]{2})?)\s+([A-Z]{3})\s*</);
    if (fallbackMatch) {
      amount = parseFloat(fallbackMatch[1]) || 0;
      currency = fallbackMatch[2];
    }
  }

  // Detect subscription: look for /subscribe suffix near this package ID
  const subscribePattern = new RegExp(`/checkout/packages/add/${packageId}/subscribe`, 'i');
  const recurring = subscribePattern.test(window);

  const { priceGbp, priceUsd } = normalizeCurrency(amount, currency, fxRate);

  const category = categoryPath.replace(/^\/category\//, '').replace(/-/g, ' ').substring(0, 100);

  return {
    name: name.substring(0, 200),
    price_native: amount,
    currency,
    price_gbp: priceGbp,
    price_usd: priceUsd,
    category,
    description: '',
    product_url: `${baseUrl}/package/${packageId}`,
    recurring
  };
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
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
    default:
      priceUsd = amount;
      priceGbp = amount * fxRate;
  }
  return {
    priceGbp: Math.round(priceGbp * 100) / 100,
    priceUsd: Math.round(priceUsd * 100) / 100
  };
}

async function fetchFxRate() {
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (resp.ok) {
      const data = await resp.json();
      if (data?.rates?.GBP) return data.rates.GBP;
    }
  } catch {}
  return 0.79;
}

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

  if (summary.entry_tier_gbp != null) {
    const entryUsd = summary.entry_tier_gbp / 0.79;
    if (entryUsd >= 30) {
      pushFlag('Pricing posture', 'High entry tier', 1,
        `Entry-tier subscription at £${summary.entry_tier_gbp.toFixed(2)} (approx $${entryUsd.toFixed(2)}).`);
    }
  }
  if (summary.top_tier_gbp != null) {
    const topUsd = summary.top_tier_gbp / 0.79;
    if (topUsd >= 150) {
      pushFlag('Pricing posture', 'High top tier', 2,
        `Top-tier subscription at £${summary.top_tier_gbp.toFixed(2)} (approx $${topUsd.toFixed(2)}). Editorial review required.`);
    }
  }
  if (summary.entry_tier_gbp > 0 && summary.top_tier_gbp / summary.entry_tier_gbp >= 5) {
    pushFlag('Pricing posture', 'Aggressive tier ladder', 2,
      `Top tier is ${(summary.top_tier_gbp / summary.entry_tier_gbp).toFixed(1)}x entry tier.`);
  }

  if (summary.total_products >= 80) {
    pushFlag('Catalogue breadth', 'Large catalogue', 1,
      `${summary.total_products} products listed. Large catalogues suggest aggressive monetisation shape.`);
  } else if (summary.total_products > 0 && summary.total_products <= 3) {
    pushFlag('Catalogue breadth', 'Very small catalogue', 1,
      `Only ${summary.total_products} products found. Verify parse succeeded.`);
  }

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

// v2.1: run ID now includes seconds to prevent UNIQUE constraint collisions
function makeRunId(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function cleanUrl(url) {
  url = String(url).trim();
  while (url.endsWith('/')) url = url.slice(0, -1);
  if (!url.startsWith('http')) url = 'https://' + url;
  return url;
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

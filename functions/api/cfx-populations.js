// ================================================================
// functions/api/cfx-populations.js
// GET /api/cfx-populations
//
// Fetches live player counts from the public FiveM master server
// (servers-frontend.fivem.net/api/servers/single/{cfx_id}) for the
// CFX server IDs we have on file. Aggregated server-side because
// the FiveM API doesn't send CORS headers, so the browser can't
// hit it directly.
//
// 60-second KV cache (server populations don't change fast enough
// to justify a tighter window) plus 30s edge cache.
// ================================================================

// CFX server IDs verified 2026-04-27 against servers-frontend.fivem.net.
// `null` = no public CFX ID known yet (whitelist-only / private / not searched).
// Keep in sync with SERVERS in gta-rp/servers/index.html.
const CFX_IDS = {
  'unique':      'ok4qzr',
  'tng':         null,
  'orbit':       '5j8edz',
  'new-era':     'z5okp5',
  'prodigy':     '775kda',
  'd10':         null,
  'unmatched':   'r43qej',
  'chase':       null,
  'verarp':      null,
  'endz':        null,
  'letsrp':      null,
  'drilluk':     null,
  'britishlife': null,
};

const CACHE_URL = 'https://contentlore.com/cache/cfx-populations';
const CACHE_TTL = 180;

export async function onRequestGet({ waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_URL);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const entries = Object.entries(CFX_IDS).filter(([, id]) => id);

  // Parallel fetch every known CFX ID. Promise.allSettled keeps a single
  // upstream failure from taking down the whole response.
  const results = await Promise.allSettled(
    entries.map(([serverId, cfxId]) => fetchOne(serverId, cfxId))
  );

  const populations = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      populations[r.value.server_id] = r.value;
    }
  }

  const payload = {
    ok: true,
    fetched_at: new Date().toISOString(),
    populations,
    total_known: entries.length,
    total_returned: Object.keys(populations).length,
  };

  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${CACHE_TTL}`,
    },
  });
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function fetchOne(serverId, cfxId) {
  const url = `https://servers-frontend.fivem.net/api/servers/single/${encodeURIComponent(cfxId)}`;
  // The API returns 404 if the server is offline / delisted. Treat that as
  // "no data" rather than throwing — the client just shows a dash.
  const res = await fetch(url, {
    headers: {
      'user-agent': 'ContentLore/1.0 (+https://contentlore.com)',
      'accept': 'application/json',
    },
  });
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch { return null; }

  // Response shape: { Data: { hostname, clients, sv_maxclients, vars: { sv_maxclients }, locale, ... } }
  const d = data?.Data || data;
  const clients = Number(d?.clients ?? 0);
  const maxClients = Number(d?.sv_maxclients ?? d?.vars?.sv_maxclients ?? 0);
  if (!Number.isFinite(clients) || !Number.isFinite(maxClients)) return null;

  return {
    server_id: serverId,
    cfx_id: cfxId,
    hostname: d?.hostname || null,
    clients,
    max_clients: maxClients,
    locale: d?.locale || null,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}

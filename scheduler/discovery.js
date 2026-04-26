// discovery.js — UK GTA RP creator discovery scanner
// Called from scheduler alongside polling.js, sessions.js, scenes.js
// Scans Twitch GTA V category for UK RP streams not already in the creators table

// GTA V Twitch category ID
const GTA_V_GAME_ID = '32982';

// UK RP detection keywords
const UK_KEYWORDS = [
  'uk', 'british', 'london', 'england', 'manchester', 'birmingham',
  'scottish', 'welsh', 'irish', 'liverpool', 'leeds', 'essex',
];

const RP_KEYWORDS = [
  'rp', 'roleplay', 'role play', 'roleplaying',
  'fivem', 'five m', 'gtarp', 'gta rp',
];

const SERVER_KEYWORDS = [
  { name: 'JESTRP',    keywords: ['jestrp', 'jest rp', 'jest_rp', 'jest'] },
  { name: 'ONERP',     keywords: ['onerp', 'one rp', 'one_rp'] },
  { name: 'MTRP',      keywords: ['mtrp', 'mt rp', 'mt_rp', 'mersey'] },
  { name: 'NPRP',      keywords: ['nprp', 'np rp', 'np_rp'] },
  { name: 'NOPIXEL',   keywords: ['nopixel', 'no pixel', 'no_pixel'] },
  { name: 'LUCID',     keywords: ['lucidcity', 'lucid city', 'lucidrp'] },
  { name: 'IGNITE',    keywords: ['igniterp', 'ignite rp', 'ignite_rp'] },
  { name: 'ECLIPSERP', keywords: ['eclipserp', 'eclipse rp', 'eclipse_rp'] },
  { name: 'PRODIGY',   keywords: ['prodigyrp', 'prodigy rp', 'prodigy_rp'] },
  { name: 'UKRP',      keywords: ['ukrp', 'uk rp', 'uk_rp'] },
];

// Negative keywords — streams that match these are NOT UK RP
const NEGATIVE_KEYWORDS = [
  'gta online', 'gta 5 online', 'story mode', 'speedrun',
  'mod menu', 'money glitch', 'car meet',
];

function looksUKGTARP(title, tags) {
  const combined = `${title || ''} ${(tags || []).join(' ')}`.toLowerCase();

  // Reject if negative keywords match
  if (NEGATIVE_KEYWORDS.some(neg => combined.includes(neg))) return false;

  // Must have at least one RP keyword
  const hasRP = RP_KEYWORDS.some(kw => combined.includes(kw));
  if (!hasRP) return false;

  // Check for UK keyword OR known UK server
  const hasUK = UK_KEYWORDS.some(kw => {
    // Word boundary check for short keywords like 'uk'
    if (kw.length <= 3) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(combined);
    }
    return combined.includes(kw);
  });

  const hasServer = SERVER_KEYWORDS.some(s =>
    s.keywords.some(kw => combined.includes(kw))
  );

  return hasUK || hasServer;
}

function detectServer(title, tags) {
  const combined = `${title || ''} ${(tags || []).join(' ')}`.toLowerCase();
  for (const server of SERVER_KEYWORDS) {
    if (server.keywords.some(kw => combined.includes(kw))) {
      return server.name;
    }
  }
  return null;
}

async function fetchTwitchToken(env) {
  // Try KV cache first
  const cached = await env.KV.get('twitch_token');
  if (cached) return cached;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${env.TWITCH_CLIENT_ID}&client_secret=${env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  const data = await res.json();
  if (data.access_token) {
    await env.KV.put('twitch_token', data.access_token, { expirationTtl: data.expires_in - 300 });
    return data.access_token;
  }
  throw new Error('Failed to get Twitch token');
}

async function fetchGTAVStreams(token, clientId, cursor) {
  const url = new URL('https://api.twitch.tv/helix/streams');
  url.searchParams.set('game_id', GTA_V_GAME_ID);
  url.searchParams.set('first', '100');
  url.searchParams.set('language', 'en');
  if (cursor) url.searchParams.set('after', cursor);

  const res = await fetch(url.toString(), {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Twitch API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export async function discoverCreators(env) {
  console.log('[discovery] Starting UK GTA RP creator scan');

  try {
    const token = await fetchTwitchToken(env);
    const clientId = env.TWITCH_CLIENT_ID;

    // Fetch up to 3 pages (300 streams) from GTA V category
    let allStreams = [];
    let cursor = null;
    const maxPages = 3;

    for (let page = 0; page < maxPages; page++) {
      const data = await fetchGTAVStreams(token, clientId, cursor);
      const streams = data.data || [];
      allStreams.push(...streams);
      cursor = data.pagination?.cursor;
      if (!cursor || streams.length < 100) break;
    }

    console.log(`[discovery] Fetched ${allStreams.length} GTA V streams`);

    // Filter for UK RP
    const ukStreams = allStreams.filter(s =>
      looksUKGTARP(s.title, s.tags || s.tag_ids)
    );

    console.log(`[discovery] ${ukStreams.length} match UK RP filter`);

    if (ukStreams.length === 0) return { discovered: 0, new: 0 };

    // Get existing creators from DB to skip known ones
    const existingResult = await env.DB.prepare(
      'SELECT LOWER(creator_name) as name FROM creators'
    ).all();
    const existingNames = new Set(
      (existingResult.results || []).map(r => r.name)
    );

    // Filter out already-known creators
    const newStreams = ukStreams.filter(s =>
      !existingNames.has(s.user_login.toLowerCase())
    );

    console.log(`[discovery] ${newStreams.length} are new (not in creators table)`);

    if (newStreams.length === 0) return { discovered: ukStreams.length, new: 0 };

    // Upsert into pending_creators
    const now = new Date().toISOString();
    const batch = [];

    for (const stream of newStreams) {
      const server = detectServer(stream.title, stream.tags);
      const tags = JSON.stringify(stream.tags || []);

      // Try insert, on conflict update last_seen and bump count
      batch.push(
        env.DB.prepare(`
          INSERT INTO pending_creators (name, platform, channel_id, profile_image, discovered_title, discovered_viewers, discovered_tags, detected_server, discovery_count, first_seen, last_seen, status)
          VALUES (?, 'twitch', ?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending')
          ON CONFLICT(name, platform) DO UPDATE SET
            discovered_title = excluded.discovered_title,
            discovered_viewers = excluded.discovered_viewers,
            discovered_tags = excluded.discovered_tags,
            detected_server = COALESCE(excluded.detected_server, pending_creators.detected_server),
            discovery_count = pending_creators.discovery_count + 1,
            last_seen = excluded.last_seen
        `).bind(
          stream.user_login.toLowerCase(),
          stream.user_id,
          stream.thumbnail_url?.replace('{width}', '70')?.replace('{height}', '70') || null,
          stream.title,
          stream.viewer_count || 0,
          tags,
          server,
          now,
          now
        )
      );
    }

    // Execute in batches of 25 (D1 batch limit)
    for (let i = 0; i < batch.length; i += 25) {
      await env.DB.batch(batch.slice(i, i + 25));
    }

    console.log(`[discovery] Upserted ${batch.length} pending creators`);

    return {
      discovered: ukStreams.length,
      new: newStreams.length,
      upserted: batch.length,
    };
  } catch (err) {
    console.error(`[discovery] Error: ${err.message}`);
    return { discovered: 0, new: 0, error: err.message };
  }
}

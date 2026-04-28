// ================================================================
// functions/api/admin/scout.js
// GET /api/admin/scout
// One-shot diagnostic endpoint for the streamer scout sweep:
//   1. Cross-platform check — for every tracked streamer, look up the
//      other platform with the same handle. Surfaces unconfirmed
//      multi-platform creators.
//   2. Kick GTA V scan — list every live Kick broadcaster in the
//      GTA V category that we're not already tracking.
//
// Bearer-authed against env.ADMIN_TOKEN. Read-only.
// ================================================================

import { jsonResponse, getTwitchToken, getKickToken } from '../../_lib.js';
import { getCuratedList } from '../../_curated.js';

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, error: 'Unauthorised' }, 401);
  }
  return null;
}

const RP_KEYWORDS = ['rp', 'roleplay', 'role play', 'roleplaying', 'fivem', 'gtarp', 'gta rp'];
const UK_KEYWORDS = [
  'unique rp', 'uniquerp', 'tng rp', 'tngrp', 'orbit rp', 'orbitrp',
  'unmatched rp', 'unmatchedrp', 'verarp', 'vera rp', 'the ends', 'theends',
  'ends rp', 'theendsrp', "let's rp", 'letsrp', 'lets rp', 'drill uk',
  'drilluk', 'drill rp', 'british life', 'britishlife',
  'new era rp', 'newera rp', 'new era', 'prodigy rp', 'prodigyrp', 'prodigy',
  'd10 rp', 'd10rp', 'd10', 'chase rp', 'chaserp',
  // Plus generic UK indicators
  ' uk ', '🇬🇧', 'british',
];

function looksRP(title) {
  if (!title) return false;
  const t = String(title).toLowerCase();
  return RP_KEYWORDS.some(kw => t.includes(kw));
}
function looksUKish(title, tags) {
  const t = (String(title || '') + ' ' + (Array.isArray(tags) ? tags.join(' ') : '')).toLowerCase();
  return UK_KEYWORDS.some(kw => t.includes(kw));
}
function detectServer(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  for (const kw of UK_KEYWORDS) if (t.includes(kw)) return kw;
  return null;
}

export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const probeParam = url.searchParams.get('probe');

    // ?probe=h1,h2,h3 mode — check Kick + Twitch existence for arbitrary
    // handles (not just curated). Returns only public stream metadata.
    if (probeParam) {
      const handles = probeParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
      const out = { ok: true, mode: 'probe', handles, twitch: {}, kick: {} };
      try {
        const tToken = await getTwitchToken(env);
        const params = handles.map(h => `login=${encodeURIComponent(h)}`).join('&');
        const r = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
          headers: { 'Client-ID': env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${tToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          for (const u of (j.data || [])) {
            out.twitch[u.login.toLowerCase()] = {
              login: u.login,
              display_name: u.display_name,
              id: u.id,
              tier: u.broadcaster_type || 'normal',
              description: (u.description || '').slice(0, 120),
            };
          }
        }
      } catch (e) { out.twitch_error = e.message; }
      try {
        const kToken = await getKickToken(env);
        const slugQs = handles.map(h => `slug=${encodeURIComponent(h)}`).join('&');
        const r = await fetch(`https://api.kick.com/public/v1/channels?${slugQs}`, {
          headers: { authorization: `Bearer ${kToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          for (const ch of (j.data || [])) {
            const slug = String(ch.slug || '').toLowerCase();
            out.kick[slug] = {
              slug: ch.slug,
              broadcaster_user_id: ch.broadcaster_user_id,
              category: ch.category?.name || null,
              description: (ch.channel_description || '').slice(0, 120),
            };
          }
        }
      } catch (e) { out.kick_error = e.message; }
      return jsonResponse(out);
    }

    const curated = await getCuratedList(env);
    const out = {
      ok: true,
      cross_platform: { twitch_lookups_for_kick_creators: [], kick_lookups_for_twitch_creators: [] },
      kick_gtav: { live_count: 0, untracked_uk: [], untracked_other: [] },
      errors: [],
    };

    // ----------------------------------------------------------------
    // 1. Cross-platform check
    // ----------------------------------------------------------------

    // 1a. For each Kick-primary creator: look up Twitch with same handle
    const kickCreators = curated.filter(c => c.platform === 'kick' && !c.socials?.twitch);
    if (kickCreators.length > 0) {
      try {
        const tToken = await getTwitchToken(env);
        const params = kickCreators.map(c => `login=${encodeURIComponent(c.handle)}`).join('&');
        const r = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
          headers: { 'Client-ID': env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${tToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          const found = new Set((j.data || []).map(u => u.login.toLowerCase()));
          const detail = (j.data || []).reduce((m, u) => { m[u.login.toLowerCase()] = u; return m; }, {});
          for (const c of kickCreators) {
            if (found.has(c.handle)) {
              const u = detail[c.handle];
              out.cross_platform.twitch_lookups_for_kick_creators.push({
                curated_handle: c.handle,
                display_name: c.display_name,
                twitch_login: u.login,
                twitch_display_name: u.display_name,
                twitch_id: u.id,
                followers_indicator: u.broadcaster_type || 'normal',
                description: u.description || '',
              });
            }
          }
        } else {
          out.errors.push('twitch helix users failed: ' + r.status);
        }
      } catch (e) {
        out.errors.push('twitch helix users threw: ' + e.message);
      }
    }

    // 1b. For each Twitch-primary creator: look up Kick with same handle
    const twitchCreators = curated.filter(c => c.platform === 'twitch' && !c.socials?.kick);
    if (twitchCreators.length > 0) {
      try {
        const kToken = await getKickToken(env);
        const slugQs = twitchCreators.map(c => `slug=${encodeURIComponent(c.handle)}`).join('&');
        const r = await fetch(`https://api.kick.com/public/v1/channels?${slugQs}`, {
          headers: { authorization: `Bearer ${kToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          const channels = j.data || [];
          for (const ch of channels) {
            const slug = String(ch.slug || '').toLowerCase();
            const match = twitchCreators.find(c => c.handle === slug);
            if (!match) continue;
            out.cross_platform.kick_lookups_for_twitch_creators.push({
              curated_handle: match.handle,
              display_name: match.display_name,
              kick_slug: ch.slug,
              kick_broadcaster_id: ch.broadcaster_user_id,
              channel_description: (ch.channel_description || '').slice(0, 160),
              category: ch.category?.name || null,
            });
          }
        } else {
          out.errors.push('kick channels failed: ' + r.status);
        }
      } catch (e) {
        out.errors.push('kick channels threw: ' + e.message);
      }
    }

    // ----------------------------------------------------------------
    // 2. Kick GTA V scan — find untracked broadcasters live in GTA V.
    // ----------------------------------------------------------------
    try {
      const kToken = await getKickToken(env);

      // Resolve GTA V category id once.
      const catRes = await fetch('https://api.kick.com/public/v1/categories?q=Grand%20Theft%20Auto%20V', {
        headers: { authorization: `Bearer ${kToken}` },
      });
      let gtaCatId = null;
      if (catRes.ok) {
        const catJson = await catRes.json();
        // Match exact name or "GTA V"
        const exact = (catJson.data || []).find(c =>
          /^grand theft auto v$/i.test(c.name) || /^gta v$/i.test(c.name)
        );
        gtaCatId = exact?.id || catJson.data?.[0]?.id || null;
      } else {
        out.errors.push('kick categories failed: ' + catRes.status);
      }
      out.kick_gtav.category_id_used = gtaCatId;

      if (gtaCatId) {
        const lsRes = await fetch(
          `https://api.kick.com/public/v1/livestreams?category_id=${gtaCatId}&limit=100&sort=viewer_count`,
          { headers: { authorization: `Bearer ${kToken}` } }
        );
        if (lsRes.ok) {
          const lsJson = await lsRes.json();
          const streams = lsJson.data || [];
          out.kick_gtav.live_count = streams.length;

          const trackedSlugs = new Set(curated.filter(c => c.socials?.kick).map(c => String(c.socials.kick).toLowerCase()));
          for (const s of streams) {
            const slug = String(s.slug || s.channel?.slug || '').toLowerCase();
            if (!slug || trackedSlugs.has(slug)) continue;
            const title = String(s.stream_title || '').slice(0, 200);
            const tags = Array.isArray(s.tags) ? s.tags : [];
            const isRP = looksRP(title);
            const ukish = looksUKish(title, tags);
            const server = detectServer(title);
            const entry = {
              kick_slug: slug,
              viewers: s.viewer_count || 0,
              language: s.language || null,
              title,
              tags,
              is_rp: isRP,
              detected_server: server,
            };
            if (isRP && (ukish || server)) {
              out.kick_gtav.untracked_uk.push(entry);
            } else {
              out.kick_gtav.untracked_other.push(entry);
            }
          }
          // Trim "other" so the response stays manageable.
          out.kick_gtav.untracked_other_total = out.kick_gtav.untracked_other.length;
          out.kick_gtav.untracked_other = out.kick_gtav.untracked_other.slice(0, 30);
          out.kick_gtav.untracked_uk.sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
        } else {
          out.errors.push('kick livestreams failed: ' + lsRes.status);
        }
      }
    } catch (e) {
      out.errors.push('kick gtav scan threw: ' + e.message);
    }

    return jsonResponse(out);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ================================================================
// functions/api/servers.js
// GET /api/servers
//
// Returns the full UK GTA RP server registry with metadata,
// roster handles, and current live state per server.
// Enriched with data from both ContentLore and Lovable builds.
// ================================================================

import { jsonResponse } from '../_lib.js';

const SERVERS = [
  {
    id: 'unique',
    name: 'Unique RP',
    short: 'Unique',
    tagline: 'The big one. Drama factory of the UK scene.',
    blurb: 'The flagship UK GTA RP server. High creator density, long-running storylines, and a constant rotation of beef, businesses and police chases.',
    keywords: ['unique rp', 'uniquerp', 'unique'],
    roster_handles: ['kavsual', 'shammers', 'deggyuk', 'tyrone', 'samham', 'stoker', 'reeclare', 'megsmary'],
    vibe: ['serious', 'criminal', 'civ-heavy'],
    colour: '#6B5A8F',
  },
  {
    id: 'tng',
    name: 'TNG RP',
    short: 'TNG',
    tagline: 'The new kid making noise.',
    blurb: 'Fresh UK server with launch energy and a growing creator roster. Currently running launch storylines pulling people in from the bigger servers.',
    keywords: ['tng rp', 'tngrp', 'tng'],
    roster_handles: ['deggyuk', 'tazzthegeeza', 'wheelydev', 'absthename'],
    vibe: ['serious', 'newbie-friendly'],
    colour: '#8B6D47',
  },
  {
    id: 'orbit',
    name: 'Orbit RP',
    short: 'Orbit',
    tagline: 'Heads-down serious RP, UK base.',
    blurb: 'UK serious-RP server with a focus on character-driven storylines and quality over volume. Lower noise floor, higher RP standard.',
    keywords: ['orbit rp', 'orbitrp', 'orbit'],
    roster_handles: ['lbmm', 'reeclare', 'cherish_remedy', 'stoker', 'wheelydev', 'lorddorro'],
    vibe: ['serious', 'civ-heavy'],
    colour: '#D4A574',
  },
  {
    id: 'new-era',
    name: 'New Era RP',
    short: 'New Era',
    tagline: 'Fresh chapter, fresh storylines.',
    blurb: 'Newer UK GTA RP server pitching itself as a clean-slate scene. Building roster and storylines from the ground up.',
    keywords: ['new era rp', 'newera rp', 'neweraRP', 'new era', 'newera', 'nerp'],
    roster_handles: [],
    vibe: ['serious', 'newbie-friendly'],
    colour: '#5D8FB8',
  },
  {
    id: 'prodigy',
    name: 'Prodigy RP',
    short: 'Prodigy',
    tagline: 'Up-and-comer with momentum.',
    blurb: 'UK GTA RP server building a name on character-driven RP and a growing creator pull. One to watch.',
    keywords: ['prodigy rp', 'prodigyrp', 'prodigy'],
    roster_handles: [],
    vibe: ['serious', 'criminal'],
    colour: '#4A9B8F',
  },
  {
    id: 'd10',
    name: 'D10 RP',
    short: 'D10',
    tagline: 'Tight-knit, story-first server.',
    blurb: 'UK GTA RP server with a focused roster and an emphasis on long-form character work over high-volume action.',
    keywords: ['d10 rp', 'd10rp', 'd10', 'district 10', 'district10'],
    roster_handles: [],
    vibe: ['serious', 'civ-heavy'],
    colour: '#C46A57',
  },
  {
    id: 'unmatched',
    name: 'Unmatched RP',
    short: 'Unmatched',
    tagline: 'Action-first, drama always.',
    blurb: 'UK GTA RP server leaning into high-tempo content — chases, beefs and PD activity. Shammers\' home turf.',
    keywords: ['unmatched rp', 'unmatchedrp', 'unmatched'],
    roster_handles: ['shammers', 'kavsual', 'absthename', 'rexality', 'steeel', 'justj0hnnyhd'],
    vibe: ['criminal', 'stunt'],
    colour: '#6B8F73',
  },
  {
    id: 'vera',
    name: 'VeraRP',
    short: 'Vera',
    tagline: 'Serious tier. Compliance leader.',
    blurb: 'One of the UK\'s most structured RP servers. Passes on evidence-backed compliance checks.',
    keywords: ['vera', 'verarp', 'vera rp'],
    roster_handles: [],
    vibe: ['serious'],
    colour: '#C0C0B8',
  },
  {
    id: 'endz',
    name: 'The EndZ',
    short: 'EndZ',
    tagline: 'Popularity leader. Under review.',
    blurb: 'The most popular UK server by peak CCV. Production polish and strong viewership, though "No Pay to Win" claim is under scoreboard review.',
    keywords: ['endz', 'the endz', 'theendz'],
    roster_handles: [],
    vibe: ['action'],
    colour: '#B64545',
  },
  {
    id: 'letsrp',
    name: "Let's RP",
    short: "Let's RP",
    tagline: 'Smaller, tighter, whitelisted.',
    blurb: 'Lower ceiling on popularity, high floor on quality. Regular features by UK RP creators.',
    keywords: ['letsrp', "let's rp", 'lets rp'],
    roster_handles: [],
    vibe: ['serious'],
    colour: '#5D8FB8',
  },
  {
    id: 'drill-uk',
    name: 'Drill UK RP',
    short: 'Drill UK',
    tagline: 'UK drill-themed. Niche audience.',
    blurb: 'Drill-themed server with heavy narrative around London gang life. Content moderation questions under review.',
    keywords: ['drill uk', 'drilluk', 'drill uk rp'],
    roster_handles: [],
    vibe: ['themed'],
    colour: '#C46A57',
  },
  {
    id: 'british-life',
    name: 'British Life RP',
    short: 'BLRP',
    tagline: 'Casual British-themed. Gateway server.',
    blurb: 'Low barrier to entry, broad themed appeal, limited narrative ambition. The gateway server for new RP players.',
    keywords: ['british life', 'britishlife', 'blrp', 'british life rp'],
    roster_handles: [],
    vibe: ['casual'],
    colour: '#6B8F73',
  },
];

export async function onRequestGet({ env, request }) {
  try {
    // Get live state from stream_sessions
    const now = Math.floor(Date.now() / 1000);
    const sessRes = await env.DB.prepare(`
      SELECT 
        c.id, c.display_name, c.avatar_url,
        cp.handle, cp.platform,
        ss.peak_viewers, ss.final_title
      FROM stream_sessions ss
      INNER JOIN creators c ON c.id = ss.creator_id
      LEFT JOIN creator_platforms cp ON cp.creator_id = c.id AND cp.is_primary = 1
      WHERE ss.is_ongoing = 1 AND c.role = 'creator'
    `).all();

    const liveStreams = (sessRes.results || []).map(r => ({
      handle: r.handle,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
      platform: r.platform,
      viewers: r.peak_viewers || 0,
      stream_title: r.final_title,
    }));

    // Match live streams to servers via title keywords
    const enriched = SERVERS.map(server => {
      const liveOnServer = liveStreams.filter(s => {
        if (!s.stream_title) return false;
        const t = s.stream_title.toLowerCase();
        return server.keywords.some(kw => t.includes(kw));
      });

      return {
        ...server,
        live_count: liveOnServer.length,
        total_viewers: liveOnServer.reduce((sum, s) => sum + s.viewers, 0),
        live_streams: liveOnServer,
      };
    });

    // Sort: servers with live activity first, then by roster size
    enriched.sort((a, b) => {
      if (a.live_count !== b.live_count) return b.live_count - a.live_count;
      if (a.total_viewers !== b.total_viewers) return b.total_viewers - a.total_viewers;
      return b.roster_handles.length - a.roster_handles.length;
    });

    // Off-grid: live streams not matching any server
    const matchedHandles = new Set(
      enriched.flatMap(s => s.live_streams.map(ls => ls.handle))
    );
    const offGrid = liveStreams.filter(s => !matchedHandles.has(s.handle));

    return jsonResponse({
      ok: true,
      servers: enriched,
      server_count: SERVERS.length,
      active_count: enriched.filter(s => s.live_count > 0).length,
      total_scene_viewers: enriched.reduce((sum, s) => sum + s.total_viewers, 0),
      off_grid: offGrid,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

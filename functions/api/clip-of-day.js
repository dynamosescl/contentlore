// ================================================================
// functions/api/clip-of-day.js
// GET  /api/clip-of-day             — public: returns today's pick
// POST /api/clip-of-day             — admin: generates pick for date
//
// Picks the most entertaining/dramatic clip from yesterday's top 10
// by view count, with a 50-word AI caption. Stored in clip_of_day
// and refreshed once per day by the scheduler at 06:00 UTC.
//
// The pool is sourced from /api/clips?range=24h. Anthropic gets the
// 10 candidates with title/creator/views and is asked for an index +
// caption. Falls back to "first by views" + a deterministic caption
// if the API call fails — clips/page never renders empty.
// ================================================================

import { jsonResponse } from '../_lib.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 350;
const POOL_SIZE = 10;

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function yesterdayYmd() {
  return ymd(new Date(Date.now() - 86400_000));
}

// ----------------------------------------------------------------
// Anthropic call: pick a clip + caption.
// ----------------------------------------------------------------
async function pickClipWithClaude(env, candidates) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const lines = candidates.map((c, i) =>
    `[${i}] "${(c.title || '(no title)').slice(0, 200)}" by ${c.creator_name || c.creator_handle} — ${c.view_count || 0} views, ${c.duration ? Math.round(c.duration) + 's' : '?s'}, game: ${c.game_name || 'unknown'}`
  ).join('\n');

  const userPrompt = `Pick the single most entertaining or dramatic clip from yesterday's UK GTA RP scene. Here are the top 10 clips by view count:

${lines}

Reply with strict JSON only: {"index": <0-9>, "caption": "..." }
The caption should be ~50 words, present tense, name the streamer, hint at what happens without spoiling the punchline. No hedging, no "this clip", no markdown.`;

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{
      type: 'text',
      text: 'You curate clips for ContentLore, a UK GTA RP streaming intelligence site. Your audience watches the scene daily. Pick clips with high entertainment value — laughs, drama, action, surprise — over high view counts alone (view counts are already in the data). Write captions like a sports highlights reporter. UK English spelling. Output ONLY the JSON object — no prefix, no code fence, no commentary.',
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: userPrompt }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  const raw = j?.content?.[0]?.text?.trim() || '';
  // Pull the first {...} blob from the response so accidental prose
  // doesn't break parsing.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Anthropic returned non-JSON: ' + raw.slice(0, 120));
  const parsed = JSON.parse(match[0]);
  const idx = Math.max(0, Math.min(candidates.length - 1, Number(parsed.index ?? 0)));
  const caption = String(parsed.caption || '').trim();
  if (!caption) throw new Error('Anthropic returned empty caption');
  return { index: idx, caption, model: j?.model || MODEL };
}

function fallbackPick(candidates) {
  const c = candidates[0];
  if (!c) return null;
  const cap = `${c.creator_name || c.creator_handle} put together the most-watched clip of the day, pulling ${c.view_count || 0} views.`;
  return { index: 0, caption: cap, model: 'fallback' };
}

// ----------------------------------------------------------------
// GET — return today's stored pick (or yesterday's if today's hasn't
// been generated yet).
// ----------------------------------------------------------------
export async function onRequestGet({ env }) {
  try {
    const row = await env.DB.prepare(
      `SELECT date, clip_id, clip_data, caption, picked_by, model, generated_at
       FROM clip_of_day
       ORDER BY date DESC
       LIMIT 1`
    ).first();
    if (!row) return jsonResponse({ ok: true, pick: null });
    let clip = null;
    try { clip = JSON.parse(row.clip_data); } catch { /* ignore */ }
    return jsonResponse({
      ok: true,
      pick: {
        date: row.date,
        clip_id: row.clip_id,
        caption: row.caption,
        picked_by: row.picked_by,
        model: row.model,
        generated_at: Number(row.generated_at),
        clip,
      },
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// ----------------------------------------------------------------
// POST — generate today's pick. Admin-auth only.
//   ?date=YYYY-MM-DD   defaults to yesterday
//   ?force=1           regenerate even if a row exists
// ----------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.ADMIN_TOKEN || ''}`;
  if (!env.ADMIN_TOKEN || auth !== expected) {
    return jsonResponse({ ok: false, error: 'unauthorised' }, 401);
  }
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || yesterdayYmd();
  const force = url.searchParams.get('force') === '1';

  try {
    if (!force) {
      const existing = await env.DB.prepare(
        `SELECT date, clip_id, clip_data, caption, picked_by, model, generated_at
         FROM clip_of_day WHERE date = ?`
      ).bind(date).first();
      if (existing) {
        let clip = null;
        try { clip = JSON.parse(existing.clip_data); } catch {}
        return jsonResponse({
          ok: true, reused: true,
          pick: { ...existing, clip, generated_at: Number(existing.generated_at) },
        });
      }
    }

    // Pull yesterday's clips. /api/clips?range=24h gives us the top
    // by view count across all tracked Twitch broadcasters.
    const clipsRes = await fetch(new URL('/api/clips?range=24h', request.url).toString());
    const clipsJson = await clipsRes.json().catch(() => ({}));
    const all = clipsJson?.clips || [];
    if (!all.length) {
      return jsonResponse({ ok: false, error: 'no_clips_in_window', date }, 200);
    }
    const pool = all.slice(0, POOL_SIZE);

    let picked, source;
    try {
      picked = await pickClipWithClaude(env, pool);
      source = 'anthropic';
    } catch (err) {
      console.error('[clip-of-day] anthropic failed', String(err?.message || err));
      picked = fallbackPick(pool);
      source = 'fallback';
    }
    if (!picked) return jsonResponse({ ok: false, error: 'no_pick' }, 500);

    const clip = pool[picked.index];
    await env.DB.prepare(
      `INSERT INTO clip_of_day (date, clip_id, clip_data, caption, picked_by, model, candidates, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         clip_id = excluded.clip_id,
         clip_data = excluded.clip_data,
         caption = excluded.caption,
         picked_by = excluded.picked_by,
         model = excluded.model,
         candidates = excluded.candidates,
         generated_at = excluded.generated_at`
    ).bind(
      date,
      clip.id || clip.url || 'unknown',
      JSON.stringify(clip),
      picked.caption,
      source,
      picked.model,
      JSON.stringify(pool.map(p => ({ id: p.id, title: p.title, views: p.view_count, creator: p.creator_handle }))),
      Math.floor(Date.now() / 1000),
    ).run();

    return jsonResponse({
      ok: true,
      generated: true,
      pick: { date, clip_id: clip.id, caption: picked.caption, picked_by: source, model: picked.model, clip },
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Grade a set of albums from public numbers, for ranking reels. The account stays neutral: no editorial
// picks, only a fixed, published formula applied the same way to every album.
//
//   node --env-file=../apps/web/.env.local reels/grade.mjs 002-kma-hiphop [--refresh]
//
// Reads  reels/work/<slug>/albums.csv   — the pool, plus HAND-ENTERED columns:
//          rym (0–5 average), aoty_critic (0–100), aoty_user (0–100), kma_wins (count)
//          RYM and AOTY forbid automated access, so those are typed in by a person reading the pages.
// Fetches (official APIs, cached in auto.json): Last.fm album listeners (LASTFM_API_KEY), Deezer cover (no key), YouTube views only if YOUTUBE_API_KEY is set (not wired yet → skipped).
// Writes reels/work/<slug>/graded.json (sorted, with every part) and assets/<n>.jpg covers.
//
// GRADE (0–100) = 60% ratings + 15% reach (shown as 인기) + 25% recognition
//   ratings     = mean of available: RYM×20, AOTY critic, AOTY user
//   reach       = log-scaled Last.fm listeners, summed over the album's duplicate entries (10 → 0, 100k → 100).
//                 Deezer is used for covers only: it barely covers Korean albums, so its counts would penalise them.
//   recognition = min(100, 25 × KMA wins for the album)
// A missing part is dropped and the weights renormalised; such a grade is marked draft.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const W = { ratings: 0.6, reach: 0.15, recognition: 0.25 };
const UA = 'insta-posts/0.1 (music education carousel generator)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); rows.push(out);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const logScale = (x, lo, hi) => (x == null || x <= 0 ? null : Math.max(0, Math.min(100, ((Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100)));
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// Last.fm splits one album across several entries when people tag the artist differently ("비프리", "B-Free",
// "비프리 & Hukky Shibaseki"…). Collect every entry whose album name exactly matches one of the listed variants
// (normalised) and whose artist contains one of the artist's names, then SUM their listeners. Listed in auto.json.
export const norm = (s = '') => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}+]/gu, '');
async function lfm(params) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error('LASTFM_API_KEY is not set — run with --env-file=../apps/web/.env.local');
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({ ...params, api_key: key, format: 'json' })}`, { headers: { 'User-Agent': UA } });
  await sleep(250);
  return r.json();
}
export async function lastfm(artistNames, albumVariants) {
  const names = artistNames.flatMap((n) => n.split(/\s*(?:&|\bX\b|\|)\s*/i)).map(norm).filter((n) => n.length > 1);
  const titles = new Set(albumVariants.map(norm));
  const found = new Map();
  for (const v of albumVariants) {
    const j = await lfm({ method: 'album.search', album: v, limit: '50' });
    for (const e of j.results?.albummatches?.album || []) {
      if (titles.has(norm(e.name)) && names.some((n) => norm(e.artist).includes(n))) found.set(`${e.artist}\u0000${e.name}`, e);
    }
  }
  // fallback: a common title ("bleu") drowns in search results — ask for the album directly by artist name
  if (!found.size) {
    for (const a of artistNames.flatMap((n) => n.split('|')).map((x) => x.trim()).filter(Boolean)) {
      for (const v of albumVariants) {
        const j = await lfm({ method: 'album.getinfo', artist: a, album: v });
        if (j.album && titles.has(norm(j.album.name))) found.set(`${j.album.artist}\u0000${j.album.name}`, { artist: j.album.artist, name: j.album.name });
      }
    }
  }
  const entries = [];
  for (const e of found.values()) {
    const j = await lfm({ method: 'album.getinfo', artist: e.artist, album: e.name });
    if (j.album) entries.push({ artist: j.album.artist, name: j.album.name, listeners: Number(j.album.listeners), url: j.album.url,
      image: ((j.album.image || []).map((x) => x['#text']).filter(Boolean).pop() || '').replace(/\/i\/u\/[^/]+\//, '/i/u/') || null });
  }
  if (!entries.length) return null;
  entries.sort((x, y) => y.listeners - x.listeners);
  return { listeners: entries.reduce((s, e) => s + e.listeners, 0), entries, matched: entries.map((e) => `${e.artist} — ${e.name} (${e.listeners})`).join(' + ') };
}

export async function deezer(artists, album) {
  for (const artist of artists) {
    const u = `https://api.deezer.com/search/album?${new URLSearchParams({ q: `artist:"${artist}" album:"${album}"` })}`;
    const j = await (await fetch(u)).json();
    await sleep(250);
    const hit = (j.data || []).find((h) => artists.some((a) => norm(h.artist?.name).includes(norm(a)) || norm(a).includes(norm(h.artist?.name))));
    if (hit) {
      const a = await (await fetch(`https://api.deezer.com/album/${hit.id}`)).json();
      await sleep(250);
      return { fans: a.fans ?? null, cover: a.cover_xl || hit.cover_xl, matched: `${a.artist?.name} — ${a.title}`, url: a.link };
    }
  }
  return null;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: node --env-file=… reels/grade.mjs <slug> [--refresh]'); process.exit(1); }
  const refresh = process.argv.includes('--refresh');
  const dir = join(ROOT, 'work', slug);
  const pool = parseCsv(await readFile(join(dir, 'albums.csv'), 'utf8'));
  const autoPath = join(dir, 'auto.json');
  const auto = existsSync(autoPath) && !refresh ? JSON.parse(await readFile(autoPath, 'utf8')) : {};
  await mkdir(join(dir, 'assets'), { recursive: true });

  const graded = [];
  for (const [i, a] of pool.entries()) {
    const id = `${a.award_year}-${a.artist_en}-${a.album}`;
    if (!auto[id]) {
      const names = [a.artist_en, a.artist_ko, a.aliases].filter(Boolean);
      const variants = (a.album_search || a.album).split('|').map((x) => x.trim()).filter(Boolean);
      auto[id] = { lastfm: await lastfm(names, variants), deezer: await deezer([a.artist_en, a.artist_ko].filter(Boolean), variants[0]), fetched: new Date().toISOString().slice(0, 10) };
      await writeFile(autoPath, JSON.stringify(auto, null, 2));
    }
    const au = auto[id];
    const art = `assets/${String(i + 1).padStart(2, '0')}.jpg`;
    const coverUrl = au.deezer?.cover || au.lastfm?.entries?.find((e) => e.image)?.image;
    if (coverUrl && !existsSync(join(dir, art))) {
      const r = await fetch(coverUrl);
      if (r.ok) await writeFile(join(dir, art), Buffer.from(await r.arrayBuffer()));
    }
    const rym = num(a.rym), critic = num(a.aoty_critic), user = num(a.aoty_user), wins = num(a.kma_wins);
    const parts = {
      ratings: mean([rym != null ? rym * 20 : null, critic, user]),
      reach: mean([logScale(au.lastfm?.listeners, 1e1, 1e5)]),
      recognition: wins != null ? Math.min(100, 25 * wins) : null,
    };
    const used = Object.keys(W).filter((k) => parts[k] != null);
    const wsum = used.reduce((s, k) => s + W[k], 0);
    const grade = wsum ? used.reduce((s, k) => s + (W[k] / wsum) * parts[k], 0) : null;
    graded.push({
      artist: a.artist_ko, artist_en: a.artist_en, album: a.album, year: a.award_year,
      art: existsSync(join(dir, art)) ? art : null,
      inputs: { rym, aoty_critic: critic, aoty_user: user, kma_wins: wins, lastfm_listeners: au.lastfm?.listeners ?? null, deezer_fans: au.deezer?.fans ?? null },
      matched: { lastfm: au.lastfm ? `${au.lastfm.entries.length} entries, top: ${au.lastfm.entries[0].artist} — ${au.lastfm.entries[0].name}` : null, deezer: au.deezer?.matched ?? null },
      parts, grade, draft: used.length < 3,
    });
  }
  graded.sort((x, y) => (y.grade ?? -1) - (x.grade ?? -1));
  await writeFile(join(dir, 'graded.json'), JSON.stringify({ weights: W, generated: new Date().toISOString().slice(0, 10), albums: graded }, null, 2));

  const f = (v, d = 0) => (v == null ? '—' : v.toFixed(d));
  console.log('rank grade  ratings reach recog  lastfm   deezer  album  [matched last.fm | deezer]');
  graded.forEach((g, i) => console.log(`${String(i + 1).padStart(3)} ${f(g.grade, 1).padStart(5)}${g.draft ? '*' : ' '} ${f(g.parts.ratings).padStart(6)} ${f(g.parts.reach).padStart(5)} ${f(g.parts.recognition).padStart(5)} ${String(g.inputs.lastfm_listeners ?? '—').padStart(8)} ${String(g.inputs.deezer_fans ?? '—').padStart(7)}  ${g.artist} ${g.album}  [${g.matched.lastfm ?? 'NO MATCH'} | ${g.matched.deezer ?? 'NO MATCH'}]`));
  if (graded.some((g) => g.draft)) console.log('\n* draft: some parts missing (RYM/AOTY not entered yet, or no API match). Weights renormalised.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Bot persona definitions for the pre-launch population (HANDOFF-WINDOWS.md items 2–4).
 *
 * Design decisions (locked with the user 2026-07-05):
 *   • Taste skew: Korea-first — ~50% Korean personas, ~15% Japanese, ~35% Western/global.
 *   • Scale: ~150 bots total, ~80 ratings each (~12k ratings).
 *   • Reviews: not yet (ratings + follows first).
 *
 * Content bucketing (grounded in measured catalog composition, NOT genre tags alone):
 *   • Korean / Japanese content is selected by the primary artist's native_language (ko/ja) — the
 *     RELIABLE signal, since MusicBrainz barely tags Korean albums with korean-* genres (k-pop 0.8%,
 *     korean-indie/rb/rap ~0%). Pools: ~2,249 KR + ~5,528 JP album/EPs.
 *   • Western/global personas select by genre tags (well-populated for Western: pop/hip-hop/jazz…).
 *   • Within a Korean persona, an optional `genreSubFilter` narrows by any generic tag that IS present
 *     (e.g. a Korean rapper's album tagged "hip hop"); if too few match, it falls back to the whole
 *     origin pool. So Korean personas differ mainly by harshness + prestige, not by a Korean sub-genre
 *     the data can't distinguish.
 *
 * Scores are on the app's half-star scale (0.5–5.0). `harshness` is {mean, sd} of a clamped normal;
 * a "critic" has real spread (some 3s), a "stan" clusters high. `prestigeAffinity` (0–1) biases
 * sampling toward prestige_score-bearing canon (only ~1,589 RGs, so it's a small canon lever).
 */

export type OriginBucket = 'ko' | 'ja' | 'western';

export interface Persona {
  key: string;
  name: string;                 // human label (not shown to users)
  count: number;                // how many bot accounts of this persona
  bucket: OriginBucket;         // ko/ja → sample by artist origin; western → by genre tags
  genreFilters?: string[];      // western: genre-tag substrings to match on release_groups.genres
  genreSubFilter?: string[];    // ko/ja: optional narrowing within the origin pool (soft — falls back)
  prestigeAffinity: number;     // 0–1: probability a given pick is drawn from the prestige canon
  harshness: { mean: number; sd: number }; // half-star score distribution
  handleBank: string[];         // word bank for believable usernames/display names
}

// ── Korean (~76 bots) ─────────────────────────────────────────────────────────
const KO: Persona[] = [
  { key: 'kpop-stan', name: 'K-Pop Stan', count: 22, bucket: 'ko',
    prestigeAffinity: 0.10, harshness: { mean: 4.4, sd: 0.45 },
    handleBank: ['bias', 'comeback', 'lightstick', 'fancafe', 'stan', 'ult', 'era', 'title', 'bbcore', 'idol'] },
  { key: 'kindie-head', name: 'K-Indie / Ballad Head', count: 16, bucket: 'ko', genreSubFilter: ['indie', 'folk', 'ballad', 'rock', 'acoustic'],
    prestigeAffinity: 0.35, harshness: { mean: 3.9, sd: 0.7 },
    handleBank: ['hongdae', 'quietstorm', 'cassette', 'reverb', 'latenight', 'seoulfm', 'analog', 'moodlit'] },
  { key: 'khiphop-head', name: 'K-Hip-Hop Head', count: 14, bucket: 'ko', genreSubFilter: ['hip hop', 'hip-hop', 'rap', 'r&b'],
    prestigeAffinity: 0.30, harshness: { mean: 3.9, sd: 0.75 },
    handleBank: ['showme', 'cypher', '808', 'punchline', 'aomg', 'khh', 'bars', 'flow', 'boombap'] },
  { key: 'krnb-head', name: 'K-R&B Head', count: 10, bucket: 'ko', genreSubFilter: ['r&b', 'soul', 'neo'],
    prestigeAffinity: 0.35, harshness: { mean: 4.0, sd: 0.65 },
    handleBank: ['velvet', 'silk', 'slow', 'groove', 'nightdrive', 'smooth', 'afterhours'] },
  { key: 'kcritic', name: 'K-Scene Critic', count: 14, bucket: 'ko',
    prestigeAffinity: 0.70, harshness: { mean: 3.5, sd: 0.95 },
    handleBank: ['sidebar', 'ledger', 'annotated', 'liner', 'weekly', 'discourse', 'rated', 'archivist'] },
];

// ── Japanese (~22 bots) ───────────────────────────────────────────────────────
const JA: Persona[] = [
  { key: 'jpop-citypop', name: 'J-Pop / City Pop', count: 12, bucket: 'ja', genreSubFilter: ['city pop', 'pop', 'funk', 'disco'],
    prestigeAffinity: 0.25, harshness: { mean: 4.1, sd: 0.6 },
    handleBank: ['citylights', 'plastic', 'mariya', 'tokyonight', 'neon', 'sealevel', 'cruising', 'showa'] },
  { key: 'jrock-head', name: 'J-Rock Head', count: 10, bucket: 'ja', genreSubFilter: ['rock', 'metal', 'punk', 'alternative'],
    prestigeAffinity: 0.30, harshness: { mean: 3.9, sd: 0.7 },
    handleBank: ['visualkei', 'oricon', 'livehouse', 'distortion', 'budokan', 'riff', 'amp'] },
];

// ── Western / global (~52 bots) ───────────────────────────────────────────────
const WEST: Persona[] = [
  { key: 'hiphop-head', name: 'Hip-Hop Head', count: 12, bucket: 'western', genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap'],
    prestigeAffinity: 0.45, harshness: { mean: 3.8, sd: 0.85 },
    handleBank: ['crates', 'sample', 'goldenera', 'mixtape', 'vinyl', 'backpack', 'boombap', 'wax'] },
  { key: 'indie-alt-head', name: 'Indie / Alt Head', count: 12, bucket: 'western', genreFilters: ['indie rock', 'indie pop', 'alternative', 'shoegaze', 'dream pop', 'post-rock', 'bedroom pop'],
    prestigeAffinity: 0.40, harshness: { mean: 3.9, sd: 0.8 },
    handleBank: ['pitchfork', 'jangle', 'fuzz', 'basement', 'cassette', 'diy', 'lofi', 'haze'] },
  { key: 'jazz-classical', name: 'Jazz / Classical Completionist', count: 8, bucket: 'western', genreFilters: ['jazz', 'jazz fusion', 'classical'],
    prestigeAffinity: 0.85, harshness: { mean: 3.8, sd: 0.8 },
    handleBank: ['bluenote', 'ecm', 'modal', 'quartet', 'nocturne', 'deutsche', 'reissue', 'mono'] },
  { key: 'electronic-head', name: 'Electronic Head', count: 8, bucket: 'western', genreFilters: ['electronic', 'house', 'techno', 'ambient', 'lo-fi'],
    prestigeAffinity: 0.45, harshness: { mean: 3.9, sd: 0.75 },
    handleBank: ['warp', 'fourfour', 'modular', 'afterdark', 'bpm', 'resident', 'dubplate', 'aphex'] },
  { key: 'rock-canon', name: 'Rock Canon', count: 8, bucket: 'western', genreFilters: ['classic rock', 'hard rock', 'metal', 'heavy metal', 'punk', 'post-punk'],
    prestigeAffinity: 0.55, harshness: { mean: 3.9, sd: 0.85 },
    handleBank: ['sideone', 'gatefold', 'rolling', 'riff', 'stackamps', 'setlist', 'bootleg'] },
  { key: 'rnb-soul-head', name: 'R&B / Soul Head', count: 4, bucket: 'western', genreFilters: ['r&b', 'soul', 'neo-soul', 'funk', 'disco'],
    prestigeAffinity: 0.45, harshness: { mean: 4.0, sd: 0.7 },
    handleBank: ['motown', 'stax', 'quietstorm', 'grooveline', 'velour', 'midnight'] },
];

export const PERSONAS: Persona[] = [...KO, ...JA, ...WEST];

export const TOTAL_BOTS = PERSONAS.reduce((n, p) => n + p.count, 0); // 150

// Deterministic-ish handle generator (no Math.random at import time; caller passes an index-seeded rng).
const SUFFIXES = ['', '_', 'x', 'xo', '__', '01', '99', '00', '_kr', '_fm', 'hq', 'tapes', 'wav', 'zone'];
const PREFIXES = ['', 'the', 'dj', 'lil', 'mr', 'ms', 'yr', 'real'];
export function makeHandle(p: Persona, rng: () => number): string {
  const w = p.handleBank[Math.floor(rng() * p.handleBank.length)];
  const pre = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const suf = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  const num = rng() < 0.35 ? String(Math.floor(rng() * 900 + 10)) : '';
  return [pre, w].filter(Boolean).join('') + suf + num;
}

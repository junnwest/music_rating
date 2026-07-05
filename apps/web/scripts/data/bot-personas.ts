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

// ── Identity generation — real given names by country, varied structures, human display names ─────
// Goal: bots should NOT read as bots. Most handles are just a real first name (sometimes + a
// birth-year-ish number or a word); only occasionally a subtle music word from the persona's bank.
// Given-name banks are romanized and matched to the bot's assigned country.
const KO_NAMES = ['jiwoo', 'seoyeon', 'minho', 'hyejin', 'jaehyun', 'yuna', 'doyoung', 'soyeon', 'hyunwoo', 'jieun', 'nari', 'seojin', 'minji', 'jihoon', 'eunbi', 'dahye', 'woojin', 'yerim', 'subin', 'jinwoo', 'sora', 'haeun', 'junho', 'yeji', 'minseo', 'chanwoo', 'soobin', 'hyewon', 'jimin', 'taeyang'];
const JA_NAMES = ['yuki', 'haruto', 'rin', 'aoi', 'ren', 'hina', 'kaito', 'mei', 'yuto', 'saki', 'riku', 'nao', 'akira', 'yui', 'sho', 'mio', 'kenta', 'emi', 'takumi', 'hikari', 'kana', 'daiki', 'miku', 'ryo', 'ayaka', 'natsu', 'kou', 'sana'];
const WEST_NAMES = ['daniel', 'chloe', 'marcus', 'elena', 'liam', 'sofia', 'noah', 'mia', 'oliver', 'ava', 'ethan', 'zoe', 'lucas', 'emma', 'leo', 'ivy', 'sam', 'nora', 'theo', 'iris', 'max', 'june', 'eli', 'remy', 'cole', 'ruby', 'jonas', 'clara', 'miles', 'esme'];
// Handle-building vocab. Most usernames are word/aesthetic-based and UNRELATED to the display name —
// like real people, whose @handle is rarely their actual name.
const WORDS = ['moonlit', 'lowtide', 'papermoon', 'afterglow', 'seaglass', 'coastline', 'stillwater', 'foxglove', 'cloudline', 'nightswim', 'sodapop', 'driftwood', 'reverie', 'amberwave', 'mellowgold', 'paperbird', 'bluehour', 'goldenhour', 'slowbloom', 'velvetine'];
const ADJ = ['soft', 'slow', 'quiet', 'blue', 'pale', 'warm', 'dim', 'late', 'faded', 'golden', 'misty', 'hazy', 'velvet', 'lone', 'still', 'moody', 'muted', 'ghost', 'plush', 'wired'];
const NOUN = ['moon', 'tide', 'static', 'ember', 'fern', 'cove', 'drift', 'haze', 'echo', 'bloom', 'fog', 'dusk', 'harbor', 'signal', 'orbit', 'wren', 'otter', 'comet', 'maple', 'raccoon'];
const INTEREST = ['bside', 'noskips', 'tapedeck', 'deepcuts', 'wrongspeed', 'runout', 'needle', 'crackle', 'runtime', '4amradio', 'liner', 'gatefold'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = <T>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length)];
const yearNum = (r: () => number) => String(1994 + Math.floor(r() * 13)).slice(2); // '94'..'06'
const smallNum = (r: () => number) => String(Math.floor(r() * 89) + 10);            // 10..98

/** Believable {username, displayName}. The username is USUALLY not the person's name. */
export function makeIdentity(country: string, persona: Persona, r: () => number): { username: string; displayName: string } {
  const bank = country === 'KR' ? KO_NAMES : country === 'JP' ? JA_NAMES : WEST_NAMES;
  const name = pick(bank, r);            // the person's given name → drives the DISPLAY name
  const sep = () => (r() < 0.3 ? (r() < 0.5 ? '_' : '.') : '');
  const t = r();
  let username: string;
  // ~30% name-derived, ~70% word/aesthetic/interest — decoupled from the display name.
  if (t < 0.14)      username = name + (r() < 0.5 ? sep() + yearNum(r) : '');        // jinwoo / woojin_00
  else if (t < 0.20) username = name + pick(['k', 'j', 'h', 'm', 's', 'w'], r);      // oliverw
  else if (t < 0.42) username = pick(ADJ, r) + pick(NOUN, r);                        // bluetide, latehaze
  else if (t < 0.56) username = pick(NOUN, r) + sep() + smallNum(r);                 // static88, echo_12
  else if (t < 0.70) username = pick(WORDS, r) + (r() < 0.35 ? sep() + smallNum(r) : ''); // moonlit, lowtide_88
  else if (t < 0.80) username = pick(NOUN, r) + pick(NOUN, r);                        // moontide, embercove
  else if (t < 0.90) username = (r() < 0.5 ? pick(INTEREST, r) : pick(persona.handleBank, r)); // bside / subtle flavor
  else               username = pick(ADJ, r) + pick(NOUN, r) + (r() < 0.4 ? smallNum(r) : ''); // bluetide07
  username = username.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20);
  // Display name is the actual person: cased given name (mostly), sometimes lowercase, rarely a word.
  const displayName = r() < 0.74 ? cap(name) : (r() < 0.6 ? name : cap(pick(WORDS, r)));
  return { username, displayName };
}

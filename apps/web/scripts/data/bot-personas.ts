/**
 * Bot persona definitions for the pre-launch population (HANDOFF-WINDOWS.md items 2–4).
 *
 * Design (locked + revised with the user 2026-07-05):
 *   • Audience = MINOR / ANTI-COMMERCIAL taste (serious/underground listeners), Korea-first. So the
 *     population skews indie/underground; mainstream K-pop is a SMALL minority (kpop-stan = 6 of 150).
 *   • Scale ~150 bots, ~80 ratings each. Reviews not yet (ratings + follows first).
 *
 * Content bucketing (grounded in catalog composition; genre tags are ~absent for Korean):
 *   • Korean / Japanese content by primary-artist native_language (ko/ja) — the reliable signal.
 *   • Western/global personas by genre tags (well-populated for Western).
 *   • `mainstream` personas embrace commercial hits (weight Korean sampling by prestige = chart
 *     success). Anti-commercial personas do the opposite — they PENALIZE prestige on Korean albums
 *     (Korean prestige_score reflects commercial success, not the underground taste we want) and
 *     spread across the indie catalog. Western prestige = critical acclaim, kept for everyone.
 */

export type OriginBucket = 'ko' | 'ja' | 'western';

export interface Persona {
  key: string;
  name: string;
  count: number;
  bucket: OriginBucket;
  genreFilters?: string[];
  genreSubFilter?: string[];
  mainstream?: boolean;         // embraces commercial hits (kpop-stan); default false = anti-commercial
  prestigeAffinity: number;
  harshness: { mean: number; sd: number };
  handleBank: string[];
}

// ── Korean (~72 bots) — indie/underground dominant, mainstream K-pop tiny ──────
const KO: Persona[] = [
  { key: 'kpop-stan', name: 'K-Pop Stan', count: 6, bucket: 'ko', mainstream: true,
    prestigeAffinity: 0.10, harshness: { mean: 4.3, sd: 0.5 },
    handleBank: ['bias', 'comeback', 'era', 'title', 'idol', 'ult'] },
  { key: 'kindie-head', name: 'K-Indie / Ballad Head', count: 22, bucket: 'ko', genreSubFilter: ['indie', 'folk', 'ballad', 'rock', 'acoustic'],
    prestigeAffinity: 0.30, harshness: { mean: 3.8, sd: 0.75 },
    handleBank: ['hongdae', 'quietstorm', 'cassette', 'reverb', 'latenight', 'analog', 'moodlit'] },
  { key: 'khiphop-head', name: 'K-Hip-Hop Head (underground)', count: 18, bucket: 'ko', genreSubFilter: ['hip hop', 'hip-hop', 'rap', 'r&b'],
    prestigeAffinity: 0.25, harshness: { mean: 3.8, sd: 0.8 },
    handleBank: ['cypher', '808', 'punchline', 'khh', 'bars', 'boombap', 'daytime'] },
  { key: 'krnb-head', name: 'K-R&B Head', count: 12, bucket: 'ko', genreSubFilter: ['r&b', 'soul', 'neo'],
    prestigeAffinity: 0.30, harshness: { mean: 3.9, sd: 0.7 },
    handleBank: ['velvet', 'silk', 'slow', 'groove', 'nightdrive', 'afterhours'] },
  { key: 'kcritic', name: 'K-Scene Critic', count: 14, bucket: 'ko',
    prestigeAffinity: 0.35, harshness: { mean: 3.4, sd: 0.95 },
    handleBank: ['sidebar', 'ledger', 'annotated', 'liner', 'discourse', 'archivist'] },
];

// ── Japanese (~22 bots) — city-pop cult + J-rock, not commercial J-pop ─────────
const JA: Persona[] = [
  { key: 'jpop-citypop', name: 'City Pop / J cult', count: 10, bucket: 'ja', genreSubFilter: ['city pop', 'funk', 'disco', 'pop'],
    prestigeAffinity: 0.25, harshness: { mean: 3.9, sd: 0.65 },
    handleBank: ['citylights', 'plastic', 'tokyonight', 'sealevel', 'cruising', 'showa'] },
  { key: 'jrock-head', name: 'J-Rock Head', count: 12, bucket: 'ja', genreSubFilter: ['rock', 'metal', 'punk', 'alternative'],
    prestigeAffinity: 0.30, harshness: { mean: 3.8, sd: 0.75 },
    handleBank: ['livehouse', 'distortion', 'budokan', 'riff', 'amp', 'noise'] },
];

// ── Western / global (~56 bots) — indie/underground heavy ──────────────────────
const WEST: Persona[] = [
  { key: 'hiphop-head', name: 'Hip-Hop Head (backpack)', count: 12, bucket: 'western', genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap'],
    prestigeAffinity: 0.45, harshness: { mean: 3.7, sd: 0.85 },
    handleBank: ['crates', 'sample', 'goldenera', 'backpack', 'boombap', 'wax'] },
  { key: 'indie-alt-head', name: 'Indie / Alt / Shoegaze Head', count: 18, bucket: 'western', genreFilters: ['indie rock', 'indie pop', 'alternative', 'shoegaze', 'dream pop', 'post-rock', 'bedroom pop', 'math rock'],
    prestigeAffinity: 0.40, harshness: { mean: 3.8, sd: 0.8 },
    handleBank: ['jangle', 'fuzz', 'basement', 'diy', 'lofi', 'haze', 'reverb'] },
  { key: 'jazz-classical', name: 'Jazz / Classical Completionist', count: 8, bucket: 'western', genreFilters: ['jazz', 'jazz fusion', 'classical'],
    prestigeAffinity: 0.85, harshness: { mean: 3.7, sd: 0.8 },
    handleBank: ['bluenote', 'ecm', 'modal', 'quartet', 'reissue', 'mono'] },
  { key: 'electronic-head', name: 'Electronic / Experimental', count: 8, bucket: 'western', genreFilters: ['electronic', 'house', 'techno', 'ambient', 'lo-fi'],
    prestigeAffinity: 0.45, harshness: { mean: 3.8, sd: 0.75 },
    handleBank: ['warp', 'modular', 'afterdark', 'resident', 'dubplate', 'idm'] },
  { key: 'rock-canon', name: 'Rock Canon', count: 6, bucket: 'western', genreFilters: ['classic rock', 'hard rock', 'metal', 'heavy metal', 'punk', 'post-punk'],
    prestigeAffinity: 0.55, harshness: { mean: 3.8, sd: 0.85 },
    handleBank: ['gatefold', 'riff', 'setlist', 'bootleg', 'sideone'] },
  { key: 'rnb-soul-head', name: 'R&B / Soul Head', count: 4, bucket: 'western', genreFilters: ['r&b', 'soul', 'neo-soul', 'funk', 'disco'],
    prestigeAffinity: 0.45, harshness: { mean: 3.9, sd: 0.7 },
    handleBank: ['motown', 'stax', 'quietstorm', 'grooveline', 'midnight'] },
];

export const PERSONAS: Persona[] = [...KO, ...JA, ...WEST];
export const TOTAL_BOTS = PERSONAS.reduce((n, p) => n + p.count, 0); // 150

// ── Identity — native-script display names, Latin/aesthetic handles (mostly non-name) ─────────────
// Korean/Japanese users show a NATIVE-SCRIPT display name (민서 / ゆき), not romanized — but their
// @handle is usually Latin/aesthetic, unrelated to their name. Name banks are paired {r: romanized
// (for name-based handles), n: native script (for the display name)}.
type Named = { r: string; n: string };
const KO_NAMES: Named[] = [
  { r: 'jiwoo', n: '지우' }, { r: 'seoyeon', n: '서연' }, { r: 'minho', n: '민호' }, { r: 'hyejin', n: '혜진' }, { r: 'jaehyun', n: '재현' }, { r: 'yuna', n: '유나' }, { r: 'doyoung', n: '도영' }, { r: 'soyeon', n: '소연' }, { r: 'hyunwoo', n: '현우' }, { r: 'jieun', n: '지은' }, { r: 'nari', n: '나리' }, { r: 'seojin', n: '서진' }, { r: 'minji', n: '민지' }, { r: 'jihoon', n: '지훈' }, { r: 'eunbi', n: '은비' }, { r: 'dahye', n: '다혜' }, { r: 'woojin', n: '우진' }, { r: 'yerim', n: '예림' }, { r: 'subin', n: '수빈' }, { r: 'jinwoo', n: '진우' }, { r: 'sora', n: '소라' }, { r: 'haeun', n: '하은' }, { r: 'junho', n: '준호' }, { r: 'yeji', n: '예지' }, { r: 'minseo', n: '민서' }, { r: 'chanwoo', n: '찬우' }, { r: 'hyewon', n: '혜원' }, { r: 'jimin', n: '지민' },
];
const JA_NAMES: Named[] = [
  { r: 'yuki', n: 'ゆき' }, { r: 'haruto', n: 'はると' }, { r: 'rin', n: 'りん' }, { r: 'aoi', n: 'あおい' }, { r: 'ren', n: 'れん' }, { r: 'hina', n: 'ひな' }, { r: 'kaito', n: 'かいと' }, { r: 'mei', n: 'めい' }, { r: 'yuto', n: 'ゆうと' }, { r: 'saki', n: 'さき' }, { r: 'riku', n: 'りく' }, { r: 'nao', n: 'なお' }, { r: 'akira', n: 'あきら' }, { r: 'yui', n: 'ゆい' }, { r: 'sho', n: 'しょう' }, { r: 'mio', n: 'みお' }, { r: 'kenta', n: 'けんた' }, { r: 'emi', n: 'えみ' }, { r: 'takumi', n: 'たくみ' }, { r: 'hikari', n: 'ひかり' }, { r: 'kana', n: 'かな' }, { r: 'miku', n: 'みく' }, { r: 'ryo', n: 'りょう' }, { r: 'ayaka', n: 'あやか' }, { r: 'natsu', n: 'なつ' }, { r: 'sana', n: 'さな' },
];
const WEST_NAMES: Named[] = ['daniel', 'chloe', 'marcus', 'elena', 'liam', 'sofia', 'noah', 'mia', 'oliver', 'ava', 'ethan', 'zoe', 'lucas', 'emma', 'leo', 'ivy', 'sam', 'nora', 'theo', 'iris', 'max', 'june', 'eli', 'remy', 'cole', 'ruby', 'jonas', 'clara', 'miles', 'esme'].map(r => ({ r, n: r }));

const WORDS = ['moonlit', 'lowtide', 'papermoon', 'afterglow', 'seaglass', 'coastline', 'stillwater', 'foxglove', 'cloudline', 'nightswim', 'sodapop', 'driftwood', 'reverie', 'amberwave', 'mellowgold', 'paperbird', 'bluehour', 'goldenhour', 'slowbloom', 'velvetine'];
const ADJ = ['soft', 'slow', 'quiet', 'blue', 'pale', 'warm', 'dim', 'late', 'faded', 'golden', 'misty', 'hazy', 'velvet', 'lone', 'still', 'moody', 'muted', 'ghost', 'plush', 'wired'];
const NOUN = ['moon', 'tide', 'static', 'ember', 'fern', 'cove', 'drift', 'haze', 'echo', 'bloom', 'fog', 'dusk', 'harbor', 'signal', 'orbit', 'wren', 'otter', 'comet', 'maple', 'raccoon'];
const INTEREST = ['bside', 'noskips', 'tapedeck', 'deepcuts', 'wrongspeed', 'runout', 'needle', 'crackle', 'runtime', '4amradio', 'liner', 'gatefold'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = <T>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length)];
const yearNum = (r: () => number) => String(1994 + Math.floor(r() * 13)).slice(2);
const smallNum = (r: () => number) => String(Math.floor(r() * 89) + 10);

/** Believable {username (Latin, usually not the name), displayName (native script for KO/JA)}. */
export function makeIdentity(country: string, persona: Persona, r: () => number): { username: string; displayName: string } {
  const bank = country === 'KR' ? KO_NAMES : country === 'JP' ? JA_NAMES : WEST_NAMES;
  const person = pick(bank, r);       // {r: romanized, n: native script}
  const name = person.r;
  const sep = () => (r() < 0.3 ? (r() < 0.5 ? '_' : '.') : '');
  const t = r();
  let username: string;
  if (t < 0.14)      username = name + (r() < 0.5 ? sep() + yearNum(r) : '');
  else if (t < 0.20) username = name + pick(['k', 'j', 'h', 'm', 's', 'w'], r);
  else if (t < 0.42) username = pick(ADJ, r) + pick(NOUN, r);
  else if (t < 0.56) username = pick(NOUN, r) + sep() + smallNum(r);
  else if (t < 0.70) username = pick(WORDS, r) + (r() < 0.35 ? sep() + smallNum(r) : '');
  else if (t < 0.80) username = pick(NOUN, r) + pick(NOUN, r);
  else if (t < 0.90) username = (r() < 0.5 ? pick(INTEREST, r) : pick(persona.handleBank, r));
  else               username = pick(ADJ, r) + pick(NOUN, r) + (r() < 0.4 ? smallNum(r) : '');
  username = username.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20);
  // Display name = the person, in their native script (Hangul/Kana for KR/JP), cased for Western.
  const displayName = r() < 0.86 ? (country === 'KR' || country === 'JP' ? person.n : cap(name))
                                 : cap(pick(WORDS, r));
  return { username, displayName };
}

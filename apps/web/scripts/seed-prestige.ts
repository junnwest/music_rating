/**
 * Seed prestige scores and genre tags for canonical albums.
 *
 * For each entry in CANONICAL_ALBUMS, Spotify-searches for the album,
 * upserts it into the `releases` table, and sets `prestige` + `genres`.
 *
 * Run:
 *   npm run seed:prestige
 * Add --dry-run to preview without writing to DB.
 *
 * Search strategy per album:
 *   1. Free-text: "${artist} ${album}"
 *   2. If nativeQuery provided and step 1 fails: "${nativeQuery}"
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { assertSpotifyCircuitClosed, recordSpotify429 } from './spotify-circuit';

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1200;
const STATE_PATH = path.resolve('scripts/seed-prestige-state.json');
const MATCH_THRESHOLD = 0.45;

// ── Similarity scoring ────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Jaccard-only for artists — no substring bonus to prevent "The Beatles" from
// matching "The Beatles Complete On Ukulele" with a 0.85 artist score.
function artistSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchScore(
  expectedTitle: string, actualTitle: string,
  expectedArtist: string, actualArtist: string,
): number {
  const titleScore  = stringSimilarity(expectedTitle, actualTitle);
  const artistScore = artistSimilarity(expectedArtist, actualArtist);
  if (artistScore < 0.25) return 0;
  return titleScore * 0.75 + artistScore * 0.25;
}

// Similarity that works on raw strings — handles Korean/Japanese without stripping
function rawSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1.0;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  return stringSimilarity(a, b);
}

function loadState(): Set<string> {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveState(done: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify([...done]), 'utf8');
}

// ── Canonical album list ──────────────────────────────────────────────────────
// Format: [artistQuery, albumQuery, prestige, genres, nativeQuery?, spotifyId?]
//   artistQuery / albumQuery : used for primary free-text search
//   nativeQuery              : fallback for albums where Korean/Japanese script
//                              yields better Spotify results than romanized text
//   spotifyId                : skip search entirely — use this when search fails consistently
// genres: comma-separated lowercase tags matching lib/canon-suggestions GENRE_KEYWORD_MAP
// Prestige: 1=Undisputed classic | 2=Critically acclaimed | 3=Notable

const CANONICAL_ALBUMS: [string, string, 1 | 2 | 3, string, string?, string?][] = [
  // ── KOREAN — Prestige 1 ────────────────────────────────────────────────────
  ['Seo Taiji and Boys', '서태지와 아이들', 1, 'k-pop, hip-hop, rock, dance pop', '서태지와 아이들 1집'],
  ['Seo Taiji and Boys', 'Seo Taiji and Boys IV', 1, 'rock, alternative rock, k-pop, hip-hop', '서태지와 아이들 하여가'],
  ['Kim Kwang-seok', '다시 부르기', 1, 'folk, ballad, singer-songwriter', '김광석 다시 부르기'],
  ['Kim Kwang-seok', '4집', 1, 'folk, ballad, singer-songwriter', '김광석 4집'],
  ['Han Dae-soo', '멀고 먼 길', 1, 'folk, psychedelic folk, singer-songwriter', '한대수 멀고 먼 길'],
  ['Kim Min-ki', '김민기', 1, 'folk, protest folk, singer-songwriter', '김민기 1집'],
  ['Deulgukhwa', '들국화 1집', 1, 'rock, folk rock', '들국화 1집'],
  ['Sinawe', '시나위 1집', 1, 'heavy metal, hard rock', '시나위 1집'],
  ['Boohwal', '부활 2집', 1, 'rock, hard rock, ballad', '부활 2집'],
  ['Yoo Jae-ha', '사랑하기 때문에', 1, 'r&b, soul, ballad, k-r&b', '유재하 사랑하기 때문에'],
  ['Sanullim', '아니 벌써', 1, 'rock, psychedelic rock', '산울림 아니 벌써'],
  ['Garion', '가리온 1집', 1, 'hip-hop, k-rap, boom bap', '가리온 1집'],
  ['Garion', '가리온 2집', 1, 'hip-hop, k-rap', '가리온 2집'],
  ['Epik High', 'Remapping the Human Soul', 1, 'hip-hop, alternative hip-hop, k-rap', '에픽하이 Remapping the Human Soul'],
  ['Epik High', 'Map the Soul', 1, 'hip-hop, alternative hip-hop, k-rap', '에픽하이 Map the Soul'],
  ['E SENS', 'The Anecdote', 1, 'hip-hop, k-rap'],
  ['Lee Juck', '나무로 된 노래들', 1, 'pop, singer-songwriter, indie pop', '이적 나무로 된 노래들'],
  ['Toy', '7집', 1, 'pop, r&b, soul, k-r&b', '토이 7집'],
  ['Lee So-ra', '7집', 1, 'pop, ballad, k-r&b', '이소라 7집'],
  ['Clazziquai Project', 'Instant Pig', 1, 'electronic, nu-jazz, indie pop'],
  ['Kiha & The Faces', '장기하와 얼굴들', 1, 'indie rock, art rock, k-indie', '장기하와 얼굴들 1집'],
  ['Kiha & The Faces', '키하 & 더 페이스스', 1, 'indie rock, k-indie', '장기하와 얼굴들 3집'],
  ['Lang Lee', '늑대가 나타났다', 1, 'folk, indie folk, singer-songwriter, k-indie', '이랑 늑대가 나타났다'],
  ['Hyukoh', '22', 1, 'indie rock, art rock, k-indie', '혁오 22'],
  ['Hyukoh', '23', 1, 'indie rock, art rock, k-indie', '혁오 23'],
  ['Silica Gel', 'Machine Boy', 1, 'indie rock, experimental rock, k-indie', '실리카겔 Machine Boy'],
  ['NewJeans', 'NewJeans', 1, 'k-pop, r&b pop, dance pop', '뉴진스 NewJeans'],
  ['NewJeans', 'Get Up', 1, 'k-pop, r&b pop, dance pop'],
  ['BTS', "Love Yourself 轉 'Tear'", 1, 'k-pop, hip-hop, r&b pop'],
  ['BTS', 'Map of the Soul: 7', 1, 'k-pop, pop'],
  ['IU', 'Palette', 1, 'pop, indie pop, k-pop'],
  ['IU', 'Lilac', 1, 'pop, indie pop, k-pop'],
  ['Baek Yerin', 'Every Letter I Sent You.', 1, 'pop, indie pop, r&b, k-r&b', '백예린 Every Letter I Sent You'],
  ['Jeong Milla', '청파소나타', 1, 'pop, singer-songwriter, k-indie', '정밀아 청파소나타'],
  ['Sunwoo Jung-a', "It's Okay Dear", 1, 'pop, jazz pop, k-r&b', '선우정아 It\'s Okay Dear'],
  ['Cho Yong-pil', '1집', 1, 'pop, ballad, rock', '조용필 1집'],
  ['Kim Hyun-sik', '사랑했어요', 1, 'ballad, pop, rock', '김현식 사랑했어요'],
  ['Shin Hae-chul', '1집', 1, 'pop, rock, synth-pop', '신해철 1집'],
  ['H.O.T.', '우리가 남이가', 1, 'k-pop, idol pop, dance pop', 'HOT 우리가 남이가'],
  ['Big Bang', 'Made', 1, 'k-pop, hip-hop, electronic', '빅뱅 Made'],
  ['Beenzino', 'Nowitzki', 1, 'hip-hop, r&b, k-rap'],
  ['250', '뽕', 1, 'electronic, experimental, hip-hop, k-rap', '250 뽕'],
  ['Leenalchi', '수궁가', 1, 'alternative pop, folk fusion, pansori', '이날치 수궁가'],
  ['Kang Tae-gu', 'bleu', 1, 'r&b, neo-soul, k-r&b', '강태구 bleu'],
  ['Oh Hyuk', '나무의 말', 1, 'pop, singer-songwriter, folk', '오혁 나무의 말'],
  ['Jang Pill-soon', '소니 에잇', 1, 'folk, singer-songwriter, k-indie', '장필순 소니 에잇'],
  ['Mid-Air Thief', 'Crumbling', 1, 'psychedelic folk, folktronica, indie pop, k-indie'],

  // ── KOREAN — Prestige 2 ────────────────────────────────────────────────────
  ['Light and Salt', '샴푸의 요정', 2, 'city pop, jazz pop, pop', '빛과 소금 샴푸의 요정'],
  ['Jaurim', '1집', 2, 'rock, alternative rock, k-indie', '자우림 1집'],
  ['Jaurim', 'Magic Carpet Ride', 2, 'rock, art rock, k-indie', '자우림 Magic Carpet Ride'],
  ['Jannabi', '전설', 2, 'indie rock, retro pop, k-indie', '잔나비 전설'],
  ['AKMU', 'Play', 2, 'pop, folk pop, indie pop, k-pop'],
  ['Se So Neon', 'Nonadaptation', 2, 'indie rock, art rock, shoegaze, k-indie', '새소년 Nonadaptation'],
  ['Nell', 'Separation Anxiety', 2, 'post-rock, indie rock, k-indie'],
  ['The Black Skirts', 'THIRSTY', 2, 'indie rock, post-punk, k-indie', '검정치마 THIRSTY'],
  ['The Black Skirts', '201', 2, 'indie rock, k-indie', '검정치마 201'],
  ['Jambinai', 'ONDA', 2, 'post-rock, folk fusion, experimental rock', '잠비나이 ONDA'],
  ['Galaxy Express', 'Noise on Fire', 2, 'garage rock, hard rock, indie rock, k-indie', '갤럭시 익스프레스 Noise on Fire'],
  ['10cm', '1.0', 2, 'indie pop, folk pop, k-indie'],
  ['BIBI', 'The Lowlife Princess: Noir', 2, 'pop, r&b, hip-hop, k-r&b', 'BIBI The Lowlife Princess Noir'],
  ['Beenzino', '24:26', 2, 'hip-hop, r&b, k-rap', '빈지노 24:26'],
  ['Dynamic Duo', 'Enlightened', 2, 'hip-hop, k-rap', '다이나믹 듀오 Enlightened'],
  ['Verbal Jint', 'Modern Rhymes', 2, 'hip-hop, k-rap', '버벌진트 Modern Rhymes'],
  ['SHINee', 'Odd', 2, 'k-pop, r&b pop, electronic'],
  ['Girls Generation', 'The Boys', 2, 'k-pop, pop, dance pop', '소녀시대 The Boys'],
  ['2NE1', 'To Anyone', 2, 'k-pop, hip-hop, r&b, dance pop'],
  ['aespa', 'Armageddon', 2, 'k-pop, hyperpop, dance pop'],
  ['god', '4집', 2, 'k-pop, pop, idol pop', 'god 4집'],
  ['S.E.S.', '1집', 2, 'k-pop, r&b pop, idol pop', 'S.E.S. 1집'],
  ['Brown Eyes', 'Brown Eyes', 2, 'r&b, ballad, k-r&b', '브라운 아이즈 1집'],
  ['Dean', '130 mood: TRBL', 2, 'r&b, alternative r&b, k-r&b'],
  ['Zion.T', 'Red Light', 2, 'r&b, neo-soul, hip-hop soul, k-r&b'],
  ['키라라', 'KIRARA', 2, 'electronic, ambient, k-indie', '키라라 KIRARA'],
  ['Lee Seung-yoon', '역성', 2, 'rock, folk rock', '이승윤 역성'],

  // ── JAPANESE — Prestige 1 ──────────────────────────────────────────────────
  ['Happy End', 'Kazemachi Roman', 1, 'folk rock, psychedelic, j-rock', 'はっぴいえんど 風街ろまん'],
  ['Yellow Magic Orchestra', 'Solid State Survivor', 1, 'electronic, synth-pop, j-pop'],
  ['Eiichi Ohtaki', 'A Long Vacation', 1, 'city pop, soft rock, pop', '大滝詠一 A Long Vacation'],
  ['Tatsuro Yamashita', 'For You', 1, 'city pop, soft rock, r&b', '山下達郎 FOR YOU'],
  ['Tatsuro Yamashita', 'SPACY', 1, 'city pop, funk, soul', '山下達郎 SPACY'],
  ['Mariya Takeuchi', 'Variety', 1, 'city pop, pop, soft rock', '竹内まりや Variety'],
  ['RC Succession', 'Rhapsody', 1, 'rock, blues rock, j-rock', 'RCサクセション Rhapsody'],
  ['Fishmans', '空中キャンプ', 1, 'dub, alternative rock, dream pop, j-rock', 'フィッシュマンズ 空中キャンプ'],
  ['Fishmans', '宇宙 日本 世田谷', 1, 'dub, alternative rock, dream pop, j-rock', 'フィッシュマンズ 宇宙 日本 世田谷'],
  ['The Blue Hearts', 'The Blue Hearts', 1, 'punk rock, pop-punk, j-rock', 'THE BLUE HEARTS 1st'],
  ['Cornelius', 'Fantasma', 1, 'shibuya-kei, art pop, indie pop, j-pop'],
  ['Sadistic Mika Band', 'Kurofune', 1, 'progressive rock, glam rock, j-rock', 'Sadistic Mika Band 黒船'],
  ['Yumi Arai', 'Hikoki-Gumo', 1, 'folk pop, soft rock, singer-songwriter, j-pop', '荒井由実 ひこうき雲'],
  ['X Japan', 'Blue Blood', 1, 'visual kei, heavy metal, j-rock', 'X JAPAN Blue Blood'],
  ['Sheena Ringo', 'Shouso Strip', 1, 'art rock, alternative rock, j-rock, j-pop', '椎名林檎 勝訴ストリップ'],
  ['Sheena Ringo', 'Muzai Moratorium', 1, 'art rock, alternative rock, j-rock, j-pop', '椎名林檎 無罪モラトリアム'],
  ['Hikaru Utada', 'First Love', 1, 'r&b, j-pop', '宇多田ヒカル First Love'],
  ['Haruomi Hosono', 'Hosono House', 1, 'folk rock, j-rock', '細野晴臣 HOSONO HOUSE'],
  ['Taeko Onuki', 'Sunshower', 1, 'city pop, jazz pop', '大貫妙子 SUNSHOWER'],
  ['Perfume', 'GAME', 1, 'electropop, electronic, j-pop'],
  ['Nujabes', 'Modal Soul', 1, 'jazz rap, hip-hop, jazz'],
  ['Boris', 'Pink', 1, 'noise rock, heavy metal, post-rock'],
  ['Boredoms', 'Vision Creation Newsun', 1, 'psychedelic rock, experimental, noise rock'],
  ['Number Girl', 'School Girl Distortional Addict', 1, 'indie rock, noise rock, j-rock', 'NUMBER GIRL School Girl Distortional Addict'],

  // ── JAPANESE — Prestige 2 ──────────────────────────────────────────────────
  ['Yellow Magic Orchestra', 'BGM', 2, 'electronic, ambient, j-pop'],
  ['Cornelius', 'Point', 2, 'electronic, art pop, j-pop'],
  ['Akiko Yano', 'Japanese Girl', 2, 'art pop, experimental, folk pop, j-pop', '矢野顕子 Japanese Girl'],
  ['RADWIMPS', '人間開花', 2, 'j-pop, rock, j-rock', 'RADWIMPS 人間開花'],
  ['Hikaru Utada', 'Fantome', 2, 'j-pop, art pop, electronic', '宇多田ヒカル Fantome'],
  ['Quruli', 'Waltz for Two People', 2, 'art rock, chamber pop, indie rock, j-rock', 'くるり ワルツを踊れ'],
  ['Sakanaction', '834.194', 2, 'synth-pop, indie rock, j-pop', 'サカナクション 834.194'],
  ['Kenshi Yonezu', 'BOOTLEG', 2, 'j-pop, art pop', '米津玄師 BOOTLEG'],
  ['Bump of Chicken', 'orbital period', 2, 'j-rock, alternative rock', 'BUMP OF CHICKEN orbital period'],
  ['Haruomi Hosono', 'Haraiso', 2, 'tropical, exotica, electronic, j-pop', '細野晴臣 はらいそ'],
  ['Anri', 'Timely!!', 2, 'city pop, boogie, funk, j-pop', 'ANRI Timely!!'],
  ['Miki Matsubara', 'Pocket Park', 2, 'city pop, jazz pop, j-pop', '松原みき Pocket Park'],
  ['Supercar', 'Three Out Change', 2, 'indie rock, shoegaze, j-rock'],

  // ── WESTERN — Prestige 1 ──────────────────────────────────────────────────
  ['Kendrick Lamar', 'To Pimp a Butterfly', 1, 'hip-hop, jazz rap, conscious rap'],
  ['Kendrick Lamar', 'good kid m.A.A.d city', 1, 'hip-hop, conscious rap'],
  ['Kanye West', 'My Beautiful Dark Twisted Fantasy', 1, 'hip-hop, art rap'],
  ['Jay-Z', 'The Blueprint', 1, 'hip-hop, east coast rap'],
  ['Nas', 'Illmatic', 1, 'hip-hop, east coast rap, boom bap'],
  ['OutKast', 'Speakerboxxx The Love Below', 1, 'hip-hop, funk, experimental'],
  ['The Notorious B.I.G.', 'Ready to Die', 1, 'hip-hop, east coast rap'],
  ['Madvillain', 'Madvillainy', 1, 'hip-hop, underground hip-hop, abstract hip-hop'],
  ['Wu-Tang Clan', 'Enter the Wu-Tang 36 Chambers', 1, 'hip-hop, east coast rap, hardcore rap'],
  ['A Tribe Called Quest', 'The Low End Theory', 1, 'hip-hop, jazz rap, alternative hip-hop'],
  ['Lauryn Hill', 'The Miseducation of Lauryn Hill', 1, 'r&b, hip-hop, soul, neo-soul'],
  ['Marvin Gaye', "What's Going On", 1, 'soul, funk, r&b'],
  ['Stevie Wonder', 'Songs in the Key of Life', 1, 'soul, r&b, funk'],
  ["D'Angelo", 'Voodoo', 1, 'neo-soul, r&b, funk'],
  ['Frank Ocean', 'Channel Orange', 1, 'r&b, neo-soul, art pop'],
  ['Beyonce', 'Lemonade', 1, 'r&b, pop, hip-hop'],
  ['Amy Winehouse', 'Back to Black', 1, 'soul, r&b, pop'],
  ['Radiohead', 'OK Computer', 1, 'alternative rock, art rock'],
  ['Radiohead', 'Kid A', 1, 'electronic, art rock, experimental rock'],
  ['Arcade Fire', 'Funeral', 1, 'indie rock, art rock, chamber pop'],
  ['The Strokes', 'Is This It', 1, 'indie rock, garage rock'],
  ['Pavement', 'Slanted and Enchanted', 1, 'indie rock, lo-fi'],
  ['The Smiths', 'The Queen Is Dead', 1, 'indie rock, post-punk'],
  ['Joy Division', 'Unknown Pleasures', 1, 'post-punk, gothic rock'],
  ['LCD Soundsystem', 'Sound of Silver', 1, 'dance-punk, electronic rock, indie rock'],
  ['Neutral Milk Hotel', 'In the Aeroplane Over the Sea', 1, 'indie folk, lo-fi, art rock'],
  ['Bob Dylan', 'Blood on the Tracks', 1, 'folk, folk rock, singer-songwriter'],
  ['Joni Mitchell', 'Blue', 1, 'folk, singer-songwriter'],
  ['Nick Drake', 'Pink Moon', 1, 'folk, acoustic'],
  ['Miles Davis', 'Kind of Blue', 1, 'jazz, modal jazz'],
  ['John Coltrane', 'A Love Supreme', 1, 'jazz, spiritual jazz'],
  ['Aphex Twin', 'Selected Ambient Works 85-92', 1, 'electronic, ambient techno, idm'],
  ['Daft Punk', 'Discovery', 1, 'electronic, french house, dance pop'],
  ['Boards of Canada', 'Music Has the Right to Children', 1, 'electronic, idm, ambient'],
  ['Massive Attack', 'Blue Lines', 1, 'trip-hop, electronic, r&b'],
  ['Portishead', 'Dummy', 1, 'trip-hop, electronic'],
  ['Godspeed You Black Emperor', 'Lift Your Skinny Fists Like Antennas to Heaven', 1, 'post-rock, experimental'],
  ['Slint', 'Spiderland', 1, 'post-rock, math rock'],
  ['My Bloody Valentine', 'Loveless', 1, 'shoegaze, alternative rock, dream pop'],
  ['Talk Talk', 'Spirit of Eden', 1, 'art rock, post-rock, ambient'],
  ['Nirvana', 'Nevermind', 1, 'grunge, alternative rock'],
  ['The Beatles', 'Abbey Road', 1, 'rock, art rock, pop'],
  ['Fleetwood Mac', 'Rumours', 1, 'soft rock, pop rock'],
  ['David Bowie', 'Ziggy Stardust', 1, 'glam rock, art rock'],
  ['Oasis', "What's the Story Morning Glory", 1, 'britpop, rock, alternative rock'],
  ['Bjork', 'Homogenic', 1, 'art pop, electronic, experimental'],
  ['Sufjan Stevens', 'Illinois', 1, 'indie folk, chamber pop'],
  ['Pink Floyd', 'The Dark Side of the Moon', 1, 'progressive rock, art rock'],
  ['Michael Jackson', 'Thriller', 1, 'pop, r&b, funk, dance pop'],
  ['Prince', 'Purple Rain', 1, 'pop, funk, rock, r&b'],
  ['Bon Iver', 'For Emma Forever Ago', 1, 'indie folk, folk pop'],
  ['Erykah Badu', 'Baduizm', 1, 'neo-soul, r&b'],
  ['Frank Ocean', 'Blonde', 1, 'alternative r&b, art pop'],
  ['The Velvet Underground', 'The Velvet Underground and Nico', 1, 'art rock, proto-punk, alternative rock'],
  ['Led Zeppelin', 'Led Zeppelin IV', 1, 'hard rock, heavy metal, rock'],
  ['The Clash', 'London Calling', 1, 'punk rock, post-punk, reggae rock'],
  ['Kate Bush', 'Hounds of Love', 1, 'art pop, progressive pop'],
  ['The Cure', 'Disintegration', 1, 'gothic rock, dream pop, post-punk'],
  ['Burial', 'Untrue', 1, 'dubstep, electronic, ambient'],
  ['Kraftwerk', 'Trans-Europe Express', 1, 'electronic, synth-pop'],

  // ── WESTERN — Prestige 2 ──────────────────────────────────────────────────
  ['The National', 'Boxer', 2, 'indie rock, chamber pop'],
  ['Vampire Weekend', 'Vampire Weekend', 2, 'indie rock, afro-pop'],
  ['Slowdive', 'Souvlaki', 2, 'shoegaze, dream pop'],
  ['Elliott Smith', 'Either Or', 2, 'indie folk, acoustic, lo-fi, singer-songwriter'],
  ['Fleet Foxes', 'Fleet Foxes', 2, 'folk rock, chamber folk'],
  ['Mogwai', 'Young Team', 2, 'post-rock, instrumental'],
  ['Explosions in the Sky', 'The Earth Is Not a Cold Dead Place', 2, 'post-rock, instrumental'],
  ['Sade', 'Diamond Life', 2, 'sophisti-pop, soul, r&b'],
  ['Phoebe Bridgers', 'Punisher', 2, 'indie folk, singer-songwriter'],
  ['Taylor Swift', 'Folklore', 2, 'indie folk, alt-country, pop'],
  ['Charles Mingus', 'Mingus Ah Um', 2, 'jazz, hard bop'],
];

// ── Spotify auth ─────────────────────────────────────────────────────────────
// Mirrors the pattern in expand-catalog.ts (same credentials, same rate limit pool)

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API      = 'https://api.spotify.com/v1';

let tokenCache: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.value;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(sec: number) { super(`RATE_LIMIT:${sec}`); this.retryAfterSec = sec; }
}

async function spotifyGet(path: string, attempt = 0): Promise<any> {
  const token = await getToken();
  const url   = path.startsWith('https://') ? path : `${SPOTIFY_API}${path}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const raw = Number(res.headers.get('Retry-After') ?? 5);
    const sec = isNaN(raw) ? 5 : raw;
    await recordSpotify429(sec, 'seed-prestige');
    if (sec > 120 || attempt >= 3) throw new RateLimitError(sec);
    console.log(`  [rate limit] waiting ${sec}s… (attempt ${attempt + 1}/3)`);
    await sleep(sec * 1000);
    return spotifyGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

type AlbumHit = { id: string; title: string; artist: string; cover_url: string | null };

// Strategy 1: album text search with scoring — fast, works for most Western/popular albums
async function searchByAlbumText(artist: string, album: string): Promise<AlbumHit | null> {
  const params = new URLSearchParams({ q: `${artist} ${album}`, type: 'album', limit: '5' });
  const json   = await spotifyGet(`/search?${params}`);
  const items: any[] = json?.albums?.items ?? [];
  if (items.length === 0) return null;

  const scored = items.map(item => {
    const itemArtist = item.artists?.map((a: any) => a.name).join(', ') ?? '';
    return { item, score: matchScore(album, item.name, artist, itemArtist) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < MATCH_THRESHOLD) return null;

  return {
    id: best.item.id,
    title: best.item.name,
    artist: best.item.artists?.[0]?.name ?? artist,
    cover_url: best.item.images?.[0]?.url ?? null,
  };
}

// Strategy 2: find artist → fetch discography → match album locally.
// Reliable for Korean/Japanese entries where album text search picks wrong artists.
// nativeQuery can be the native artist name (e.g. '이날치') or artist+album (e.g. '이날치 수궁가') —
// Spotify's artist search is fuzzy enough to find the artist either way.
async function searchByDiscography(nativeQuery: string, album: string): Promise<AlbumHit | null> {
  await sleep(400);

  // Find artist
  const artistParams = new URLSearchParams({ q: nativeQuery, type: 'artist', limit: '3' });
  const artistJson   = await spotifyGet(`/search?${artistParams}`);
  const artists: any[] = artistJson?.artists?.items ?? [];
  if (artists.length === 0) return null;
  const foundArtist = artists[0];

  await sleep(400);

  // Fetch full discography (albums + EPs/singles that may be EPs)
  const discoData = await spotifyGet(
    `/artists/${foundArtist.id}/albums?include_groups=album,single&market=KR&limit=50`
  );
  const albums: any[] = discoData?.items ?? [];

  // Match album name — rawSimilarity preserves Korean/Japanese characters
  const scored = albums
    .map(a => ({ a, score: rawSimilarity(album, a.name) }))
    .sort((x, y) => y.score - x.score);

  if (scored.length === 0 || scored[0].score < 0.4) return null;

  const best = scored[0].a;
  return {
    id: best.id,
    title: best.name,
    artist: foundArtist.name,
    cover_url: best.images?.[0]?.url ?? null,
  };
}

async function searchAlbum(
  artist: string,
  album: string,
  nativeQuery?: string,
): Promise<AlbumHit | null> {
  // Strategy 1: album text search with scoring
  const result = await searchByAlbumText(artist, album);
  if (result) return result;

  // Strategy 2: artist discography match (handles Korean/Japanese reliably)
  if (nativeQuery) {
    await sleep(400);
    return searchByDiscography(nativeQuery, album);
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  await assertSpotifyCircuitClosed();

  // Canary call — fail fast if still rate limited
  try {
    process.stdout.write('   Checking Spotify access… ');
    await spotifyGet('/search?q=test&type=artist&limit=1');
    console.log('OK\n');
  } catch (err: any) {
    if (err instanceof RateLimitError) {
      const mins = Math.ceil(err.retryAfterSec / 60);
      console.log(`RATE LIMITED\n\n  Spotify is still rate limiting this app. Wait ${mins} minute${mins !== 1 ? 's' : ''} and try again.\n`);
    } else {
      console.log(`FAILED — ${err.message}\n`);
    }
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const done = loadState();

  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const [artist, album, prestige, genres, nativeQuery, spotifyId] of CANONICAL_ALBUMS) {
    const key = `${artist}|${album}`;

    if (done.has(key)) {
      console.log(`  ↩ Already done: "${artist}" — "${album}"`);
      skipped++;
      continue;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));

    let result: { id: string; title: string; artist: string; cover_url: string | null } | null = null;

    if (spotifyId) {
      // Direct ID — bypass search entirely
      try {
        const data = await spotifyGet(`/albums/${spotifyId}`);
        result = {
          id: data.id,
          title: data.name,
          artist: data.artists?.map((a: any) => a.name).join(', ') ?? artist,
          cover_url: data.images?.[0]?.url ?? null,
        };
      } catch (err: any) {
        console.warn(`  ✗ ID fetch failed: "${artist}" — "${album}" [${spotifyId}]: ${err.message}`);
        failed++;
        continue;
      }
    } else {
      result = await searchAlbum(artist, album, nativeQuery);
    }

    if (!result) {
      console.warn(`  ✗ Not found: "${artist}" — "${album}"`);
      failed++;
      // Don't mark as done — allow retry on next run
      continue;
    }

    console.log(`  ${prestige}★ ${result.artist} — ${result.title} [${result.id}]`);

    if (DRY_RUN) { skipped++; continue; }

    const { error } = await db
      .from('releases')
      .upsert({
        id: result.id,
        title: result.title,
        artist: result.artist,
        cover_url: result.cover_url,
        release_type: 'Album',
        prestige,
        genres,
      }, { onConflict: 'id' });

    if (error) {
      console.error(`    DB error:`, error.message);
      failed++;
    } else {
      seeded++;
      done.add(key);
      saveState(done);
    }
  }

  console.log(`\nDone. seeded=${seeded} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  if (e instanceof RateLimitError) {
    const mins = Math.ceil(e.retryAfterSec / 60);
    console.error(`\n  Spotify rate limit hit mid-run. Wait ${mins} minute${mins !== 1 ? 's' : ''} and re-run to resume.\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

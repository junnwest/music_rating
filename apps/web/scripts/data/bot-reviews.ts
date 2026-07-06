/**
 * Persona-voiced, LANGUAGE-MATCHED short reviews for the bot population (2026-07-05).
 *
 * Language follows the persona's origin bucket, NOT a global default:
 *   • bucket 'ko'      → Korean   (matches the Hangul display name)
 *   • bucket 'ja'      → Japanese (matches the Kana display name)
 *   • bucket 'western' → English
 *
 * Design rules that keep these believable rather than AI-slop:
 *   • SHORT — a fragment to one casual sentence, informal register (반말 / だ・である casual / lowercase en).
 *   • Sentiment-conditioned by score; only a MINORITY of ratings get text (real users rarely write),
 *     weighted toward strong scores (people write when they love or hate).
 *   • NEVER names tracks, years, or facts — only feel / texture / listening context, so a review can
 *     never state something false about a specific album.
 *   • Deterministic given the bot's seeded RNG → resumable/reproducible.
 */
import type { Persona } from './bot-personas';

const pick = <T>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length)];

type Pack = { LOVE: string[]; LIKE: string[]; MID: string[]; PAN: string[]; sep: string };

const PACKS: Record<'ko' | 'ja' | 'western', Pack> = {
  ko: {
    LOVE: ['스킵할 곡이 없다', '이건 그냥 계속 듣게 됨', '요즘 밤에 제일 많이 들은 앨범', '처음부터 끝까지 버릴 곡이 없음', '한동안 계속 돌려들을 듯', '올해 top 안에 든다'],
    LIKE: ['들을수록 좋아진다', '조용히 명반', '생각보다 훨씬 좋았음', '처음부터 끝까지 안정적임', '분위기가 취향이다'],
    MID: ['몇 곡 빼곤 좀 밋밋하다', '나쁘진 않은데 크게 남는 게 없음', '더 좋아하고 싶었는데', '앞부분이 다 했다', '한두 번 듣고 손이 안 감'],
    PAN: ['솔직히 좀 과대평가된 듯', '프로듀싱이 아쉽다', '중간에 흥미를 잃었다', '기대만큼은 아니었음', '분위기만 있고 알맹이가 없다'],
    sep: ' ',
  },
  ja: {
    LOVE: ['スキップする曲がない', 'ずっとリピートしてる', '夜に一番聴いたアルバム', '最初から最後まで捨て曲なし', 'しばらく回し続けると思う'],
    LIKE: ['聴くほど良くなる', '静かな名盤', '思ったよりずっと良かった', '安定して良い', '雰囲気が好み'],
    MID: ['数曲以外はちょっと平坦', '悪くないけど残らない', 'もっと好きになりたかった', '前半で持ってる感じ'],
    PAN: ['正直ちょっと過大評価かも', 'プロダクションが惜しい', '途中で飽きた', '期待したほどじゃなかった'],
    sep: ' ',
  },
  western: {
    LOVE: ['no skips.', 'this one just clicks.', 'lived on repeat this month.', 'front to back, no filler.', 'late-night album of the year for me.'],
    LIKE: ['grew on me a lot.', 'quietly excellent.', 'solid all the way through.', 'better than i expected going in.'],
    MID: ['a few highlights, rest kind of drifts.', 'fine but nothing sticks.', 'wanted to love it more than i do.', 'front half carries it.'],
    PAN: ['overrated for me honestly.', 'production does it no favors.', 'tuned out halfway.', 'more hype than substance.'],
    sep: ' — ',
  },
};

// Persona-specific flavor, in the persona's own language. Optional second clause appended to a review.
const FLAVOR: Record<string, string[]> = {
  // Korean
  'kpop-stan': ['타이틀곡이 미쳤다', '앨범 전체 완성도가 높다', '이번 컴백 중에 최고'],
  'kindie-head': ['비 오는 날 헤드폰으로 듣기 딱', '절제된 게 매력', '따뜻하고 여유롭다'],
  'khiphop-head': ['비트 선정이 다 했다', '벌스가 생각보다 좋음', '믹싱은 좀 탁한데 벌스가 살림'],
  'krnb-head': ['새벽 감성 그 자체', '그루브가 좋다', '보컬 톤이 취향'],
  'kcritic': ['구성이 탄탄하다', '레퍼런스가 명확함', '사운드 디자인이 인상적'],
  // Japanese
  'jpop-citypop': ['グルーヴが最高', 'ベースラインが良すぎる', '深夜のドライブって感じ'],
  'jrock-head': ['ギターの音が最高', '爆音で聴きたい', 'リフが刺さる'],
  // Western
  'hiphop-head': ['beat selection is the whole thing', 'flows are underrated here', 'the sample work is immaculate'],
  'indie-alt-head': ['guitar tone is gorgeous', 'drowning in reverb in the best way', 'so much texture in the low end'],
  'jazz-classical': ['the interplay between the players is superb', 'the reissue pressing sounds clean', 'patient and beautifully arranged'],
  'electronic-head': ['the sound design is deep', 'sounds incredible on a good system', 'hypnotic once it locks in'],
  'rock-canon': ['riffs for days', 'meant to be played loud', 'the rhythm section carries it'],
  'rnb-soul-head': ['the groove is buttery', 'vocals are effortless', 'made for late nights'],
};

/**
 * Returns a short language-matched review, or null (the common case).
 * `score` is the 1–5 rating; extremes get text more often.
 */
export function reviewFor(p: Persona, score: number, rand: () => number): string | null {
  const extreme = score >= 4.3 || score <= 2.7;
  if (rand() >= (extreme ? 0.45 : 0.17)) return null;        // ~25–30% overall, biased to strong opinions
  const pack = PACKS[p.bucket];
  const positive = score >= 3.5;
  const bank = score >= 4.2 ? pack.LOVE : positive ? pack.LIKE : score >= 2.9 ? pack.MID : pack.PAN;
  let s = pick(bank, rand);
  // Flavor banks are positive-leaning, so only lead a POSITIVE review with them (avoids
  // "guitar tone is gorgeous — more hype than substance" style contradictions on pans).
  const flav = FLAVOR[p.key];
  if (positive && flav && rand() < 0.4) s = pick(flav, rand) + pack.sep + s;
  return s;
}

import type { Candidate, FeedBucket, RankedRef } from './types';

export const FEED_VERSION = 'home-v5';
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const buckets: FeedBucket[] = ['taste', 'adjacent', 'social', 'community', 'exploration'];
const formats = ['review', 'mix', 'rating'] as const;
const formatShares = { review: 0.55, mix: 0.25, rating: 0.20 };

export function bucketShares(adventurousness: number): Record<FeedBucket, number> {
  const a = clamp(adventurousness / 100);
  return { taste: 0.55 - 0.30 * a, adjacent: 0.15 + 0.20 * a,
    social: 0.15, community: 0.10, exploration: 0.05 + 0.10 * a };
}

/**
 * How much thought a post shows, from its text alone.
 *
 * The previous version scored length and said so: "a modest, saturating proxy, not a claim that length
 * measures writing quality". It isn't one. Length is the easiest thing to fake and the least related to
 * whether a review is worth reading, so here it is capped at 40% of the score and two signals that are
 * harder to pad carry the rest:
 *
 *   VARIETY counts DISTINCT tokens, not the type-token ratio. TTR looks right and fails on exactly the
 *   input you need it to catch: "xxxx…x" is one token repeated, so its TTR is a perfect 1.0. Distinct
 *   tokens rank a padded string near zero, where it belongs.
 *   STRUCTURE counts sentences. One clause is a reaction; three is an argument.
 *
 * KOREAN IS NOT ENGLISH WITH DIFFERENT LETTERS, and this app is Korean-first. A 어절 carries more than an
 * English word, so a fixed token threshold would quietly rank Korean reviews below English ones of the
 * same substance. The threshold drops for Hangul/CJK-dominant text.
 *
 * None of this judges taste or correctness - it separates "짱" from a paragraph, which is what the
 * ranking needs it for, and nothing more.
 */
export function thoughtfulness(text: string, format: Candidate['format']): number {
  const t = (text ?? '').trim();
  if (!t) return format === 'rating' ? 0.12 : 0;
  const chars = Array.from(t).length;
  const tokens = t.split(/[\s,·、]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const types = new Set(tokens.map(w => w.toLowerCase())).size;
  const cjk = (t.match(/[ㄱ-힝一-鿿぀-ヿ]/gu) ?? []).length;
  const dense = cjk / chars > 0.3;                    // Hangul/CJK-dominant
  const sentences = (t.match(/[.!?…。！？]+|\n+/g) ?? []).length + (/[^\s]$/.test(t) ? 1 : 0);

  const length = 1 - Math.exp(-chars / (dense ? 110 : 190));
  const variety = 1 - Math.exp(-types / (dense ? 15 : 24));
  const structure = Math.min(1, sentences / 3);
  const score = 0.40 * length + 0.35 * variety + 0.25 * structure;
  // Padding, keysmash, one word shouted: real text has more than a couple of distinct tokens.
  return types <= 2 ? score * 0.25 : score;
}

/**
 * Familiarity with what a post is ABOUT, which is a different question from whether the viewer would
 * enjoy it (`relevance`, the predicted rating). Someone who has rated an album has an opinion to compare
 * against and is the most likely person to read a review of it; someone who knows the artist can at
 * least place it. Both beat a stranger's record for engagement, which is why they are ranked up.
 */
export function familiarity(c: Candidate): number {
  return c.rated ? 1 : c.knownArtist ? 0.55 : 0;
}

/**
 * Familiarity and novelty pull in opposite directions, so they are two ends of ONE budget rather than
 * two independent bonuses - otherwise raising familiarity would quietly also raise the total weight of
 * "things about albums you know" and squeeze everything else. The viewer's own adventurousness setting
 * (the same control that sets the bucket mix) decides the split, so a reader who has asked for
 * discovery still gets it and the setting keeps meaning what it says.
 */
export function scoreCandidate(c: Candidate, now: number, adventurousness = 50): number {
  const timestamp = Date.parse(c.createdAt);
  const hours = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 3_600_000) : Infinity;
  const freshness = 2 ** (-hours / 48);
  const a = clamp(adventurousness / 100);
  const novelty = c.seen ? 0 : c.knownArtist ? 0.5 : 1;
  const BUDGET = 0.17;                                 // split between familiarity and novelty
  const famWeight = BUDGET * (1 - 0.75 * a);
  const novWeight = BUDGET - famWeight;
  return 0.30 * clamp(c.relevance) + 0.22 * thoughtfulness(c.text, c.format)
    + famWeight * familiarity(c) + novWeight * novelty
    + 0.14 * clamp(c.authorAffinity) + 0.10 * freshness + 0.07 * clamp(c.response)
    - (c.seen ? 0.30 : 0);
}

function eligible(c: Candidate, bucket: FeedBucket): boolean {
  switch (bucket) {
    case 'taste': return c.relevance >= 0.60;
    case 'adjacent': return !c.knownArtist && c.relevance >= 0.30 && c.relevance < 0.80;
    case 'social': return c.followed || c.authorAffinity >= 0.45;
    case 'community': return c.response > 0;
    case 'exploration': return !c.seen && !c.knownArtist;
  }
}

/** Smooth weighted scheduling spreads source slots across the page, rather than
 * concatenating five ranked lists. Diversity uses a rolling 20-post window,
 * so it also holds across page boundaries. Relax only when supply requires it. */
export function rankExplore(candidates: Candidate[], adventurousness = 50, now = Date.now()): RankedRef[] {
  const remaining = Array.from(new Map(candidates.map(c => [c.key, c])).values());
  const scores = new Map(remaining.map(c => [c.key, scoreCandidate(c, now, adventurousness)]));
  const shares = bucketShares(adventurousness);
  const debt = Object.fromEntries(buckets.map(b => [b, 0])) as Record<FeedBucket, number>;
  const output: RankedRef[] = [];
  const history: Candidate[] = [];
  while (remaining.length) {
    for (const b of buckets) debt[b] += shares[b];
    const desired = [...buckets].sort((a, b) => debt[b] - debt[a]);
    const window = history.slice(-19);
    const counts = Object.fromEntries(formats.map(f => [f, window.filter(c => c.format === f).length]));
    let chosen: Candidate | undefined;
    let chosenBucket: FeedBucket = desired[0];
    // Diversity outranks the source quota. Exhaust unseen supply before repeats.
    const unseenAvailable = remaining.some(c => !c.seen);
    for (let relaxation = 0; relaxation < 3 && !chosen; relaxation++) {
      const allowed = remaining.filter(c => {
        if (unseenAvailable && c.seen) return false;
        if (relaxation < 2 && history.at(-1)?.author === c.author) return false;
        if (relaxation > 0) return true;
        if (window.filter(p => p.author === c.author).length >= 2) return false;
        const albumIds = new Set(c.albums.map(a => a.id));
        const artists = new Set(c.albums.map(a => a.primary_artist_id).filter(Boolean));
        // Mixes can intentionally collect familiar albums; only exact rating repeats are capped.
        if (c.format !== 'mix' && window.some(p => p.format !== 'mix' && p.albums.some(a => albumIds.has(a.id)))) return false;
        return window.filter(p => p.albums.some(a => a.primary_artist_id && artists.has(a.primary_artist_id))).length < 3;
      });
      for (const bucket of desired) {
        const pool = allowed.filter(c => eligible(c, bucket));
        if (!pool.length) continue;
        const utility = (c: Candidate) => (scores.get(c.key) ?? 0)
          + 0.06 * (formatShares[c.format] * (window.length + 1) - counts[c.format])
          - 0.08 * window.filter(p => p.author === c.author).length;
        pool.sort((a, b) => utility(b) - utility(a) || b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key));
        chosen = pool[0]; chosenBucket = bucket; break;
      }
      if (!chosen && allowed.length) {
        allowed.sort((a, b) => (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0) || a.key.localeCompare(b.key));
        chosen = allowed[0]; chosenBucket = 'exploration';
      }
    }
    if (!chosen) break;
    // Charge the requested slot even when sparse supply required a fallback.
    debt[desired[0]] -= 1;
    remaining.splice(remaining.indexOf(chosen), 1);
    history.push(chosen);
    output.push({ key: chosen.key, bucket: chosenBucket });
  }
  return output;
}

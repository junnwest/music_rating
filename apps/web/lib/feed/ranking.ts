import type { Candidate, FeedBucket, RankedRef } from './types';

export const FEED_VERSION = 'home-v4';
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const buckets: FeedBucket[] = ['taste', 'adjacent', 'social', 'community', 'exploration'];
const formats = ['review', 'mix', 'rating'] as const;
const formatShares = { review: 0.55, mix: 0.25, rating: 0.20 };

export function bucketShares(adventurousness: number): Record<FeedBucket, number> {
  const a = clamp(adventurousness / 100);
  return { taste: 0.55 - 0.30 * a, adjacent: 0.15 + 0.20 * a,
    social: 0.15, community: 0.10, exploration: 0.05 + 0.10 * a };
}

export function scoreCandidate(c: Candidate, now: number): number {
  const timestamp = Date.parse(c.createdAt);
  const hours = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 3_600_000) : Infinity;
  const freshness = 2 ** (-hours / 48);
  // A modest, saturating proxy, not a claim that length measures writing quality.
  const chars = Array.from(c.text.trim()).length;
  const value = c.format === 'rating' ? 0.15 : 0.35 + 0.65 * (1 - Math.exp(-chars / 120));
  const novelty = c.seen ? 0 : c.knownArtist ? 0.5 : 1;
  return 0.35 * clamp(c.relevance) + 0.20 * clamp(c.authorAffinity)
    + 0.15 * value + 0.15 * freshness + 0.10 * clamp(c.response) + 0.05 * novelty
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
  const scores = new Map(remaining.map(c => [c.key, scoreCandidate(c, now)]));
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

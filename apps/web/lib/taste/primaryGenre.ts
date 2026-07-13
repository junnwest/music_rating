/**
 * Which tag in an album's genres[] is its PRIMARY genre — the scene-first
 * precedence already used by the chart system, applied to taste weighting:
 * the primary tag carries full weight, co-tags carry half (see profile.ts).
 *
 * Why not array position: MB's API returns genres ALPHABETICALLY and the
 * ingest discards the per-genre vote count (verified live 2026-07-12 — e.g.
 * every My Bloody Valentine album reads ["indie rock","rock","shoegaze"]), so
 * position carries no importance signal for existing rows. Precedence does:
 * a [hip hop, k-pop, pop] album is a k-pop album that happens to carry style
 * co-tags. (mb-client.ts now sorts future ingests by vote count, but the
 * 307k existing rows stay alphabetical, so this stays the durable signal.)
 *
 * ⚠ THREE COPIES of this family table must stay in sync:
 *   - this file (taste weighting, TS)
 *   - scripts/backfill-primary-genre.ts PRECEDENCE (chart backfill, TS)
 *   - _compute_primary_genre / _primary_genre_tag (SQL, migrations
 *     20260706000017-ish + 20260712000010)
 */

const norm = (g: string) =>
  g.toLowerCase().replace(/-/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();

/** Ordered precedence (highest first) — mirror of backfill-primary-genre.ts. */
const PRECEDENCE: string[][] = [
  ['korean hip hop', 'k rap', 'korean rap'],
  ['korean r and b', 'k r and b', 'korean rnb'],
  ['korean indie', 'k indie'],
  ['korean folk', 'k folk'],
  ['korean ballad', 'k ballad'],
  ['k pop', 'korean pop'],
  ['city pop'],
  ['j rock', 'japanese rock', 'visual kei'],
  ['j pop', 'japanese pop'],
  ['shoegaze', 'dream pop'],
  ['math rock'],
  ['post rock'],
  ['indie rock'],
  ['indie pop', 'bedroom pop'],
  ['alternative', 'alt rock'],
  ['metal'],
  ['punk'],
  ['classic rock', 'hard rock', 'psychedelic rock', 'prog rock', 'progressive rock'],
  ['jazz'],
  ['funk', 'disco'],
  ['r and b', 'rnb', 'neo soul', 'soul'],
  ['hip hop', 'rap', 'trap'],
  ['electronic', 'house', 'techno', 'edm', 'idm', 'electro', 'synth pop', 'synthpop'],
  ['ambient', 'lo fi', 'lofi'],
  ['folk', 'singer songwriter', 'americana'],
  ['classical', 'orchestral', 'baroque'],
  ['country'],
  ['bossa nova'],
  ['afrobeat'],
  ['rock'],
  ['pop'],
];

/**
 * The array element that is the album's primary genre: the first tag (in
 * array order) matching the highest-precedence family present, else the
 * first tag (an album whose tags match no family still has a main tag).
 */
export function primaryTagOf(genres: string[] | null | undefined): string | null {
  if (!genres || genres.length === 0) return null;
  const normed = genres.map(norm);
  for (const subs of PRECEDENCE) {
    for (let i = 0; i < normed.length; i++) {
      if (subs.some((sub) => normed[i].includes(sub))) return genres[i];
    }
  }
  return genres[0];
}

/** Weight of one tag within its album: primary 1.0, co-tag 0.5. */
export function tagWeight(tag: string, primary: string | null): number {
  return primary != null && tag === primary ? 1.0 : 0.5;
}

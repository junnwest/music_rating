/**
 * The genre MERGE step (GENRE_TAXONOMY.md §4 Phase 3): collapse a release group's
 * per-source `release_genres` rows into ONE ranked "displayed set" of canonical
 * taxonomy ids. This is the trust × confidence × agreement model the acquisition
 * pipeline feeds — pure and dependency-light (no DB, no taxonomy import) so it is
 * unit-testable and reusable by both a backfill script and live ingest.
 *
 * Score for a genre id =
 *     Σ_source [ trust(source) · confidenceWeight(confidence) ]      (per assignment)
 *   · agreementBoost(#distinct sources that asserted it)             (cross-source)
 *
 *   - trust(source): source reliability. Human (manual) > our curated MB spine >
 *     the commercial catalogs (deezer/itunes) > folksonomy (lastfm) > the
 *     provenance-less `legacy` text[] backfill (lowest — it's the merged past).
 *   - confidenceWeight: a source's own signal (MB tag vote count / Last.fm tag
 *     weight) saturated into [0.5,1]; NULL (source asserted it with no count) = 1.
 *     Each source's raw signal lives on its own scale (MB votes are ~1–10s, Last.fm
 *     weights 0–100), so the saturation point is per-source — the DB keeps the raw
 *     value and this is the one place it is normalized.
 *   - agreementBoost: a genre multiple independent sources agree on is more
 *     trustworthy than a single source's assertion.
 *
 * Ties break on id for determinism. The taxonomy `level`/`rank` are NOT consulted
 * here — that is the PRIMARY-genre walk's job (resolver.primaryOf); this step only
 * ranks which genres are strong enough to display, from the acquisition evidence.
 */

export type GenreSource = 'musicbrainz' | 'lastfm' | 'itunes' | 'deezer' | 'manual' | 'legacy';

export interface GenreAssignment {
  /** Canonical taxonomy node id (already resolved at acquisition time). */
  genreId: string;
  source: GenreSource;
  /** The source's own signal (vote count / tag weight); NULL when it has none. */
  confidence?: number | null;
}

export interface MergedGenre {
  genreId: string;
  score: number;
  /** Distinct sources that asserted this id, strongest-trust first. */
  sources: GenreSource[];
}

/** Source reliability weights (see file header). Order = descending trust. */
export const SOURCE_TRUST: Record<GenreSource, number> = {
  manual: 1.0,
  musicbrainz: 0.9,
  deezer: 0.6,
  itunes: 0.55,
  lastfm: 0.5,
  legacy: 0.4,
};

/**
 * Confidence at which a counted source reaches 0.75 of its full weight, per source
 * (its raw signal's scale). Sources not listed use DEFAULT_CONFIDENCE_FLOOR.
 */
const DEFAULT_CONFIDENCE_FLOOR = 3;
export const CONFIDENCE_FLOOR: Partial<Record<GenreSource, number>> = {
  musicbrainz: 3, // community vote count (most tagged groups carry 1–5 votes)
  lastfm: 30, //     tag weight, 0–100 relative to the album's top tag
};
/** Per-extra-agreeing-source multiplicative bonus. */
const AGREEMENT_BONUS = 0.25;

/** Saturate a source's raw confidence into a [0.5, 1] multiplier. */
export function confidenceWeight(
  confidence: number | null | undefined,
  source?: GenreSource,
): number {
  if (confidence == null) return 1; // asserted without a count → full base weight
  if (confidence <= 0) return 0.5;
  const floor = (source && CONFIDENCE_FLOOR[source]) ?? DEFAULT_CONFIDENCE_FLOOR;
  return 0.5 + 0.5 * (confidence / (confidence + floor));
}

/**
 * Merge a release group's assignments into a ranked displayed set. `limit` caps
 * the result (the display carries the top few); omit for the full ranking.
 */
export function mergeGenres(
  assignments: readonly GenreAssignment[],
  opts?: {
    limit?: number;
    /** Ids eligible for DISPLAY (e.g. `id => !isSceneRoot(id)`); others are scored
     *  out of the displayed set. Kept as a predicate so this module stays free of
     *  taxonomy imports. */
    displayable?: (genreId: string) => boolean;
  },
): MergedGenre[] {
  const byId = new Map<string, { score: number; sources: Set<GenreSource> }>();
  for (const a of assignments) {
    if (!a.genreId || !(a.source in SOURCE_TRUST)) continue;
    if (opts?.displayable && !opts.displayable(a.genreId)) continue;
    let e = byId.get(a.genreId);
    if (!e) byId.set(a.genreId, (e = { score: 0, sources: new Set() }));
    e.score += SOURCE_TRUST[a.source] * confidenceWeight(a.confidence, a.source);
    e.sources.add(a.source);
  }

  const merged: MergedGenre[] = [...byId].map(([genreId, e]) => ({
    genreId,
    score: e.score * (1 + AGREEMENT_BONUS * (e.sources.size - 1)),
    sources: [...e.sources].sort((x, y) => SOURCE_TRUST[y] - SOURCE_TRUST[x]),
  }));
  merged.sort((a, b) => b.score - a.score || a.genreId.localeCompare(b.genreId));

  return opts?.limit != null ? merged.slice(0, opts.limit) : merged;
}

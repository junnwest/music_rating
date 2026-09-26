/**
 * Picks the homepage recommendation categories for a given user.
 *
 * Categories are now a PROJECTION of the taxonomy (lib/genres/categories.ts —
 * surface nodes), and membership is id-based (a tag resolves to the category node
 * or a descendant), so this file no longer carries substring `genreFilters`; it
 * only ranks and diversifies. (GENRE_TAXONOMY.md §4 Phase 2 task 2.)
 *
 * Signals used (in priority order):
 *   1. Onboarding `preferred_genres` — explicit user signal
 *   2. Rating history — albums rated >= 3.5 stars, tallied by category membership
 *      (revealed preference; weighted lower than onboarding so recent ratings get
 *      a voice without overriding stated preferences)
 *   3. Default mix — the surface families, shown to users with no preferences yet
 *
 * Diversification: caps each origin (korean/japanese/western/…/global) at
 * MAX_PER_ORIGIN so a user who picked only Korean genres still sees a varied grid.
 */

import {
  CATEGORIES,
  albumMatchesCategory,
  type GenreCategory,
} from './genres/categories';
import type { SupabaseClient } from '@supabase/supabase-js';

const TARGET_COUNT = 10; // how many rows we aim to surface on the homepage
const MAX_PER_ORIGIN = 4; // cap so no single origin dominates the grid

const SCORE_ONBOARDING_MATCH = 100;
const SCORE_RATING_MATCH = 5; // per matching rated album (capped — see below)
const SCORE_RATING_CAP = 50; // ceiling on rating contribution per category
const SCORE_DEFAULT = 20;
const SCORE_SORT_ORDER_WEIGHT = 0.01;

// Only sound families are shown by default (a scene/subgenre row needs an explicit
// user signal to surface); everything else can still rank in via a signal.
const DEFAULT_CATEGORY_IDS = new Set<string>([
  'pop',
  'rock',
  'hip-hop',
  'rnb-soul',
  'electronic',
  'jazz',
  'folk',
  'classical',
  'metal',
]);

interface UserSignals {
  /** Onboarding labels, e.g. "K-Pop" — treated as raw tags and resolved. */
  preferredGenres: string[];
  /** genres[] of each album the user rated >= 3.5. */
  highRatedGenres: string[][];
}

async function loadUserSignals(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSignals> {
  const signals: UserSignals = { preferredGenres: [], highRatedGenres: [] };

  const [{ data: profile }, { data: ratings }] = await Promise.all([
    supabase.from('profiles').select('preferred_genres').eq('id', userId).maybeSingle(),
    supabase
      .from('ratings')
      .select('release_group_id, score')
      .eq('user_id', userId)
      .gte('score', 3.5)
      .limit(500),
  ]);

  if (profile?.preferred_genres) {
    signals.preferredGenres = profile.preferred_genres
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  const highRatedIds = (ratings ?? [])
    .map((r: { release_group_id: string | null }) => r.release_group_id)
    .filter(Boolean);
  if (highRatedIds.length > 0) {
    // release_groups.genres is text[] (post-renovation); the old code read the
    // dropped `releases` comma-string column and always came back empty.
    const { data: groups } = await supabase
      .from('release_groups')
      .select('id, genres')
      .in('id', highRatedIds);

    for (const g of groups ?? []) {
      if (Array.isArray(g.genres) && g.genres.length) signals.highRatedGenres.push(g.genres);
    }
  }

  return signals;
}

function scoreCategory(cat: GenreCategory, signals: UserSignals | null): number {
  let score = 0;

  if (DEFAULT_CATEGORY_IDS.has(cat.id)) score += SCORE_DEFAULT;

  if (signals) {
    // Onboarding: a preferred label that resolves under this category is a strong
    // explicit signal. Reuse the id-based membership (label treated as a tag).
    if (signals.preferredGenres.some((label) => albumMatchesCategory([label], cat.id))) {
      score += SCORE_ONBOARDING_MATCH;
    }
    // Revealed preference: how many high-rated albums fall under this category.
    let ratingMatch = 0;
    for (const genres of signals.highRatedGenres) {
      if (albumMatchesCategory(genres, cat.id)) ratingMatch += 1;
    }
    score += Math.min(ratingMatch * SCORE_RATING_MATCH, SCORE_RATING_CAP);
  }

  return score;
}

function diversify(ranked: GenreCategory[], targetCount: number): GenreCategory[] {
  const result: GenreCategory[] = [];
  const originCounts: Record<string, number> = {};

  for (const cat of ranked) {
    const origin = cat.origin;
    if ((originCounts[origin] ?? 0) >= MAX_PER_ORIGIN) continue;
    result.push(cat);
    originCounts[origin] = (originCounts[origin] ?? 0) + 1;
    if (result.length >= targetCount) break;
  }

  return result;
}

/**
 * Returns the prioritized list of categories to show on the homepage for this user.
 * Pass `null` for `userId` to get the unauthenticated default mix.
 */
export async function getCategoriesForUser(
  supabase: SupabaseClient | null,
  userId: string | null,
): Promise<GenreCategory[]> {
  let signals: UserSignals | null = null;
  if (supabase && userId) {
    try {
      signals = await loadUserSignals(supabase, userId);
    } catch {
      signals = null;
    }
  }

  const scored = CATEGORIES.map((cat, i) => ({
    cat,
    // Ties break on taxonomy order (earlier = broader/more prominent family).
    score: scoreCategory(cat, signals) - i * SCORE_SORT_ORDER_WEIGHT,
  }))
    .filter((s) => s.score > 0) // drop categories with no signal and no default
    .sort((a, b) => b.score - a.score)
    .map((s) => s.cat);

  return diversify(scored, TARGET_COUNT);
}

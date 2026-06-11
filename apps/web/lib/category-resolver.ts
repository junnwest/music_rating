/**
 * Picks the homepage recommendation categories for a given user.
 *
 * Signals used (in priority order):
 *   1. Onboarding `preferred_genres` — explicit user signal
 *   2. Rating history — albums rated >= 3.5 stars, genre-tallied (revealed
 *      preference; weighted lower than onboarding to give recent ratings a
 *      voice without overriding stated preferences)
 *   3. Default categories — popular global picks shown to users with no
 *      preferences yet
 *
 * Diversification: caps each origin (korean/japanese/western/global) at
 * MAX_PER_ORIGIN to avoid showing an all-Korean grid even to users who
 * picked only Korean genres. Discovery > over-fitting.
 */

import { GENRE_CATEGORIES, type GenreCategory } from './genre-categories';
import type { SupabaseClient } from '@supabase/supabase-js';

const TARGET_COUNT = 10;       // how many rows we aim to surface on the homepage
const MAX_PER_ORIGIN = 4;      // cap so no single origin dominates the grid

const SCORE_ONBOARDING_MATCH = 100;
const SCORE_RATING_MATCH = 5;  // per matching rated album (capped — see below)
const SCORE_RATING_CAP = 50;   // ceiling on rating contribution per category
const SCORE_DEFAULT = 20;
const SCORE_SORT_ORDER_WEIGHT = 0.01;

interface UserSignals {
  preferredGenres: Set<string>;        // values from onboarding `preferred_genres`
  ratedGenreTokens: Map<string, number>; // genre token → count of albums rated >= 3.5
}

async function loadUserSignals(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSignals> {
  const signals: UserSignals = {
    preferredGenres: new Set(),
    ratedGenreTokens: new Map(),
  };

  const [{ data: profile }, { data: ratings }] = await Promise.all([
    supabase.from('profiles').select('preferred_genres').eq('id', userId).maybeSingle(),
    supabase.from('ratings').select('release_id, score').eq('user_id', userId).gte('score', 3.5),
  ]);

  if (profile?.preferred_genres) {
    for (const g of profile.preferred_genres.split(',').map((s: string) => s.trim()).filter(Boolean)) {
      signals.preferredGenres.add(g);
    }
  }

  const highRatedIds = (ratings ?? []).map((r: any) => r.release_id);
  if (highRatedIds.length > 0) {
    const { data: releases } = await supabase
      .from('releases')
      .select('id, genres')
      .in('id', highRatedIds);

    for (const r of releases ?? []) {
      if (!r.genres) continue;
      const tokens = r.genres.split(',').map((g: string) => g.trim().toLowerCase()).filter(Boolean);
      for (const t of tokens) {
        signals.ratedGenreTokens.set(t, (signals.ratedGenreTokens.get(t) ?? 0) + 1);
      }
    }
  }

  return signals;
}

function scoreCategory(cat: GenreCategory, signals: UserSignals | null): number {
  let score = -cat.sortOrder * SCORE_SORT_ORDER_WEIGHT;

  if (cat.isDefault) score += SCORE_DEFAULT;

  if (signals) {
    if (cat.onboardingGenre && signals.preferredGenres.has(cat.onboardingGenre)) {
      score += SCORE_ONBOARDING_MATCH;
    }
    // Count how many of the user's high-rated albums fall under this category
    let ratingMatch = 0;
    for (const filter of cat.genreFilters) {
      const f = filter.toLowerCase();
      for (const [token, count] of signals.ratedGenreTokens) {
        if (token.includes(f) || f.includes(token)) ratingMatch += count;
      }
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
    try { signals = await loadUserSignals(supabase, userId); }
    catch { signals = null; }
  }

  const scored = GENRE_CATEGORIES
    .map((cat) => ({ cat, score: scoreCategory(cat, signals) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.cat);

  return diversify(scored, TARGET_COUNT);
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useSession } from './SessionContext';

/**
 * App-wide cache of the signed-in user's own album ratings, so a rated album
 * always shows its score wherever it appears (feed, charts, artist, search…)
 * and a single rating updates every instance at once — no per-page plumbing.
 *
 * The map is keyed by `release_group_id`. A *present* key means "known": a
 * number is the user's score, `null` means "known to be unrated" (e.g. just
 * voided). An *absent* key means "unknown" — the caller should fall back to
 * whatever score it was handed as a prop until the store learns otherwise.
 *
 * `setRating` is the single write path used by AlbumRateButton: it updates the
 * cache optimistically and persists the upsert/delete. Pages that own their own
 * DB write (e.g. the album detail editors) call `applyLocal` instead to push
 * their result into the cache without a second round-trip.
 */

type RatingsMap = Map<string, number | null>;

interface RatingsValue {
  /** True once the initial full load has settled (or there's no signed-in user). */
  ready: boolean;
  /** The live cache. Present key = known (number score or null = known-unrated). */
  map: RatingsMap;
  /** Optimistically update the cache and persist (upsert for a score, delete for null). */
  setRating: (releaseGroupId: string, score: number | null) => Promise<void>;
  /** Update the cache only — for callers that persist the write themselves. */
  applyLocal: (releaseGroupId: string, score: number | null) => void;
}

const RatingsContext = createContext<RatingsValue>({
  ready: false,
  map: new Map(),
  setRating: async () => {},
  applyLocal: () => {},
});

const PAGE = 1000; // Supabase's default max rows per request; paginate past it.

export function RatingsProvider({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  const [map, setMap] = useState<RatingsMap>(() => new Map());
  const [ready, setReady] = useState(false);

  // Load the user's full manual-rating set once per sign-in. Paginated so a
  // heavy rater (>1000 albums) isn't silently truncated at the default cap.
  useEffect(() => {
    if (!supabase || !userId) {
      setMap(new Map());
      setReady(!userId); // signed out → nothing to load, treat as ready
      return;
    }
    let cancelled = false;
    setReady(false);
    (async () => {
      const next: RatingsMap = new Map();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase!
          .from('ratings')
          .select('release_group_id, score')
          .eq('user_id', userId)
          .not('score', 'is', null)
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        for (const r of data as { release_group_id: string; score: number | null }[]) {
          if (r.score != null) next.set(r.release_group_id, r.score);
        }
        if (data.length < PAGE) break;
      }
      if (cancelled) return;
      setMap(next);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const applyLocal = useCallback((releaseGroupId: string, score: number | null) => {
    setMap((prev) => {
      const next = new Map(prev);
      next.set(releaseGroupId, score);
      return next;
    });
  }, []);

  const setRating = useCallback(
    async (releaseGroupId: string, score: number | null) => {
      applyLocal(releaseGroupId, score);
      if (!supabase || !userId) return;
      if (score == null) {
        await supabase
          .from('ratings')
          .delete()
          .eq('user_id', userId)
          .eq('release_group_id', releaseGroupId);
      } else {
        await supabase
          .from('ratings')
          .upsert(
            { user_id: userId, release_group_id: releaseGroupId, score },
            { onConflict: 'user_id,release_group_id' },
          );
      }
    },
    [userId, applyLocal],
  );

  return (
    <RatingsContext.Provider value={{ ready, map, setRating, applyLocal }}>
      {children}
    </RatingsContext.Provider>
  );
}

export function useRatings() {
  return useContext(RatingsContext);
}

/**
 * Subscribe to one album's cached score. Returns the number, `null` if the
 * store knows the album is unrated, or `undefined` if the store hasn't learned
 * about it yet (caller should fall back to any score it already has).
 */
export function useRating(releaseGroupId: string): number | null | undefined {
  const { map } = useContext(RatingsContext);
  return map.has(releaseGroupId) ? map.get(releaseGroupId)! : undefined;
}

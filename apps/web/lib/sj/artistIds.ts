'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

/**
 * release_group → primary artist id, for surfaces whose data source doesn't
 * carry the artist id (the search RPC, /api/discovery, /api/recommendations —
 * shared payloads iOS also reads, so they're left as they are).
 *
 * Every card asks for its own id; asks made in the same tick are batched into
 * one `release_groups` read, and answers are cached for the session.
 */

const cache = new Map<string, string | null>();
const waiters = new Map<string, Set<(id: string | null) => void>>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const CHUNK = 150;

async function flush() {
  timer = null;
  const ids = Array.from(pending);
  pending = new Set();
  if (!supabase || ids.length === 0) return;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('release_groups')
      .select('id, primary_artist_id')
      .in('id', chunk);
    if (error) {
      console.error('[artistIds] lookup failed:', error.message);
      // Leave them uncached so a later mount can retry.
      for (const id of chunk) waiters.delete(id);
      continue;
    }
    const found = new Map(
      ((data as { id: string; primary_artist_id: string | null }[]) ?? []).map((r) => [
        r.id,
        r.primary_artist_id,
      ]),
    );
    for (const id of chunk) {
      const artistId = found.get(id) ?? null;
      cache.set(id, artistId);
      waiters.get(id)?.forEach((fn) => fn(artistId));
      waiters.delete(id);
    }
  }
}

export function useArtistIdFor(releaseGroupId: string, known?: string | null): string | null {
  const [artistId, setArtistId] = useState<string | null>(
    known ?? cache.get(releaseGroupId) ?? null,
  );
  useEffect(() => {
    if (known) {
      setArtistId(known);
      return;
    }
    if (cache.has(releaseGroupId)) {
      setArtistId(cache.get(releaseGroupId) ?? null);
      return;
    }
    const fn = (id: string | null) => setArtistId(id);
    const set = waiters.get(releaseGroupId) ?? new Set();
    set.add(fn);
    waiters.set(releaseGroupId, set);
    pending.add(releaseGroupId);
    if (!timer) timer = setTimeout(flush, 30);
    return () => {
      waiters.get(releaseGroupId)?.delete(fn);
    };
  }, [releaseGroupId, known]);
  return artistId;
}

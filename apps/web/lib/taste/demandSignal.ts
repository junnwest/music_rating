/**
 * Turn a user's connected listening data into catalogue demand.
 *
 * WHY. When we pull someone's Spotify/Apple Music library we learn which artists they actually
 * listen to. Until now that data was display-only -- `profiles.spotify_artists` and
 * `spotify_recently_played` are stored as JSON and never compared against the catalogue -- so an
 * artist a real user listens to every day could be entirely absent and nothing would notice.
 *
 * That is a STRONGER demand signal than a search miss. A search can be idle curiosity or a typo;
 * a top-artists list is revealed preference, and the name comes from Spotify/Apple rather than
 * being typed, so it is already clean.
 *
 * HOW. Rather than add a pipeline lane, unknown artists are written to `search_misses`, which
 * already has everything needed: pipeline.ts's tryMisses() resolves each entry against
 * MusicBrainz, queues confident matches by MBID, and falls back to Deezer for artists MB does not
 * have at all -- but only on repeated demand, which counts rows for the same query. Two users with
 * the same missing artist therefore raise its confidence automatically.
 *
 * Queue priority 200 (above a search miss's 100) is applied in pipeline.ts; see migration
 * 20260922000000 for the scale.
 *
 * SAFETY. Read-mostly and best-effort: it never throws into the caller's request path, never
 * writes to the catalogue itself, and only inserts a row when the artist is genuinely absent.
 * `type` records the source so the signal can be audited or rolled back by origin later.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Matches the SQL normalize_text() used by search_artists: strip whitespace + punctuation only. */
function norm(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export type DemandSource = 'spotify_taste' | 'apple_taste';

/**
 * Record any of `artistNames` the catalogue does not hold, so the pipeline picks them up.
 * Returns the names recorded (already-known artists are silently skipped).
 */
export async function recordUnknownArtists(
  db: SupabaseClient,
  artistNames: string[],
  source: DemandSource,
): Promise<string[]> {
  const names = [...new Set(artistNames.map(n => (n ?? '').trim()).filter(Boolean))].slice(0, 100);
  if (!names.length) return [];

  try {
    // One round-trip for the whole batch. `artists.name` is indexed; alias/native spellings are
    // covered by the second pass below so a Korean act stored under Hangul is not re-queued.
    const { data: known } = await db.from('artists').select('name, name_native').in('name', names);
    const have = new Set<string>();
    for (const r of (known ?? []) as { name: string; name_native: string | null }[]) {
      have.add(norm(r.name));
      if (r.name_native) have.add(norm(r.name_native));
    }
    let missing = names.filter(n => !have.has(norm(n)));
    if (!missing.length) return [];

    // Second pass against artist_aliases: MB records many acts under a different primary name than
    // the streaming services use (Owen Ovadoz is "Owen" on Apple Music), and queueing an artist we
    // already hold wastes a MusicBrainz lookup and pollutes the demand counts.
    const { data: aliased } = await db.from('artist_aliases').select('alias').in('alias', missing);
    const aliasSet = new Set((aliased ?? []).map((r: { alias: string }) => norm(r.alias)));
    missing = missing.filter(n => !aliasSet.has(norm(n)));
    if (!missing.length) return [];

    // db_count 0 marks "catalogue returned nothing", which is what unlocks tryMisses()'s Deezer
    // fallback for artists MusicBrainz genuinely does not have.
    const rows = missing.map(q => ({ query: q, type: source, db_count: 0 }));
    const { error } = await db.from('search_misses').insert(rows);
    if (error) return [];
    return missing;
  } catch {
    return []; // never break the caller's request over a background signal
  }
}

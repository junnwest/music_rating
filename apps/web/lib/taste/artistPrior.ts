/**
 * Loads the ARTIST PRIOR for album placement (lib/genres/placement.ts): per
 * artist, the stored outside sources (artists.genre_evidence — MusicBrainz,
 * Last.fm, Wikidata, iTunes) and the tags on the artist's other albums/EPs in our
 * catalog. Singles are left out of the tags: an artist's one tagged single is not
 * their sound (양홍원's only tagged release is a [k-pop] single; his albums are
 * rap). Every release type counts for the artist-level language fallback.
 *
 * Server-only (Supabase). Batched reads per 50 artists.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { catalogEvidence, releaseLanguages, type PlacementInput } from '../genres/placement';
import { toArtistEvidence, type StoredGenreEvidence } from '../genres/artistEvidence';

const CHUNK = 50;
/** Catalog pages read per artist chunk (1000 rows each — PostgREST's cap); a prior needs the gist. */
const CATALOG_PAGES = 8;

interface CatalogRow {
  id: string;
  genres: string[] | null;
  release_group_type: string | null;
  title: string | null;
  native_title: string | null;
  title_language: string | null;
}

export interface ArtistPriors {
  stored: Map<string, StoredGenreEvidence>;
  releases: Map<string, CatalogRow[]>;
}

export async function loadArtistPriors(db: SupabaseClient, artistIds: Iterable<string | null | undefined>): Promise<ArtistPriors> {
  const ids = [...new Set([...artistIds].filter((x): x is string => !!x))];
  const stored = new Map<string, StoredGenreEvidence>();
  const releases = new Map<string, CatalogRow[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      const readCatalog = async () => {
        const rows: (CatalogRow & { primary_artist_id: string })[] = [];
        for (let page = 0; page < CATALOG_PAGES; page++) {
          const { data, error } = await db
            .from('release_groups')
            .select('id, primary_artist_id, genres, release_group_type, title, native_title, title_language')
            .in('primary_artist_id', chunk)
            .order('id')
            .range(page * 1000, page * 1000 + 999);
          if (error) {
            console.error('[artist-prior] catalog read:', error.message);
            break;
          }
          rows.push(...((data ?? []) as typeof rows));
          if ((data ?? []).length < 1000) break;
        }
        return rows;
      };
      const [ev, cat] = await Promise.all([
        db.from('artists').select('id, genre_evidence').in('id', chunk).not('genre_evidence', 'is', null),
        readCatalog(),
      ]);
      if (ev.error) console.error('[artist-prior] genre_evidence read:', ev.error.message);
      for (const r of (ev.data ?? []) as { id: string; genre_evidence: StoredGenreEvidence }[]) {
        stored.set(r.id, r.genre_evidence);
      }
      for (const r of cat) {
        const list = releases.get(r.primary_artist_id) ?? [];
        list.push(r);
        releases.set(r.primary_artist_id, list);
      }
    }),
  );
  return { stored, releases };
}

/**
 * Everything the placement needs from one album's artist — the prior, the album's
 * own iTunes genre, the artist's release languages — with the album itself left
 * out of the artist-level parts. Spread into placeAlbum's input.
 */
export function artistInputFor(
  priors: ArtistPriors,
  artistId: string | null | undefined,
  albumId: string,
  artistCountry: string | null | undefined,
): Pick<PlacementInput, 'artist' | 'itunesGenre' | 'artistReleaseLanguages'> {
  if (!artistId) return {};
  const others = (priors.releases.get(artistId) ?? []).filter((r) => r.id !== albumId);
  const tagged = others.filter(
    (r) => r.genres?.length && (r.release_group_type === 'album' || r.release_group_type === 'ep'),
  );
  const { artist, itunesGenre } = toArtistEvidence(
    priors.stored.get(artistId),
    catalogEvidence(tagged),
    albumId,
  );
  return {
    artist,
    itunesGenre,
    artistReleaseLanguages: releaseLanguages(
      others.map((r) => ({ title: r.title, nativeTitle: r.native_title, titleLanguage: r.title_language })),
      artistCountry,
    ),
  };
}

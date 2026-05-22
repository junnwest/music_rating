import { createServerClient } from '../lib/supabaseServer';
import { getSpotifyRecommendations } from '../lib/spotify';
import { GENRE_CATEGORIES } from '../lib/genre-categories';
import RecommendationGridClient from './RecommendationGridClient';
import type { AlbumRelease } from '../types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchFromReleases(
  supabase: NonNullable<ReturnType<typeof createServerClient>>,
  genreFilters: readonly string[],
): Promise<AlbumRelease[]> {
  const orClause = genreFilters.map((g) => `genres.ilike.%${g}%`).join(',');

  const { data, error } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url, release_type')
    .or(orClause)
    .not('cover_url', 'is', null)
    .order('prestige', { ascending: true, nullsFirst: false })
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(80);

  if (error || !data) return [];

  return shuffle(data).map((r: any) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    coverUrl: r.cover_url ?? null,
    releaseType: (r.release_type as AlbumRelease['releaseType']) ?? 'Album',
    date: null,
    country: null,
  }));
}

export default async function RecommendationGrid() {
  const supabase = createServerClient();

  const sections: { key: string; name: string; description: string; albums: AlbumRelease[] }[] = [];

  for (const cat of GENRE_CATEGORIES) {
    let albums: AlbumRelease[] = [];

    // Primary: query our releases table by genre
    if (supabase) {
      albums = await fetchFromReleases(supabase, cat.genreFilters);
    }

    // Secondary fallback: curated_releases (Spotify-seeded static list)
    if (albums.length === 0 && supabase) {
      try {
        const { data } = await supabase
          .from('curated_releases')
          .select('release_id, title, artist, cover_url, release_type')
          .eq('category', cat.key);

        albums = (data ?? []).map((r: any) => ({
          id: r.release_id,
          title: r.title,
          artist: r.artist,
          coverUrl: r.cover_url ?? null,
          releaseType: (r.release_type as AlbumRelease['releaseType']) ?? 'Album',
          date: null,
          country: null,
        }));
      } catch (err) {
        console.error('[RecommendationGrid] DB fetch failed:', err);
      }
    }

    // Final fallback: live Spotify search
    if (albums.length === 0) {
      try {
        albums = await getSpotifyRecommendations(cat.spotifyQuery);
      } catch (err) {
        console.error('[RecommendationGrid] Spotify fallback failed:', err);
      }
    }

    if (albums.length > 0) {
      sections.push({ key: cat.key, name: cat.name, description: cat.description, albums });
    }
  }

  if (sections.length === 0) return null;

  return <RecommendationGridClient sections={sections} />;
}

import Link from 'next/link';
import ScrollRow from './ScrollRow';
import { createServerClient } from '../lib/supabaseServer';
import { getSpotifyRecommendations } from '../lib/spotify';
import { GENRE_CATEGORIES } from '../lib/genre-categories';
import type { AlbumRelease } from '../types';

// Approximate number of cards visible at full width — show "See all" beyond this
const VISIBLE_THRESHOLD = 8;

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
    .limit(40);

  if (error || !data) return [];

  return data.map((r: any) => ({
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
      } catch {}
    }

    // Final fallback: live Spotify search
    if (albums.length === 0) {
      try {
        albums = await getSpotifyRecommendations(cat.spotifyQuery);
      } catch {}
    }

    if (albums.length > 0) {
      sections.push({ key: cat.key, name: cat.name, description: cat.description, albums });
    }
  }

  if (sections.length === 0) return null;

  return (
    <section className="max-w-[1440px] mx-auto px-5 pb-14">
      {sections.map((cat, i) => (
        <div key={cat.key}>
          {i > 0 && <div className="h-px bg-[#EBEBEB] my-11" />}
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="flex items-baseline gap-2">
                <div className="text-[17px] font-bold text-ink">{cat.name}</div>
                <div className="text-[12px] text-muted">{cat.albums.length} albums</div>
              </div>
              <div className="text-[12px] text-muted mt-0.5">{cat.description}</div>
            </div>
            {cat.albums.length > VISIBLE_THRESHOLD && (
              <Link
                href={`/genre/${cat.key}`}
                className="text-[12px] font-medium text-muted hover:text-mid transition whitespace-nowrap"
              >
                See all →
              </Link>
            )}
          </div>
          <ScrollRow albums={cat.albums} />
        </div>
      ))}
    </section>
  );
}

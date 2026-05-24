import { createServerClient } from '../lib/supabaseServer';1
import { getCategoriesForUser } from '../lib/category-resolver';
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
    .from('recommendable_releases')
    .select('id, title, artist, cover_url, release_type')
    .or(orClause)
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

  // Identify the user (if any) so the resolver can personalize the row mix.
  // Reading auth makes the page dynamic — the ISR cache only applies to anon
  // visitors, which is the right behavior (logged-in users get tailored rows).
  let userId: string | null = null;
  if (supabase) {
    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch { /* fall back to anon */ }
  }

  const categories = await getCategoriesForUser(supabase, userId);
  const sections: { key: string; name: string; description: string; albums: AlbumRelease[] }[] = [];

  for (const cat of categories) {
    let albums: AlbumRelease[] = [];

    // Primary: query our releases table by genre
    if (supabase) {
      try {
        albums = await fetchFromReleases(supabase, cat.genreFilters);
      } catch {}
    }

    // Fallback: curated_releases (manually seeded list)
    if (albums.length === 0 && supabase) {
      try {
        const { data } = await supabase
          .from('curated_releases')
          .select('release_id, title, artist, cover_url, release_type')
          .eq('category', cat.key)
          .not('release_type', 'ilike', 'single');

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

    // No live-Spotify fallback — if both DB sources are empty, the category is hidden.
    // Populate the DB via npm run backfill:genres / expand:genre / expand:related.
    // Threshold: hide rows that can't fill a respectable horizontal scroll — a row
    // with 1–5 albums looks broken and signals to the user that the DB is incomplete.
    if (albums.length >= 6) {
      sections.push({ key: cat.key, name: cat.name, description: cat.description, albums });
    }
  }

  if (sections.length === 0) return null;

  return <RecommendationGridClient sections={sections} />;
}

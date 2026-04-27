import ScrollRow from './ScrollRow';
import { createServerClient } from '../lib/supabaseServer';
import { getSpotifyRecommendations } from '../lib/spotify';
import type { AlbumRelease } from '../types';

const CATEGORIES = [
  { key: 'k-pop', name: 'K-Pop Sensations', description: 'Popular K-Pop albums you might enjoy' },
  { key: 'korean-indie', name: 'Korean Indie & Ballad', description: 'Thoughtful indie and ballad albums' },
  { key: 'korean-rb', name: 'Trending K-R&B', description: 'Smooth and soulful Korean R&B' },
];

const SPOTIFY_QUERIES: Record<string, string> = {
  'k-pop': 'k-pop',
  'korean-indie': 'korean indie',
  'korean-rb': 'korean r&b',
};

export default async function RecommendationGrid() {
  // ── Primary: serve from Supabase (no Spotify calls) ──────────────────────
  let sections: { key: string; name: string; description: string; albums: AlbumRelease[] }[] = [];

  try {
    const supabase = createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('curated_releases')
        .select('category, release_id, title, artist, cover_url, release_type')
        .in('category', CATEGORIES.map((c) => c.key));

      if (data && data.length > 0) {
        const grouped = new Map<string, AlbumRelease[]>();
        for (const row of data) {
          if (!grouped.has(row.category)) grouped.set(row.category, []);
          grouped.get(row.category)!.push({
            id: row.release_id,
            title: row.title,
            artist: row.artist,
            coverUrl: row.cover_url ?? null,
            releaseType: (row.release_type as AlbumRelease['releaseType']) ?? 'Album',
            date: null,
            country: null,
          });
        }
        sections = CATEGORIES
          .map((cat) => ({ ...cat, albums: grouped.get(cat.key) ?? [] }))
          .filter((s) => s.albums.length > 0);
      }
    }
  } catch {}

  // ── Fallback: Spotify (only if curated table is empty) ───────────────────
  if (sections.length === 0) {
    try {
      const spotifySections = await Promise.all(
        CATEGORIES.map(async (cat) => {
          const albums = await getSpotifyRecommendations(SPOTIFY_QUERIES[cat.key]);
          return { ...cat, albums };
        })
      );
      sections = spotifySections.filter((s) => s.albums.length > 0);
    } catch {}
  }

  if (sections.length === 0) return null;

  return (
    <section className="max-w-[1440px] mx-auto px-5 pb-14">
      {sections.map((cat, i) => (
        <div key={cat.key}>
          {i > 0 && <div className="h-px bg-[#EBEBEB] my-11" />}
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="text-[17px] font-bold text-ink">{cat.name}</div>
              <div className="text-[12px] text-muted mt-0.5">{cat.description}</div>
            </div>
          </div>
          <ScrollRow albums={cat.albums} />
        </div>
      ))}
    </section>
  );
}

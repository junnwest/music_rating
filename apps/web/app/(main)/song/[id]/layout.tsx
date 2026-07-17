import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists -- same pattern, song-specific tables.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = 'https://www.sillajuku.com';

interface RecordingRow {
  title: string;
  artist_display: string;
}

async function fetchRecording(id: string): Promise<RecordingRow | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/recordings?id=eq.${id}&select=title,artist_display`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: RecordingRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Matches the page's own community-average formula exactly (page.tsx's `scores` computation) --
// score only, no elo_score fallback. Unlike the album page, the song page's community average
// doesn't convert unrevealed Instinct-mode elo_score at all, so structured data has to mirror
// that same (narrower) formula or it'll show a number the page itself doesn't display. Capped at
// 2000 rows -- see album/[id]/layout.tsx's matching comment.
async function fetchRatingStats(recordingId: string): Promise<{ count: number; average: number | null }> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/track_ratings?recording_id=eq.${recordingId}&select=score&limit=2000`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: { score: number | null }[] = await res.json();
    const scores = (Array.isArray(rows) ? rows : []).map((r) => r.score).filter((s): s is number => s != null);
    if (scores.length === 0) return { count: 0, average: null };
    return { count: scores.length, average: scores.reduce((a, b) => a + b, 0) / scores.length };
  } catch {
    return { count: 0, average: null };
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const rec = await fetchRecording(params.id);
  if (!rec) {
    return { title: 'Song — sillajuku', description: 'Rate and discover music on sillajuku.' };
  }

  const { count } = await fetchRatingStats(params.id);
  const pageTitle = `${rec.title} by ${rec.artist_display} — sillajuku`;
  const description =
    count > 0
      ? `Rate "${rec.title}" by ${rec.artist_display}. Rated by ${count.toLocaleString()} ${count === 1 ? 'person' : 'people'} on sillajuku.`
      : `Rate "${rec.title}" by ${rec.artist_display} on sillajuku — every record you've loved, documented.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

// See album/[id]/layout.tsx's matching comment -- same soft-404 fix, plus AggregateRating
// JSON-LD. MusicRecording is explicitly on Google's documented list of supported types for the
// review/rating rich result (unlike MusicAlbum), so this one has a confirmed path to showing a
// star rating directly in search results.
export default async function SongLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const rec = await fetchRecording(params.id);
  if (!rec) notFound();

  const { count, average } = await fetchRatingStats(params.id);
  const jsonLd =
    count > 0 && average != null
      ? {
          '@context': 'https://schema.org',
          '@type': 'MusicRecording',
          name: rec.title,
          url: `${BASE_URL}/song/${params.id}`,
          byArtist: { '@type': 'MusicGroup', name: rec.artist_display },
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: average,
            bestRating: 5,
            worstRating: 0.5,
            ratingCount: count,
          },
        }
      : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      {children}
    </>
  );
}

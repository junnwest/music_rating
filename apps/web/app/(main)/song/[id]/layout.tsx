import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists -- same pattern, song-specific tables.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

async function fetchRatingCount(recordingId: string): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/track_ratings?recording_id=eq.${recordingId}&select=id`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          Prefer: 'count=exact',
          'Range-Unit': 'items',
          Range: '0-0',
        },
        next: { revalidate: 3600 },
      }
    );
    const contentRange = res.headers.get('content-range');
    if (!contentRange) return 0;
    const total = contentRange.split('/')[1];
    return total === '*' ? 0 : parseInt(total, 10);
  } catch {
    return 0;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const rec = await fetchRecording(params.id);
  if (!rec) {
    return { title: 'Song — sillajuku', description: 'Rate and discover music on sillajuku.' };
  }

  const count = await fetchRatingCount(params.id);
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

export default function SongLayout({ children }: { children: ReactNode }) {
  return children;
}

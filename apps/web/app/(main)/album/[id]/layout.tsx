import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// Every page on the site previously shared the root layout's static title/description
// ("sillajuku" / "Every record you've loved.") -- Google was substituting its own titles/
// snippets pulled from raw page content since the real <title>/<meta description> were
// identical (and thus useless) across every album/song/artist/mix page, which is why search
// results showed a repeated boilerplate snippet under unrelated titles. This is a Server
// Component layout (the page itself stays a client component, untouched) purely so
// generateMetadata has a place to run -- it renders nothing but `children`.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface ReleaseRow {
  title: string;
  artist_display: string;
  native_title: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
}

async function fetchRelease(id: string): Promise<ReleaseRow | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/release_groups?id=eq.${id}&select=title,artist_display,native_title,release_group_type,first_release_date`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: ReleaseRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchRatingCount(releaseGroupId: string): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?release_group_id=eq.${releaseGroupId}&select=id`,
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
  const release = await fetchRelease(params.id);
  if (!release) {
    return { title: 'Album — sillajuku', description: 'Rate and discover music on sillajuku.' };
  }

  const title = release.native_title || release.title;
  const artist = release.artist_display;
  const year = release.first_release_date ? new Date(release.first_release_date).getFullYear() : null;
  const typeLabel =
    release.release_group_type === 'ep' ? 'EP' : release.release_group_type === 'single' ? 'Single' : 'Album';
  const count = await fetchRatingCount(params.id);

  const pageTitle = `${title} by ${artist} — sillajuku`;
  const description =
    count > 0
      ? `Rate ${title} by ${artist}${year ? ` (${year})` : ''}. ${typeLabel} rated by ${count.toLocaleString()} ${count === 1 ? 'person' : 'people'} on sillajuku.`
      : `Rate ${title} by ${artist}${year ? ` (${year})` : ''} on sillajuku — every record you've loved, documented.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

// Confirmed live: /album/<anything-that-isn't-a-real-id> (e.g. a raw Spotify id someone linked
// to instead of our own uuid) returns HTTP 200 with a client-rendered "isn't in sillajuku's
// catalog yet" message -- a soft 404. Crawlers have no signal that the page is actually invalid,
// so it stays indexed indefinitely with a "doesn't exist" description forever. fetchRelease is
// already called in generateMetadata above; Next dedupes the identical fetch() call within the
// same request, so this is a cache hit, not a second real round-trip.
export default async function AlbumLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const release = await fetchRelease(params.id);
  if (!release) notFound();
  return children;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { eloToScore } from '../../../../lib/elo';

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

// Same score-or-elo-converted-to-score formula the page itself uses for its own displayed
// "community avg" (see page.tsx's `scored` computation) -- structured data has to match what's
// actually shown on the page, not an independently-computed number, or it risks a Google manual
// action for misleading markup. Capped at 2000 rows: this is an average, not the display list,
// so a bounded sample is fine even for a very popular album, and keeps this from ever becoming an
// unbounded fetch.
async function fetchRatingStats(releaseGroupId: string): Promise<{ count: number; average: number | null }> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?release_group_id=eq.${releaseGroupId}&select=score,elo_score&limit=2000`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: { score: number | null; elo_score: number | null }[] = await res.json();
    const scored = (Array.isArray(rows) ? rows : [])
      .map((r) => (r.score != null ? r.score : r.elo_score != null ? eloToScore(r.elo_score) : null))
      .filter((s): s is number => s != null);
    if (scored.length === 0) return { count: 0, average: null };
    return { count: scored.length, average: scored.reduce((a, b) => a + b, 0) / scored.length };
  } catch {
    return { count: 0, average: null };
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
  const { count } = await fetchRatingStats(params.id);

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
//
// Also renders AggregateRating JSON-LD (MusicAlbum) when there's at least one rating, so a real
// star rating can show directly in the Google search result instead of just a blue link -- per
// Next's own recommended pattern (script tag + JSON.stringify, escaping `<` to prevent the
// payload breaking out of the script tag via a malicious title/artist string). MusicAlbum isn't
// on Google's explicitly-documented supported-types list for the review rich result (only
// MusicRecording/MusicPlaylist are) -- included anyway since it's valid, harmless schema.org
// markup that costs nothing if Google doesn't use it for the star snippet specifically, and may
// already work today or in the future regardless of the doc gap. See song/[id]/layout.tsx for
// the type that's explicitly confirmed supported.
export default async function AlbumLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const release = await fetchRelease(params.id);
  if (!release) notFound();

  const { count, average } = await fetchRatingStats(params.id);
  const jsonLd =
    count > 0 && average != null
      ? {
          '@context': 'https://schema.org',
          '@type': 'MusicAlbum',
          name: release.native_title || release.title,
          byArtist: { '@type': 'MusicGroup', name: release.artist_display },
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

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { fetchRatingStats, fetchRelease } from './release';

// Every page on the site previously shared the root layout's static title/description
// ("sillajuku" / "Every record you've loved.") -- Google was substituting its own titles/
// snippets pulled from raw page content since the real <title>/<meta description> were
// identical (and thus useless) across every album/song/artist/mix page, which is why search
// results showed a repeated boilerplate snippet under unrelated titles. The per-album
// title/description now live in [lang]/page.tsx, since they depend on the language (2026-11-24).
const BASE_URL = 'https://www.sillajuku.com';

// Cached on the CDN, rendered on first request (ISR); see middleware.ts. An empty list = no pages
// built at deploy time. The 7-day revalidate is set in [lang]/page.tsx.
export function generateStaticParams() {
  return [];
}

// Confirmed live: /album/<anything-that-isn't-a-real-id> (e.g. a raw Spotify id someone linked
// to instead of our own uuid) returns HTTP 200 with a client-rendered "isn't in sillajuku's
// catalog yet" message -- a soft 404. Crawlers have no signal that the page is actually invalid,
// so it stays indexed indefinitely with a "doesn't exist" description forever. fetchRelease is
// also called in [lang]/page.tsx's generateMetadata; Next dedupes the identical fetch() call within the
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
          url: `${BASE_URL}/album/${params.id}`,
          byArtist: { '@type': 'MusicGroup', name: release.artist_display },
          ...(release.first_release_date ? { datePublished: release.first_release_date } : {}),
          ...(release.release_group_type === 'ep'
            ? { albumReleaseType: 'https://schema.org/EPRelease' }
            : release.release_group_type === 'album'
              ? { albumReleaseType: 'https://schema.org/AlbumRelease' }
              : {}),
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

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { fetchArtist, isUuidParam } from './artist';

// See album/[id]/layout.tsx for why this exists. The per-language title/description live in
// [lang]/page.tsx (2026-11-24); this keeps what doesn't depend on the language.
const BASE_URL = 'https://www.sillajuku.com';

// Cached on the CDN, rendered on first request (ISR); see middleware.ts and [lang]/page.tsx.
export function generateStaticParams() {
  return [];
}

// Name-slug URLs (anything that isn't an artists.id uuid) are noindex, follow (2026-11-12).
// They're a name search, not a canonical page -- the uuid page is the one in the sitemap -- and
// old links carrying raw Spotify artist ids land here too, which got pages titled
// "0K4MGKGmjtdIE0W3GkGmyU — sillajuku" into Google's index. `follow` keeps the album links on
// them crawlable.
export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return isUuidParam(params.id) ? {} : { robots: { index: false, follow: true } };
}

// See album/[id]/layout.tsx's matching comment -- same soft-404 fix, scoped to the unambiguous
// case only (see fetchArtist above). Also emits MusicGroup JSON-LD so Google can resolve the
// artist as a real entity (Knowledge Panel / rich result) -- the artist counterpart to the
// site-wide Organization markup and the album/song AggregateRating markup already shipped.
export default async function ArtistLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const { name, coverUrl, isMissingId } = await fetchArtist(params.id);
  if (isMissingId) notFound();

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name,
    url: `${BASE_URL}/artist/${params.id}`,
  };
  if (coverUrl) jsonLd.image = coverUrl;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      {children}
    </>
  );
}

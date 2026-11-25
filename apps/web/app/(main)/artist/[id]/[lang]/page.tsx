import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArtistPageClient from '../ArtistPageClient';
import { fetchArtist } from '../artist';
import { loadArtistInitial } from '../../../../../lib/sj/serverCatalog';
import { ServerLanguage } from '../../../../../lib/i18n';

// Server wrapper (2026-11-12): sends the artist's name, photo, stats and discography in the first
// HTML (crawlers used to get "Artist — community avg 0 · 0 ratings" and a dash for the name).
// Name-slug URLs (not a uuid) get null and load in the browser as before; they're noindex anyway.
// Keyed by id so moving between artists remounts with that artist's data.
//
// Cached on the CDN for 7 days, one copy per language; see album/[id]/[lang]/page.tsx and
// middleware.ts (2026-11-24).
export const revalidate = 604800;

type Lang = 'en' | 'ko';
type Params = { id: string; lang: string };

function langOf(params: Params): Lang {
  if (params.lang !== 'en' && params.lang !== 'ko') notFound();
  return params.lang;
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const ko = langOf(params) === 'ko';
  const { name } = await fetchArtist(params.id);
  const pageTitle = `${name} — sillajuku`;
  const description = ko
    ? `${name}의 디스코그래피와 앨범별 커뮤니티 평점, 리뷰를 sillajuku에서 확인하세요.`
    : `Explore ${name}'s discography, community ratings, and reviews on sillajuku.`;
  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

export default async function ArtistPage({ params }: { params: Params }) {
  const lang = langOf(params);
  const initial = await loadArtistInitial(decodeURIComponent(params.id));
  // Korean HTML for Korean visitors / crawlers; see ServerLanguage.
  return (
    <ServerLanguage lang={lang}>
      <ArtistPageClient key={params.id} initial={initial} />
    </ServerLanguage>
  );
}

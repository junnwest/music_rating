import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AlbumPageClient from '../AlbumPageClient';
import { fetchRatingStats, fetchRelease } from '../release';
import { loadAlbumInitial } from '../../../../../lib/sj/serverCatalog';
import { ServerLanguage } from '../../../../../lib/i18n';

// Server wrapper (2026-11-12): fetches the album's public data so the first HTML has the title,
// artist, tracklist and community score -- crawlers used to get only the nav and an empty shell.
// The interactive page is AlbumPageClient. Keyed by id so moving between albums remounts it with
// that album's data instead of keeping the previous one's state.
//
// /album/<id> is rewritten here by middleware.ts with the visitor's language, so this page reads
// no cookies or headers and is cached on the CDN (2026-11-24). 7 days: crawlers were ~94% of all
// server work, and the client page refetches scores after hydration, so only crawlers ever read
// the cached numbers. Literal, not an imported constant: Next reads route config statically.
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

  const typeKo =
    release.release_group_type === 'ep' ? 'EP' : release.release_group_type === 'single' ? '싱글' : '앨범';
  const pageTitle = ko ? `${artist} - ${title} 평점 · 리뷰 — sillajuku` : `${title} by ${artist} — sillajuku`;
  const description = ko
    ? count > 0
      ? `${artist}의 ${typeKo} ${title}${year ? ` (${year})` : ''}. sillajuku에서 ${count.toLocaleString()}명이 평가했어요. 평점과 리뷰를 보고 직접 평가해 보세요.`
      : `${artist}의 ${typeKo} ${title}${year ? ` (${year})` : ''} 평점과 리뷰. sillajuku에서 직접 평가해 보세요.`
    : count > 0
      ? `Rate ${title} by ${artist}${year ? ` (${year})` : ''}. ${typeLabel} rated by ${count.toLocaleString()} ${count === 1 ? 'person' : 'people'} on sillajuku.`
      : `Rate ${title} by ${artist}${year ? ` (${year})` : ''} on sillajuku — every record you've loved, documented.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

// layout.tsx already 404s an id with no release group.
export default async function AlbumPage({ params }: { params: Params }) {
  const lang = langOf(params);
  const initial = await loadAlbumInitial(params.id);
  // Korean HTML for Korean visitors / crawlers; see ServerLanguage.
  return (
    <ServerLanguage lang={lang}>
      <AlbumPageClient key={params.id} initial={initial} />
    </ServerLanguage>
  );
}

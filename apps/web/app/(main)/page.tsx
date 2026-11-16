import type { Metadata } from 'next';
import HomePageClient from './HomePageClient';
import { ServerLanguage } from '../../lib/i18n';
import { getServerLang } from '../../lib/i18n/server';

// Server wrapper (2026-11-16) so the homepage's title/description follow the visitor's language
// (sj-lang cookie, else Accept-Language): Korean for Korean visitors and Naver's crawler, English
// for everyone else including Googlebot. Both fit Naver Search Advisor's limits (title <= 40
// characters, description <= 80). Reading the cookie makes this one route render per request
// instead of being served as cached HTML -- a light render, since the feed itself still loads in
// the browser (HomePageClient). Other routes keep the root layout's English defaults.
const COPY = {
  en: {
    title: 'sillajuku — Rate albums, map your taste',
    description: 'Rate and review albums, see community scores, and map your music taste.',
  },
  ko: {
    title: 'sillajuku — 앨범 평가와 음악 취향 지도',
    description: '앨범과 곡을 평가하고 리뷰하며 나만의 음악 취향 지도를 만들어 보세요.',
  },
} as const;

export function generateMetadata(): Metadata {
  const { title, description } = COPY[getServerLang()];
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default function HomePage() {
  return (
    <ServerLanguage lang={getServerLang()}>
      <HomePageClient />
    </ServerLanguage>
  );
}

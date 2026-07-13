import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists. Charts are a fixed set of slugs (no DB
// lookup needed, unlike the other dynamic routes) -- just a static label map.
const CHART_LABELS: Record<string, string> = {
  'top-rated': 'Top Rated',
  'most-rated': 'Most Rated',
  'hidden-gems': 'Hidden Gems',
  controversial: 'Controversial',
  trending: 'Trending',
  ranking: 'Rankings',
};

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const label = CHART_LABELS[params.slug] ?? 'Charts';
  const pageTitle = `${label} — sillajuku Charts`;
  const description = `See the ${label.toLowerCase()} albums and songs, ranked by the sillajuku community.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

export default function ChartSlugLayout({ children }: { children: ReactNode }) {
  return children;
}

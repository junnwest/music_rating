import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../../lib/supabaseServer';
import RankBuilder, { type RankedAlbum } from '../../../../../components/RankBuilder';
import { getServerT } from '../../../../../lib/i18n/server';

export const revalidate = 0;


export default async function RankBuilderPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { album?: string; title?: string; artist?: string; cover?: string };
}) {
  const t = getServerT();
  const supabase = createServerClient();
  if (!supabase) notFound();

  const { data: category } = await supabase
    .from('ranking_categories')
    .select('id, slug, title, genre, year')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!category) notFound();

  const { data: seedEntries } = await supabase
    .from('ranking_seed_entries')
    .select('release_id')
    .eq('category_id', category.id)
    .order('seed_votes', { ascending: false })
    .limit(60);

  const seedIds = (seedEntries ?? []).map((s: { release_id: string }) => s.release_id);
  const suggestions: RankedAlbum[] = [];
  if (seedIds.length) {
    const { data: seedReleases } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url')
      .in('id', seedIds);
    const releaseMap = new Map((seedReleases ?? []).map((r) => [r.id, r]));
    for (const id of seedIds) {
      const r = releaseMap.get(id);
      if (r) suggestions.push({ id: r.id, title: r.title, artist: r.artist, coverUrl: r.cover_url });
    }
  }

  const prefillAlbum: RankedAlbum | null = searchParams.album
    ? {
        id: searchParams.album,
        title: searchParams.title ?? '',
        artist: searchParams.artist ?? '',
        coverUrl: searchParams.cover ?? null,
      }
    : null;

  return (
    <div style={{ minHeight: '100vh' }}>
      <RankBuilder
        categoryId={category.id}
        categoryTitle={(() => { const k = `rankingTitles.${category.slug}`; const r = t(k); return r === k ? category.title : r; })()}
        slug={category.slug}
        initialSuggestions={suggestions}
        filterYear={category.year ?? null}
        filterGenre={category.genre ?? null}
        prefillAlbum={prefillAlbum}
      />
    </div>
  );
}

import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../../lib/supabaseServer';
import RankBuilder, { type RankedAlbum } from '../../../../../components/RankBuilder';

export const revalidate = 0;


export default async function RankBuilderPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { album?: string; title?: string; artist?: string; cover?: string };
}) {
  const supabase = createServerClient();
  if (!supabase) notFound();

  const { data: category } = await supabase
    .from('ranking_categories')
    .select('id, slug, title, genre, year')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!category) notFound();

  // Build prestige query — year-filtered only (genres missing on 58% of rows, too aggressive)
  let prestigeQuery = supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .order('prestige', { ascending: false })
    .limit(40);
  if (category.year) prestigeQuery = prestigeQuery.like('release_date', `${category.year}%`);

  // Suggestions: top voted albums for this category + filtered high-prestige releases
  const [{ data: votes }, { data: topReleases }] = await Promise.all([
    supabase.from('ranking_votes').select('release_id').eq('category_id', category.id),
    prestigeQuery,
  ]);

  // Tally voted releases and fetch their details
  const voteTally = new Map<string, number>();
  for (const v of votes ?? []) voteTally.set(v.release_id, (voteTally.get(v.release_id) ?? 0) + 1);
  const topVotedIds = [...voteTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);

  let votedReleases: RankedAlbum[] = [];
  if (topVotedIds.length) {
    const { data } = await supabase.from('releases').select('id, title, artist, cover_url').in('id', topVotedIds);
    votedReleases = (data ?? []).map(r => ({ id: r.id, title: r.title, artist: r.artist, coverUrl: r.cover_url }));
  }

  const topByPrestige: RankedAlbum[] = (topReleases ?? []).map(r => ({
    id: r.id, title: r.title, artist: r.artist, coverUrl: r.cover_url,
  }));

  // Merge: voted albums first, then fill with prestige, dedupe
  const seen = new Set<string>();
  const suggestions: RankedAlbum[] = [];
  for (const a of [...votedReleases, ...topByPrestige]) {
    if (!seen.has(a.id)) { seen.add(a.id); suggestions.push(a); }
    if (suggestions.length >= 40) break;
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
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <RankBuilder
        categoryId={category.id}
        categoryTitle={category.title}
        slug={category.slug}
        initialSuggestions={suggestions}
        filterYear={category.year ?? null}
        filterGenre={category.genre ?? null}
        prefillAlbum={prefillAlbum}
      />
    </div>
  );
}

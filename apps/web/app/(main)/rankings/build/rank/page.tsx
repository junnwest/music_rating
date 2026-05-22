import { redirect } from 'next/navigation';
import { createServerClient } from '../../../../../lib/supabaseServer';

const countryToMarket: Record<string, string> = {
  'South Korea': 'KR',
  'Japan': 'JP',
  'United States': 'US',
  'United Kingdom': 'GB',
  'Canada': 'CA',
  'Australia': 'AU',
  'France': 'FR',
  'Germany': 'DE',
  'Brazil': 'BR',
  'Nigeria': 'NG',
};

function makeSlug(country: string, genre: string, time: string): string {
  const parts: string[] = [];
  if (country !== 'Global') parts.push(country);
  if (genre !== 'All Genres') parts.push(genre);
  if (time !== 'All Time') parts.push(time);
  if (parts.length === 0) return 'all-time';
  return parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('-');
}

function makeTitle(country: string, genre: string, time: string): string {
  const parts: string[] = ['Greatest'];
  if (country !== 'Global') parts.push(country);
  if (genre !== 'All Genres') parts.push(genre);
  else if (country === 'Global') parts.push('Albums');
  else parts.push('Albums');
  if (time !== 'All Time') parts.push(`of the ${time}`);
  else parts.push('of All Time');
  return parts.join(' ');
}

export default async function BuildRankPage({
  searchParams,
}: {
  searchParams: { country?: string; genre?: string; time?: string };
}) {
  const country = searchParams.country ?? 'Global';
  const genre = searchParams.genre ?? 'All Genres';
  const time = searchParams.time ?? 'All Time';
  const slug = makeSlug(country, genre, time);

  const supabase = createServerClient();
  if (!supabase) redirect('/rankings');

  // Check if a category already exists for this combination
  const { data: existing } = await supabase
    .from('ranking_categories')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();

  const market = countryToMarket[country];
  const marketSuffix = market ? `?market=${market}` : '';

  if (existing) {
    redirect(`/rankings/${existing.slug}/rank${marketSuffix}`);
  }

  // Create the category
  const title = makeTitle(country, genre, time);
  const yearNum = (() => {
    const n = parseInt(time, 10);
    return !isNaN(n) && n > 1900 && n < 2100 ? n : null;
  })();

  const { data: created } = await supabase
    .from('ranking_categories')
    .insert({
      slug,
      title,
      genre: genre !== 'All Genres' ? genre : null,
      year: yearNum,
    })
    .select('slug')
    .single();

  // If insert failed (e.g. race condition), fall back to the slug
  redirect(`/rankings/${created?.slug ?? slug}/rank${marketSuffix}`);
}

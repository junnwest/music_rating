import Link from 'next/link';
import { createServerClient } from '../../../../lib/supabaseServer';

export const revalidate = 60;

function generateTitle(country: string, genre: string, time: string): string {
  const parts: string[] = ['Greatest'];
  if (country !== 'Global') parts.push(country);
  if (genre !== 'All Genres') parts.push(genre);
  else if (country === 'Global') parts.push('Albums');
  else parts.push('Albums');
  if (time !== 'All Time') parts.push(`of the ${time}`);
  else if (parts.length === 2) parts.push('of All Time');
  if (parts.length === 1) parts.push('Albums of All Time');
  return parts.join(' ');
}

export default async function RankingsBuildPage({
  searchParams,
}: {
  searchParams: { country?: string; genre?: string; time?: string };
}) {
  const country = searchParams.country ?? 'Global';
  const genre = searchParams.genre ?? 'All Genres';
  const time = searchParams.time ?? 'All Time';
  const title = generateTitle(country, genre, time);

  const supabase = createServerClient();
  let matchingCategories: { id: string; slug: string; title: string; description: string | null }[] = [];

  if (supabase) {
    let query = supabase
      .from('ranking_categories')
      .select('id, slug, title, description')
      .order('sort_order')
      .limit(12);

    if (genre !== 'All Genres') {
      query = query.ilike('genre', `%${genre}%`);
    }

    const { data } = await query;
    matchingCategories = data ?? [];
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1100px] mx-auto px-5 py-12 md:py-16">
          <Link href="/rankings" className="text-[13px] text-muted hover:text-ink transition inline-flex items-center gap-1.5 mb-6">
            ← Back to Rankings
          </Link>
          <div className="flex flex-wrap gap-2 mb-4">
            {country !== 'Global' && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted">{country}</span>
            )}
            {genre !== 'All Genres' && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted">{genre}</span>
            )}
            {time !== 'All Time' && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted">{time}</span>
            )}
          </div>
          <h1 className="text-[36px] md:text-[44px] font-extrabold text-ink tracking-tight leading-[1.05]">
            {title}
          </h1>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-5 py-10 pb-20">
        {matchingCategories.length > 0 ? (
          <>
            <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
              Matching Rankings
            </h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {matchingCategories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/rankings/${cat.slug}`}
                  className="block border border-divider rounded-xl p-4 hover:border-mid hover:shadow-sm transition bg-white group"
                >
                  <p className="text-[14px] font-bold text-ink group-hover:text-mid transition-colors">{cat.title}</p>
                  {cat.description && (
                    <p className="text-[12px] text-muted mt-1 line-clamp-2">{cat.description}</p>
                  )}
                  <p className="text-[12px] font-semibold text-ink mt-3">Vote →</p>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="py-20 text-center">
            <p className="text-[16px] font-bold text-ink mb-2">No rankings found yet</p>
            <p className="text-[14px] text-muted max-w-[380px] mx-auto mb-6">
              There are no community rankings for this filter combination yet.
            </p>
            <Link
              href="/rankings"
              className="bg-ink text-white rounded-xl px-6 py-3 text-[13px] font-bold hover:opacity-80 transition inline-block"
            >
              Explore All Rankings
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

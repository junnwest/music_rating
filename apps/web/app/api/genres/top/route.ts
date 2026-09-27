import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { GENRE_KEYWORD_MAP } from '../../../../lib/canon-suggestions';

export async function GET() {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ genres: Object.keys(GENRE_KEYWORD_MAP) });
  }

  // Live genre data is release_groups.genres (text[]); the legacy releases.genres
  // comma-string column is frozen/dead post-renovation. Read the array form and
  // flatten each group's tags to one lowercased haystack for keyword matching.
  const { data } = await supabase
    .from('release_groups')
    .select('genres')
    .not('genres', 'is', null);

  const allGenreStrings = (data ?? []).map((r: { genres: string[] | null }) =>
    (r.genres ?? []).join(' ').toLowerCase(),
  );

  const counts: Record<string, number> = {};
  for (const [label, keywords] of Object.entries(GENRE_KEYWORD_MAP)) {
    counts[label] = allGenreStrings.filter((g: string) =>
      keywords.some((k) => g.includes(k))
    ).length;
  }

  const sorted = Object.keys(GENRE_KEYWORD_MAP).sort(
    (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)
  );

  return NextResponse.json({ genres: sorted });
}

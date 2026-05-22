import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

const CATEGORIES = [
  {
    slug: 'all-time',
    title: 'Greatest Album of All Time',
    description: 'The one album you would hand to someone who asked you what music is all about.',
    genre: null,
    year: null,
    sort_order: 0,
  },
  {
    slug: 'hiphop-all-time',
    title: 'Best Hip-Hop Album of All Time',
    description: 'The definitive rap record. One vote per listener.',
    genre: 'Hip-Hop',
    year: null,
    sort_order: 1,
  },
  {
    slug: 'kpop-all-time',
    title: 'Best K-Pop Album of All Time',
    description: 'The K-Pop album that stands above the rest. One vote per listener.',
    genre: 'K-Pop',
    year: null,
    sort_order: 2,
  },
  {
    slug: 'album-2025',
    title: 'Best Album of 2025',
    description: 'The essential listen of the year — any genre, any country. One vote per listener.',
    genre: null,
    year: 2025,
    sort_order: 3,
  },
  {
    slug: 'korean-all-time',
    title: 'Best Korean Album of All Time',
    description: 'The greatest album to come out of Korea, any genre. One vote per listener.',
    genre: null,
    year: null,
    sort_order: 4,
  },
  {
    slug: 'khiphop-all-time',
    title: 'Best K-Hip-Hop Album of All Time',
    description: 'The rap record that put Korean hip-hop on the map. One vote per listener.',
    genre: 'K-Hip-Hop',
    year: null,
    sort_order: 5,
  },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret');
  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { error } = await supabase.from('ranking_categories').upsert(CATEGORIES, {
    onConflict: 'slug',
    ignoreDuplicates: false,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, seeded: CATEGORIES.length });
}

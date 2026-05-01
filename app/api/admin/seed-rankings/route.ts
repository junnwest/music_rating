import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

const CATEGORIES = [
  {
    slug: 'album-2024',
    title: 'Best Album of 2024',
    description: 'The essential listen of the year — any genre, any country. One vote per listener.',
    genre: null,
    year: 2024,
    sort_order: 0,
  },
  {
    slug: 'kpop-2024',
    title: 'Best K-Pop Album of 2024',
    description: 'The album that defined K-Pop in 2024. One vote per listener.',
    genre: 'K-Pop',
    year: 2024,
    sort_order: 1,
  },
  {
    slug: 'krap-2024',
    title: 'Best K-Rap Album of 2024',
    description: 'The essential K-Rap project of the year. Cast your pick.',
    genre: 'K-Rap',
    year: 2024,
    sort_order: 2,
  },
  {
    slug: 'krb-2024',
    title: 'Best K-R&B Album of 2024',
    description: 'The smoothest, deepest R&B record to come out of Korea in 2024.',
    genre: 'K-R&B',
    year: 2024,
    sort_order: 3,
  },
  {
    slug: 'kindie-2024',
    title: 'Best K-Indie Album of 2024',
    description: 'The standout indie release from Korea in 2024.',
    genre: 'K-Indie',
    year: 2024,
    sort_order: 4,
  },
  {
    slug: 'indie-2024',
    title: 'Best Indie Album of 2024',
    description: 'The most essential independent release of the year from anywhere in the world.',
    genre: 'Indie',
    year: 2024,
    sort_order: 5,
  },
  {
    slug: 'hiphop-2024',
    title: 'Best Hip-Hop Album of 2024',
    description: 'The rap record that hit hardest this year.',
    genre: 'Hip-Hop',
    year: 2024,
    sort_order: 6,
  },
  {
    slug: 'all-time',
    title: 'Greatest Album of All Time',
    description: 'The one album you would hand to someone who asked you what music is all about.',
    genre: null,
    year: null,
    sort_order: 99,
  },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret');
  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { error } = await supabase
    .from('ranking_categories')
    .upsert(CATEGORIES, { onConflict: 'slug' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, seeded: CATEGORIES.length });
}

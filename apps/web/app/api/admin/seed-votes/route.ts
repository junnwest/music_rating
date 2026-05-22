import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

interface SeedEntry {
  categorySlug: string;
  releaseId: string;
  releaseTitle: string;
  releaseArtist: string;
  releaseCoverUrl: string | null;
  releaseType: string;
  seedVotes: number;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret');
  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { entries }: { entries: SeedEntry[] } = await req.json();
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'No entries provided' }, { status: 400 });
  }

  // Resolve category slugs → ids
  const slugs = [...new Set(entries.map((e) => e.categorySlug))];
  const { data: cats, error: catErr } = await supabase
    .from('ranking_categories')
    .select('id, slug')
    .in('slug', slugs);
  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });

  const catIdBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));

  // Upsert releases
  const releases = entries.map((e) => ({
    id: e.releaseId,
    title: e.releaseTitle,
    artist: e.releaseArtist,
    cover_url: e.releaseCoverUrl ?? null,
    release_type: e.releaseType,
  }));
  await supabase.from('releases').upsert(releases, { onConflict: 'id' });

  // Upsert seed entries
  const seedRows = entries
    .map((e) => {
      const categoryId = catIdBySlug.get(e.categorySlug);
      if (!categoryId) return null;
      return { category_id: categoryId, release_id: e.releaseId, seed_votes: e.seedVotes };
    })
    .filter(Boolean);

  const { error: seedErr } = await supabase
    .from('ranking_seed_entries')
    .upsert(seedRows as any[], { onConflict: 'category_id,release_id' });

  if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, seeded: seedRows.length });
}

export async function DELETE(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret');
  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { categorySlug } = await req.json().catch(() => ({}));

  let query = supabase.from('ranking_seed_entries').delete();
  if (categorySlug) {
    const { data: cat } = await supabase
      .from('ranking_categories')
      .select('id')
      .eq('slug', categorySlug)
      .maybeSingle();
    if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    query = query.eq('category_id', cat.id) as any;
  } else {
    query = query.neq('id', '00000000-0000-0000-0000-000000000000') as any;
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const categoryId = req.nextUrl.searchParams.get('categoryId');
  const userId = req.nextUrl.searchParams.get('userId');
  if (!categoryId || !userId) return NextResponse.json({ tiers: null });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ tiers: null });

  const { data: ranking } = await supabase
    .from('user_rankings')
    .select('id')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .maybeSingle();

  if (!ranking) return NextResponse.json({ tiers: null });

  const { data: entries } = await supabase
    .from('user_ranking_entries')
    .select('release_id, rank')
    .eq('ranking_id', ranking.id)
    .order('rank');

  if (!entries?.length) return NextResponse.json({ tiers: null });

  const releaseIds = entries.map((e) => e.release_id);
  const { data: releases } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .in('id', releaseIds);

  const releaseById = new Map((releases ?? []).map((r) => [r.id, r]));

  // Group into tiers
  const tierMap = new Map<number, { id: string; title: string; artist: string; coverUrl: string | null }[]>();
  for (const entry of entries) {
    const rel = releaseById.get(entry.release_id);
    if (!rel) continue;
    if (!tierMap.has(entry.rank)) tierMap.set(entry.rank, []);
    tierMap.get(entry.rank)!.push({ id: rel.id, title: rel.title, artist: rel.artist, coverUrl: rel.cover_url });
  }

  const tiers = [...tierMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, albums]) => albums);

  return NextResponse.json({ tiers });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { userId, categoryId, entries } = await req.json();
  if (!userId || !categoryId || !Array.isArray(entries)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Enforce max 5 albums per tier
  const tierCounts = new Map<number, number>();
  for (const e of entries) tierCounts.set(e.rank, (tierCounts.get(e.rank) ?? 0) + 1);
  if ([...tierCounts.values()].some(c => c > 5)) {
    return NextResponse.json({ error: 'Max 5 albums per tier' }, { status: 400 });
  }

  // Upsert releases
  const releases = entries
    .filter((e) => e.title && e.artist)
    .map((e) => ({ id: e.releaseId, title: e.title, artist: e.artist, cover_url: e.coverUrl ?? null, release_type: 'Album' }));
  if (releases.length) {
    await supabase.from('releases').upsert(releases, { onConflict: 'id' });
  }

  // Upsert user_rankings row
  const { data: ranking, error: rankErr } = await supabase
    .from('user_rankings')
    .upsert({ user_id: userId, category_id: categoryId, updated_at: new Date().toISOString() }, { onConflict: 'user_id,category_id' })
    .select('id')
    .single();

  if (rankErr || !ranking) return NextResponse.json({ error: rankErr?.message ?? 'Failed' }, { status: 500 });

  // Replace entries
  await supabase.from('user_ranking_entries').delete().eq('ranking_id', ranking.id);
  if (entries.length) {
    await supabase.from('user_ranking_entries').insert(
      entries.map((e: { releaseId: string; rank: number }) => ({
        ranking_id: ranking.id,
        release_id: e.releaseId,
        rank: e.rank,
      }))
    );
  }

  // Keep community ranking_votes in sync with rank-1 pick
  const topPick = entries.find((e: { rank: number }) => e.rank === 1);
  await supabase.from('ranking_votes').delete().eq('user_id', userId).eq('category_id', categoryId);
  if (topPick) {
    await supabase.from('ranking_votes').insert({ user_id: userId, category_id: categoryId, release_id: topPick.releaseId });
  }

  return NextResponse.json({ ok: true });
}

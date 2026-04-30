import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { searchSpotifyAlbums } from '../../../../lib/spotify';

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const body = await req.json();
  const { userId, categoryId, releaseId, releaseTitle, releaseArtist, releaseCoverUrl, releaseType } = body;

  if (!userId || !categoryId || !releaseId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Ensure release exists in releases table (insert if missing, ignore duplicate)
  if (releaseTitle && releaseArtist) {
    await supabase.from('releases').insert({
      id: releaseId,
      title: releaseTitle,
      artist: releaseArtist,
      cover_url: releaseCoverUrl ?? null,
      release_type: releaseType ?? 'Album',
    });
    // ignore duplicate key error — release already cached
  }

  // Delete any existing vote for this user + category, then insert new vote
  await supabase
    .from('ranking_votes')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId);

  const { error } = await supabase
    .from('ranking_votes')
    .insert({ user_id: userId, category_id: categoryId, release_id: releaseId });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { userId, categoryId } = await req.json();
  if (!userId || !categoryId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  await supabase
    .from('ranking_votes')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId);

  return NextResponse.json({ ok: true });
}

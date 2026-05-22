import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { searchSpotifyAlbums } from '../../../../lib/spotify';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheDel } from '../../../../lib/cache';

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'rankings-vote', 30, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const body = await req.json();
  const { userId, categoryId, releaseId, releaseTitle, releaseArtist, releaseCoverUrl, releaseType } = body;

  if (!userId || !categoryId || !releaseId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId || authedId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
  cacheDel(`sj:ranking:scores:${categoryId}`).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { userId, categoryId } = await req.json();
  if (!userId || !categoryId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId || authedId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await supabase
    .from('ranking_votes')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId);

  cacheDel(`sj:ranking:scores:${categoryId}`).catch(() => {});
  return NextResponse.json({ ok: true });
}

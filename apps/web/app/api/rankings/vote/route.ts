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

  const RELEASE_TYPE_MAP: Record<string, string> = {
    album: 'Album', single: 'Single', ep: 'EP', compilation: 'Compilation', live: 'Live',
  };
  const normalizedType = releaseType
    ? (RELEASE_TYPE_MAP[releaseType.toLowerCase()] ?? 'Album')
    : 'Album';

  // Ensure release exists in releases table and resolve to a UUID.
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(releaseId);
  let finalReleaseId: string = releaseId;

  if (releaseTitle && releaseArtist) {
    if (isUUID) {
      // Release should already be in DB (saved during search); insert only if missing
      await supabase.from('releases').insert({
        id: releaseId,
        title: releaseTitle,
        artist: releaseArtist,
        cover_url: releaseCoverUrl ?? null,
        release_type: normalizedType,
      });
      // Supabase returns error on duplicate key — silently ignored (no error check)
    } else {
      // Non-UUID (Spotify ID) — upsert and get the DB-assigned UUID so the vote
      // uses the same ID as all other release_id references
      const { data: upserted } = await supabase.from('releases').upsert(
        {
          spotify_id:       releaseId,
          title:            releaseTitle,
          artist:           releaseArtist,
          cover_url:        releaseCoverUrl ?? null,
          release_type:     normalizedType,
          canonical_source: 'spotify',
        },
        { onConflict: 'spotify_id' }
      ).select('id').single();
      if (upserted?.id) finalReleaseId = upserted.id;
    }
  }

  // Delete any existing vote for this user + category, then insert new vote
  await supabase
    .from('ranking_votes')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId);

  const { error } = await supabase
    .from('ranking_votes')
    .insert({ user_id: userId, category_id: categoryId, release_id: finalReleaseId });

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

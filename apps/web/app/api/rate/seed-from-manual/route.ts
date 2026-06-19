import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { starToElo, IMPORT_GAMES } from '../../../../lib/elo';

/**
 * Instinct rating mode — import a user's existing Manual (star) ratings as Elo
 * seeds when they switch Manual → Instinct.
 *
 * For every rating that has a star `score` but no `elo_score` yet, seed
 * `elo_score = starToElo(score)` and credit `IMPORT_GAMES` so the imported
 * score drifts slowly (stable K-factor) rather than lurching. The
 * `elo_score IS NULL` guard makes this idempotent and means comparison-earned
 * Elo is never overwritten (safe across repeated mode switches).
 *
 * The user is taken from the Authorization header, never the body.
 * See WEB_PARITY.md §4 and lib/elo.ts.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'rate-seed', 10, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Only Instinct-mode users seed Elo. (The client flips rating_mode to
  // 'instinct' together with this call, but verify server-side too.)
  const { data: profile } = await supabase
    .from('profiles')
    .select('rating_mode')
    .eq('id', userId)
    .single();
  if (profile?.rating_mode !== 'instinct') {
    return NextResponse.json({ error: 'Not in Instinct rating mode' }, { status: 400 });
  }

  // Pull the importable rows (star score set, no Elo yet) for albums AND songs.
  const [albumRes, songRes] = await Promise.all([
    supabase.from('ratings')
      .select('release_id, score')
      .eq('user_id', userId).not('score', 'is', null).is('elo_score', null),
    supabase.from('track_ratings')
      .select('release_id, track_position, track_title, score')
      .eq('user_id', userId).not('score', 'is', null).is('elo_score', null),
  ]);

  if (albumRes.error) return NextResponse.json({ error: albumRes.error.message }, { status: 500 });
  if (songRes.error) return NextResponse.json({ error: songRes.error.message }, { status: 500 });

  // Albums → ratings (keyed by user_id,release_id; `status` is NOT NULL).
  const albumUpdates = (albumRes.data ?? []).map((r) => ({
    user_id: userId,
    release_id: r.release_id,
    elo_score: starToElo(Number(r.score)),
    elo_games: IMPORT_GAMES,
    status: 'Listened',
  }));

  // Songs → track_ratings (keyed by user_id,release_id,track_position; track_title
  // is NOT NULL and is checked on the proposed insert tuple before ON CONFLICT).
  const songUpdates = (songRes.data ?? []).map((r) => ({
    user_id: userId,
    release_id: r.release_id,
    track_position: r.track_position,
    track_title: r.track_title,
    elo_score: starToElo(Number(r.score)),
    elo_games: IMPORT_GAMES,
  }));

  if (albumUpdates.length > 0) {
    const { error } = await supabase.from('ratings').upsert(albumUpdates, { onConflict: 'user_id,release_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (songUpdates.length > 0) {
    const { error } = await supabase.from('track_ratings').upsert(songUpdates, { onConflict: 'user_id,release_id,track_position' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    seeded: albumUpdates.length + songUpdates.length,
    seededAlbums: albumUpdates.length,
    seededSongs: songUpdates.length,
  });
}

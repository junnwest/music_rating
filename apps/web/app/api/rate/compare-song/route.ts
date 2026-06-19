import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { updateElo } from '../../../../lib/elo';

/**
 * Instinct rating mode (songs) — record one song-vs-song comparison.
 *
 * Body: { winner, loser } where each is { releaseId, position, title }. Songs are
 * keyed by (release_id, track_position) in `track_ratings`. The user comes from
 * the Authorization header, never the body. Per-type Instinct: songs are logged
 * to `track_pairwise_comparisons`, separate from albums. Mirrors /api/rate/compare.
 */
type SongRef = { releaseId: string; position: number; title?: string };

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'rate-compare-song', 120, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { winner, loser } = (await req.json()) as { winner?: SongRef; loser?: SongRef };
  if (!winner?.releaseId || winner?.position == null || !loser?.releaseId || loser?.position == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (winner.releaseId === loser.releaseId && winner.position === loser.position) {
    return NextResponse.json({ error: 'Cannot compare a song with itself' }, { status: 400 });
  }

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: profile } = await supabase
    .from('profiles').select('rating_mode').eq('id', userId).single();
  if (profile?.rating_mode !== 'instinct') {
    return NextResponse.json({ error: 'Not in Instinct rating mode' }, { status: 400 });
  }

  // Current Elo for both songs (rows should exist; default if not).
  const { data: rows, error: fetchError } = await supabase
    .from('track_ratings')
    .select('release_id, track_position, elo_score, elo_games')
    .eq('user_id', userId)
    .or(
      `and(release_id.eq.${winner.releaseId},track_position.eq.${winner.position}),` +
      `and(release_id.eq.${loser.releaseId},track_position.eq.${loser.position})`,
    );
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const find = (rid: string, pos: number) =>
    rows?.find((r) => r.release_id === rid && r.track_position === pos);
  const wRow = find(winner.releaseId, winner.position);
  const lRow = find(loser.releaseId, loser.position);

  const result = updateElo(
    { score: wRow?.elo_score, games: wRow?.elo_games },
    { score: lRow?.elo_score, games: lRow?.elo_games },
  );

  // track_title is NOT NULL and Postgres checks it on the proposed insert tuple
  // before ON CONFLICT, so it must be supplied even when the row already exists.
  const { error: upsertError } = await supabase.from('track_ratings').upsert(
    [
      { user_id: userId, release_id: winner.releaseId, track_position: winner.position, track_title: winner.title ?? '', elo_score: result.winner.score, elo_games: result.winner.games },
      { user_id: userId, release_id: loser.releaseId, track_position: loser.position, track_title: loser.title ?? '', elo_score: result.loser.score, elo_games: result.loser.games },
    ],
    { onConflict: 'user_id,release_id,track_position' },
  );
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  const { error: logError } = await supabase.from('track_pairwise_comparisons').insert({
    user_id: userId,
    winner_release_id: winner.releaseId, winner_position: winner.position,
    loser_release_id: loser.releaseId, loser_position: loser.position,
  });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    winner: { ...result.winner },
    loser: { ...result.loser },
  });
}

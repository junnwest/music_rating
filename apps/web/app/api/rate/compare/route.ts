import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { updateElo } from '../../../../lib/elo';

/**
 * Instinct rating mode — record one pairwise comparison.
 *
 * Body: { winnerId, loserId } (both release UUIDs). The user is taken from the
 * Authorization header, never the body. Updates each release's Elo score for
 * this user in `ratings` and logs the pick to `pairwise_comparisons`.
 *
 * See WEB_PARITY.md §4 and lib/elo.ts.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'rate-compare', 120, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { winnerId, loserId } = await req.json();
  if (!winnerId || !loserId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (winnerId === loserId) {
    return NextResponse.json({ error: 'Cannot compare a release with itself' }, { status: 400 });
  }

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Only Instinct-mode users derive Elo scores.
  const { data: profile } = await supabase
    .from('profiles')
    .select('rating_mode')
    .eq('id', userId)
    .single();
  if (profile?.rating_mode !== 'instinct') {
    return NextResponse.json({ error: 'Not in Instinct rating mode' }, { status: 400 });
  }

  // Current Elo state for both releases (rows may not exist yet → use defaults).
  const { data: rows, error: fetchError } = await supabase
    .from('ratings')
    .select('release_id, elo_score, elo_games')
    .eq('user_id', userId)
    .in('release_id', [winnerId, loserId]);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const winnerRow = rows?.find((r) => r.release_id === winnerId);
  const loserRow = rows?.find((r) => r.release_id === loserId);

  const result = updateElo(
    { score: winnerRow?.elo_score, games: winnerRow?.elo_games },
    { score: loserRow?.elo_score, games: loserRow?.elo_games },
  );

  // Upsert both ratings rows (omitting `score` preserves any existing star score
  // on update and leaves it null on insert). `status` is NOT NULL in prod and
  // Postgres evaluates it on the proposed insert tuple before ON CONFLICT
  // resolution, so it must be supplied even when the row already exists.
  const { error: upsertError } = await supabase
    .from('ratings')
    .upsert(
      [
        { user_id: userId, release_id: winnerId, elo_score: result.winner.score, elo_games: result.winner.games, status: 'Listened' },
        { user_id: userId, release_id: loserId, elo_score: result.loser.score, elo_games: result.loser.games, status: 'Listened' },
      ],
      { onConflict: 'user_id,release_id' },
    );

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  const { error: logError } = await supabase
    .from('pairwise_comparisons')
    .insert({ user_id: userId, winner_release_id: winnerId, loser_release_id: loserId });

  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    winner: { id: winnerId, ...result.winner },
    loser: { id: loserId, ...result.loser },
  });
}

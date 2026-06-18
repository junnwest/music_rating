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

  // Pull the importable rows (star score set, no Elo yet) and seed them.
  const { data: rows, error: fetchError } = await supabase
    .from('ratings')
    .select('release_id, score')
    .eq('user_id', userId)
    .not('score', 'is', null)
    .is('elo_score', null);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, seeded: 0 });

  const updates = rows.map((r) => ({
    user_id: userId,
    release_id: r.release_id,
    elo_score: starToElo(Number(r.score)),
    elo_games: IMPORT_GAMES,
    status: 'Listened',
  }));

  const { error: upsertError } = await supabase
    .from('ratings')
    .upsert(updates, { onConflict: 'user_id,release_id' });

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  return NextResponse.json({ ok: true, seeded: updates.length });
}

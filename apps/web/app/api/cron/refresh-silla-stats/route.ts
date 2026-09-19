import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

// Scheduled (Vercel Cron) job — recomputes the precomputed per-user rating
// stats get_silla_leaderboard reads instead of calculating live on every
// request (see migration 20260920000000_silla_leaderboard_user_stats_cache).
// Same CRON_SECRET gating as refresh-spotify-taste/founding-maintenance.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const { error } = await supabase.rpc('refresh_user_score_stats');
  if (error) {
    console.error('[cron/refresh-silla-stats] rpc error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

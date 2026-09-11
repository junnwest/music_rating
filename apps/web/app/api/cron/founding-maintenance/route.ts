import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

/**
 * Scheduled maintenance for the founding badge system: promotes pending ->
 * locked_in for anyone who's cleared the activity bar, and reclaims pending
 * numbers past their grace window so they free back into the pool. Both are
 * plain SQL in the migration (lock_in_eligible_founding_members /
 * reclaim_expired_founding_numbers) — this route just calls them on a
 * schedule, same CRON_SECRET gating as
 * app/api/cron/refresh-spotify-taste/route.ts. Needs registering in the
 * Vercel Cron config (not done here — that's an ops step, not code).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const [lockedIn, reclaimed] = await Promise.all([
    supabase.rpc('lock_in_eligible_founding_members'),
    supabase.rpc('reclaim_expired_founding_numbers'),
  ]);

  if (lockedIn.error || reclaimed.error) {
    return NextResponse.json(
      { error: lockedIn.error?.message ?? reclaimed.error?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ lockedIn: lockedIn.data, reclaimed: reclaimed.data });
}

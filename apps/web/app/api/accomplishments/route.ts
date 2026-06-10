import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { checkAndAwardRatingMilestones } from '../../../lib/accomplishments';
import { getAuthedUserId } from '../../../lib/authGuard';

// GET /api/accomplishments?userId=xxx — fetch earned badges for a user (public)
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ accomplishments: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ accomplishments: [] });

  const { data } = await supabase
    .from('user_accomplishments')
    .select('definition_id, earned_at, accomplishment_definitions(id, title, description, icon, badge_type)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: true });

  return NextResponse.json({ accomplishments: data ?? [] });
}

// POST /api/accomplishments/check — trigger a milestone check after a rating write
export async function POST(req: NextRequest) {
  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId) return NextResponse.json({ ok: false }, { status: 401 });

  const { userId } = await req.json().catch(() => ({}));
  if (!userId || userId !== authedId) return NextResponse.json({ ok: false }, { status: 403 });

  const newBadges = await checkAndAwardRatingMilestones(userId);
  return NextResponse.json({ ok: true, newBadges });
}

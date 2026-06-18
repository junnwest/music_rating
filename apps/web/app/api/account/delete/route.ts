import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';

/**
 * Hard-delete the caller's own account. A user cannot delete their own auth
 * record from the client, so this runs server-side with the service-role key.
 * Deleting the `auth.users` row cascades through `profiles` → all dependent
 * tables (ratings, reviews, follows, lists, etc.).
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'account-delete', 5, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

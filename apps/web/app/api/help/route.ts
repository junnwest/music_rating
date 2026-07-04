import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';

const VALID_CATEGORIES = ['bug', 'feature', 'question', 'content'];

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'help', 5, 3600);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const category = typeof body?.category === 'string' ? body.category : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : null;

  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category.' }, { status: 400 });
  }
  if (!message || message.length > 4000) {
    return NextResponse.json({ error: 'Message is required and must be under 4000 characters.' }, { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });

  // Attach the signed-in user, if any, from the bearer token — best-effort, not required.
  let userId: string | null = null;
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const { data } = await supabase.auth.getUser(authHeader.slice(7));
    userId = data.user?.id ?? null;
  }

  const { error } = await supabase.from('contact_submissions').insert({
    user_id: userId,
    email: email || null,
    category,
    message,
  });

  if (error) {
    return NextResponse.json({ error: 'Could not submit your message. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { createClient } from '@supabase/supabase-js';

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// POST /api/daily-question/answer
// Body: { questionId, releaseId, note?, accessToken }
// Uses the user's access token to enforce RLS (auth.uid() check).
export async function POST(req: NextRequest) {
  let body: { questionId?: string; releaseId?: string; note?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { questionId, releaseId, note = null, accessToken } = body;
  if (!questionId || !releaseId || !accessToken) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Use anon client with the user's JWT so RLS policies apply.
  const client = anonClient();
  if (!client) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  // Resolve uid from the token
  const { data: { user }, error: authErr } = await client.auth.getUser(accessToken);
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Upsert via service-role client (we've already verified the user above)
  const svc = createServerClient();
  if (!svc) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { data, error } = await svc
    .from('daily_answers')
    .upsert(
      { user_id: user.id, question_id: questionId, release_id: releaseId, note },
      { onConflict: 'user_id,question_id' }
    )
    .select('id, release_id, note')
    .single();

  if (error) {
    console.error('[daily-question/answer] upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ answer: data });
}

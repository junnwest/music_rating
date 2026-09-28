import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { FeedError, homeFeed } from '../../../../lib/feed/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'home-feed', 90, 60);
  if (limited) return limited;
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  try {
    const tab = req.nextUrl.searchParams.get('tab') ?? 'explore';
    if (tab !== 'explore' && tab !== 'following') throw new FeedError(400, 'Invalid feed');
    const auth = req.headers.get('authorization');
    const viewer = await getAuthedUserId(auth);
    if (auth && !viewer) throw new FeedError(401, 'Invalid session');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new FeedError(503, 'Feed unavailable');
    // Never use service-role reads for feed content. The same RLS gates apply
    // here as in the apps, including private mix owners and approved followers.
    const db = createClient(url, key, { auth: { persistSession: false },
      global: { headers: auth ? { Authorization: auth } : {} } });
    return NextResponse.json(await homeFeed(db, viewer, tab, req.nextUrl.searchParams.get('cursor')), { headers });
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 503;
    if (status === 503) console.error('[home-feed]', error);
    return NextResponse.json({ error: error instanceof FeedError ? error.message : 'Feed unavailable' }, { status, headers });
  }
}

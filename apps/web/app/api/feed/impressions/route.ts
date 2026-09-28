import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { FeedError, readSnapshot } from '../../../../lib/feed/service';
import { FEED_VERSION } from '../../../../lib/feed/ranking';

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'feed-impressions', 120, 60);
  if (limited) return limited;
  const viewer = await getAuthedUserId(req.headers.get('authorization'));
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (typeof body.sessionId !== 'string' || !Array.isArray(body.keys) || body.keys.length > 40 || body.keys.some((k: unknown) => typeof k !== 'string')) {
      throw new FeedError(400, 'Invalid impressions');
    }
    const snapshot = await readSnapshot(body.sessionId, viewer);
    const rows = [...new Set<string>(body.keys)].flatMap(key => {
      const position = snapshot.refs.findIndex(ref => ref.key === key);
      if (position < 0) return [];
      return [{ viewer_id: viewer, session_id: body.sessionId, post_key: key, position,
        bucket: snapshot.refs[position].bucket, version: FEED_VERSION }];
    });
    const db = createServerClient();
    if (!db) throw new FeedError(503, 'Unavailable');
    if (rows.length) {
      const { error } = await db.from('feed_impressions').upsert(rows, { onConflict: 'viewer_id,session_id,post_key', ignoreDuplicates: true });
      if (error) throw error;
      // An indexed sweep also expires observations from inactive viewers.
      await db.from('feed_impressions').delete().lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof FeedError ? error.message : 'Invalid or unavailable impressions' },
      { status: error instanceof FeedError ? error.status : 400 });
  }
}

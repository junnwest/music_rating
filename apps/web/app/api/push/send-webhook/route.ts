import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { sendPushNotification } from '../../../../lib/apns';

// Called by the notifications-table DB trigger (migration 20260703000002).
// Not meant to be called directly by clients.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-push-secret');
  if (!process.env.PUSH_WEBHOOK_SECRET || secret !== process.env.PUSH_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const notificationId = body?.notificationId;
  if (!notificationId) return NextResponse.json({ error: 'Missing notificationId' }, { status: 400 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ ok: false, reason: 'DB unavailable' });

  const { data: notification } = await supabase
    .from('notifications')
    .select('user_id, actor_id, type, rating_id')
    .eq('id', notificationId)
    .maybeSingle();

  if (!notification) return NextResponse.json({ ok: false, reason: 'Notification not found' });

  const { data: recipient } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', notification.user_id)
    .maybeSingle();

  if (!recipient?.push_token) return NextResponse.json({ ok: false, reason: 'No push token' });

  const { data: actor } = notification.actor_id
    ? await supabase.from('profiles').select('username').eq('id', notification.actor_id).maybeSingle()
    : { data: null };
  const actorName = actor?.username ?? 'Someone';

  let releaseTitle: string | null = null;
  if (notification.rating_id) {
    const { data: rating } = await supabase
      .from('ratings')
      .select('releases(title)')
      .eq('id', notification.rating_id)
      .maybeSingle();
    releaseTitle = (rating as any)?.releases?.title ?? null;
  }

  const messages: Record<string, string> = {
    like: releaseTitle ? `${actorName} liked your rating of ${releaseTitle}` : `${actorName} liked your rating`,
    comment: releaseTitle ? `${actorName} commented on your rating of ${releaseTitle}` : `${actorName} commented on your rating`,
    follow: `${actorName} started following you`,
  };
  const body_ = messages[notification.type] ?? `${actorName} interacted with your activity`;

  await sendPushNotification(recipient.push_token, 'sillajuku', body_);

  return NextResponse.json({ ok: true });
}

'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useSession } from '../../../components/sj/SessionContext';
import {
  NOTIFICATION_SELECT,
  NotificationRow,
  type NotificationEntry,
} from '../../../components/sj/notifications';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

/** Notifications — web sibling of iOS NotificationsView (marks all read on open). */
export default function NotificationsPage() {
  const { t, lang } = useLanguage();
  const { userId, ready, refreshProfile } = useSession();
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !supabase) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase!
        .from('notifications')
        .select(NOTIFICATION_SELECT)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (cancelled) return;
      setNotifications((data as unknown as NotificationEntry[] | null) ?? []);
      setLoading(false);
      // Mark all read
      await supabase!
        .from('profiles')
        .update({ notifications_last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      refreshProfile();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId]);

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-7">
      <h1 className="text-[20px] font-bold text-ink mb-4">{t('sj.nav.notifications')}</h1>
      {loading ? (
        <div className="space-y-2 animate-pulse" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-2xl bg-surface" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <Bell size={38} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.notifications.empty')}</p>
        </div>
      ) : (
        <ul className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationRow n={n} t={t} lang={lang} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

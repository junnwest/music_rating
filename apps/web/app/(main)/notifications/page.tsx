'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Heart, MessageSquare, UserPlus } from 'lucide-react';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName, relativeTime } from '../../../lib/sj/display';

interface NotificationEntry {
  id: string;
  type: string;
  created_at: string;
  rating_id: string | null;
  actor_id: string | null;
  actor: { username: string | null; display_name: string | null } | null;
  rating: {
    release_groups: {
      id: string;
      title: string;
      artist_display: string;
      native_title: string | null;
      artists: { name_native: string | null } | null;
    } | null;
  } | null;
}

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
        .select(
          'id, type, created_at, rating_id, actor_id, actor:actor_id(username, display_name), rating:rating_id(release_groups(id, title, artist_display, native_title, artists!release_groups_primary_artist_id_fkey(name_native)))',
        )
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

  function bodyText(n: NotificationEntry): string {
    const who = `@${n.actor?.username ?? n.actor?.display_name ?? 'someone'}`;
    const rg = n.rating?.release_groups;
    const title = rg ? displayName(rg.title, rg.native_title) : null;
    switch (n.type) {
      case 'like':
        return title
          ? t('sj.notifications.likedOf').replace('{who}', who).replace('{title}', title)
          : t('sj.notifications.liked').replace('{who}', who);
      case 'comment':
        return title
          ? t('sj.notifications.commentedOn').replace('{who}', who).replace('{title}', title)
          : t('sj.notifications.commented').replace('{who}', who);
      case 'follow':
        return t('sj.notifications.followed').replace('{who}', who);
      default:
        return t('sj.notifications.interacted').replace('{who}', who);
    }
  }

  function href(n: NotificationEntry): string | null {
    if ((n.type === 'like' || n.type === 'comment') && n.rating?.release_groups) {
      return `/album/${n.rating.release_groups.id}`;
    }
    if (n.type === 'follow' && n.actor?.username) {
      return `/profile/${n.actor.username}`;
    }
    return null;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-7">
      <h1 className="text-[20px] font-bold text-ink mb-4">{t('sj.nav.notifications')}</h1>
      {loading ? (
        <p className="py-16 text-center text-[13px] text-muted">…</p>
      ) : notifications.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <Bell size={38} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.notifications.empty')}</p>
        </div>
      ) : (
        <ul className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
          {notifications.map((n) => {
            const to = href(n);
            const inner = (
              <span className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`flex w-9 h-9 rounded-full items-center justify-center shrink-0 ${
                    n.type === 'like'
                      ? 'bg-red-500/[0.12] text-red-500'
                      : n.type === 'comment'
                        ? 'bg-accent/[0.12] text-accent'
                        : n.type === 'follow'
                          ? 'bg-accent/[0.12] text-accent'
                          : 'bg-muted/[0.12] text-muted'
                  }`}
                >
                  {n.type === 'like' ? (
                    <Heart size={15} className="fill-current" />
                  ) : n.type === 'comment' ? (
                    <MessageSquare size={15} />
                  ) : n.type === 'follow' ? (
                    <UserPlus size={15} />
                  ) : (
                    <Bell size={15} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] text-ink">{bodyText(n)}</span>
                  <span className="block text-[12px] text-muted mt-0.5">
                    {relativeTime(n.created_at, lang)}
                  </span>
                </span>
              </span>
            );
            return (
              <li key={n.id}>
                {to ? (
                  <Link href={to} className="block hover:bg-page/60 transition">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Bell, Heart, MessageSquare, UserPlus } from 'lucide-react';
import { displayName, relativeTime } from '../../lib/sj/display';

/** Shared between the notifications page and the top-bar popover. */

export interface NotificationEntry {
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

export const NOTIFICATION_SELECT =
  'id, type, created_at, rating_id, actor_id, actor:actor_id(username, display_name), ' +
  'rating:rating_id(release_groups(id, title, artist_display, native_title, ' +
  'artists!release_groups_primary_artist_id_fkey(name_native)))';

export function notificationBody(
  n: NotificationEntry,
  t: (key: string) => string,
): string {
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

export function notificationHref(n: NotificationEntry): string | null {
  if ((n.type === 'like' || n.type === 'comment') && n.rating?.release_groups) {
    return `/album/${n.rating.release_groups.id}`;
  }
  if (n.type === 'follow' && n.actor?.username) {
    return `/profile/${n.actor.username}`;
  }
  return null;
}

export function NotificationRow({
  n,
  t,
  lang,
  onNavigate,
  compact = false,
}: {
  n: NotificationEntry;
  t: (key: string) => string;
  lang: 'en' | 'ko';
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const to = notificationHref(n);
  const inner = (
    <span className={`flex items-start gap-3 ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3'}`}>
      <span
        className={`flex ${compact ? 'w-8 h-8' : 'w-9 h-9'} rounded-full items-center justify-center shrink-0 ${
          n.type === 'like'
            ? 'bg-red-500/[0.12] text-red-500'
            : n.type === 'comment' || n.type === 'follow'
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
        <span className={`block ${compact ? 'text-[13px]' : 'text-[13.5px]'} text-ink`}>
          {notificationBody(n, t)}
        </span>
        <span className="block text-[12px] text-muted mt-0.5">
          {relativeTime(n.created_at, lang)}
        </span>
      </span>
    </span>
  );
  if (!to) return inner;
  return (
    <Link href={to} onClick={onNavigate} className="block hover:bg-page/60 transition">
      {inner}
    </Link>
  );
}

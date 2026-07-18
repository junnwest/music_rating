'use client';

import Link from 'next/link';
import { Bell, Heart, MessageSquare, UserPlus } from 'lucide-react';
import Avatar from './Avatar';
import { displayName, relativeTime } from '../../lib/sj/display';

/** Shared between the notifications page and the top-bar popover. */

export interface NotificationEntry {
  id: string;
  type: string;
  created_at: string;
  rating_id: string | null;
  mix_id: string | null;
  mix_share_id: string | null;
  track_rating_id: string | null;
  actor_id: string | null;
  actor: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
  rating: {
    release_groups: {
      id: string;
      title: string;
      artist_display: string;
      native_title: string | null;
      artists: { name_native: string | null } | null;
    } | null;
  } | null;
  mix: { id: string; name: string } | null;
  mix_share: { mixes: { id: string; name: string } | null } | null;
}

export const NOTIFICATION_SELECT =
  'id, type, created_at, rating_id, mix_id, mix_share_id, track_rating_id, actor_id, ' +
  'actor:actor_id(username, display_name, avatar_url), ' +
  'rating:rating_id(release_groups(id, title, artist_display, native_title, ' +
  'artists!release_groups_primary_artist_id_fkey(name_native))), ' +
  'mix:mix_id(id, name), ' +
  'mix_share:mix_share_id(mixes(id, name))';

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
    case 'mix_like':
      return n.mix?.name
        ? t('sj.notifications.mixLikedNamed').replace('{who}', who).replace('{title}', n.mix.name)
        : t('sj.notifications.mixLiked').replace('{who}', who);
    case 'mix_share_like':
      return t('sj.notifications.mixShareLiked').replace('{who}', who);
    case 'mix_share_comment':
      return t('sj.notifications.mixShareCommented').replace('{who}', who);
    case 'track_rating_like':
      return t('sj.notifications.songLiked').replace('{who}', who);
    case 'track_rating_comment':
      return t('sj.notifications.songCommented').replace('{who}', who);
    default:
      return t('sj.notifications.interacted').replace('{who}', who);
  }
}

// A like/comment notification is about a specific post (the rating, with its own review
// text/like-comment thread) -- linking to the bare album/song page loses that entirely (those
// pages only show aggregate community stats, never individual posts). These route to the
// dedicated /post page instead -- web sibling of iOS's albumPostDestination/songPostDestination.
export function notificationHref(n: NotificationEntry): string | null {
  if ((n.type === 'like' || n.type === 'comment') && n.rating_id) {
    return `/post/${n.rating_id}`;
  }
  if ((n.type === 'track_rating_like' || n.type === 'track_rating_comment') && n.track_rating_id) {
    return `/post/${n.track_rating_id}?song=1`;
  }
  if (n.type === 'follow' && n.actor?.username) {
    return `/profile/${n.actor.username}`;
  }
  if (n.type === 'mix_like' && n.mix) {
    return `/mix/${n.mix.id}`;
  }
  if ((n.type === 'mix_share_like' || n.type === 'mix_share_comment') && n.mix_share?.mixes) {
    return `/mix/${n.mix_share.mixes.id}`;
  }
  return null;
}

function typeBadgeStyle(type: string): { icon: typeof Heart; className: string } {
  switch (type) {
    case 'like':
    case 'mix_like':
    case 'mix_share_like':
    case 'track_rating_like':
      return { icon: Heart, className: 'bg-red-500 text-white' };
    case 'comment':
    case 'mix_share_comment':
    case 'track_rating_comment':
      return { icon: MessageSquare, className: 'bg-accent text-white' };
    case 'follow':
      return { icon: UserPlus, className: 'bg-accent text-white' };
    default:
      return { icon: Bell, className: 'bg-muted text-white' };
  }
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
  const avatarSize = compact ? 32 : 36;
  const badge = typeBadgeStyle(n.type);
  const Icon = badge.icon;

  const inner = (
    <span className={`flex items-start gap-3 ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3'}`}>
      <span className="relative shrink-0" style={{ width: avatarSize, height: avatarSize }}>
        <Avatar url={n.actor?.avatar_url} size={avatarSize} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-[18px] h-[18px] rounded-full ring-2 ring-surface ${badge.className}`}
        >
          <Icon size={9} strokeWidth={2.5} className={n.type.includes('like') ? 'fill-current' : ''} />
        </span>
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

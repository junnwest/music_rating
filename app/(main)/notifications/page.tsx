'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  UserPlus, Check, Trash2, Bell, type LucideIcon
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

type NotifType = 'follow';

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  timeAgo: string;
  read: boolean;
  link?: string;
}

const iconMap: Record<NotifType, LucideIcon> = {
  follow: UserPlus,
};

const colorMap: Record<NotifType, string> = {
  follow: 'bg-violet-50 text-violet-500 border-violet-100',
};

const MOCK_NOTIFS: Notification[] = [
  { id: 'm1', type: 'follow', title: 'hyunwoo followed you', body: '@hyunwoo started following your music taste.', timeAgo: '3 min ago',  read: false, link: '/profile/hyunwoo' },
  { id: 'm2', type: 'follow', title: 'jiyeon followed you',  body: '@jiyeon started following your music taste.',  timeAgo: '1 hr ago',   read: false, link: '/profile/jiyeon' },
  { id: 'm3', type: 'follow', title: 'seojun followed you',  body: '@seojun started following your music taste.',  timeAgo: 'Yesterday',  read: true,  link: '/profile/seojun' },
  { id: 'm4', type: 'follow', title: 'minjae followed you',  body: '@minjae started following your music taste.',  timeAgo: '3 days ago', read: true,  link: '/profile/minjae' },
  { id: 'm5', type: 'follow', title: 'sora followed you',    body: '@sora started following your music taste.',    timeAgo: '1 week ago', read: true,  link: '/profile/sora' },
];

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const READ_KEY = 'sillajuku:notif-read';

  const getReadIds = (): Set<string> =>
    new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]);

  const persistRead = (ids: string[]) =>
    localStorage.setItem(READ_KEY, JSON.stringify(ids));

  const applyReadState = (items: Notification[]): Notification[] => {
    const read = getReadIds();
    return items.map(n => ({ ...n, read: n.read || read.has(n.id) }));
  };

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) { setLoading(false); return; }
      setSignedIn(true);
      fetch(`/api/notifications?userId=${uid}`)
        .then(r => r.json())
        .then(json => {
          const raw: Notification[] = json.notifications?.length > 0 ? json.notifications : MOCK_NOTIFS;
          setNotifs(applyReadState(raw));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

  const unreadCount = notifs.filter(n => !n.read).length;
  const filtered = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  const markRead = (id: string) => {
    const ids = [...getReadIds(), id];
    persistRead(ids);
    setNotifs(prev => {
      const next = prev.map(n => n.id === id ? { ...n, read: true } : n);
      if (next.every(n => n.read)) window.dispatchEvent(new Event('sillajuku:notifs-read'));
      return next;
    });
  };

  const markAllRead = () => {
    const ids = notifs.map(n => n.id);
    persistRead([...getReadIds(), ...ids]);
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    window.dispatchEvent(new Event('sillajuku:notifs-read'));
  };

  const clearAll = () => {
    persistRead([...getReadIds(), ...notifs.map(n => n.id)]);
    setNotifs([]);
    window.dispatchEvent(new Event('sillajuku:notifs-read'));
  };

  const today = filtered.filter(n => n.timeAgo.includes('min') || n.timeAgo.includes('hr'));
  const thisWeek = filtered.filter(n => n.timeAgo.includes('Yesterday') || n.timeAgo.includes('days') || n.timeAgo.includes('week'));
  const earlier = filtered.filter(n => !today.includes(n) && !thisWeek.includes(n));

  return (
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            Activity
          </p>
          <h1 className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
            Notifications
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            {loading ? 'Loading…' : unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}.` : 'All caught up — nothing new since your last visit.'}
          </p>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16">

        {/* Not signed in */}
        {!loading && !signedIn && (
          <div className="flex flex-col items-center py-20 text-center">
            <Bell size={36} className="text-subtle mb-3" />
            <p className="text-[15px] font-semibold text-ink">Sign in to see notifications</p>
            <p className="text-[13px] text-muted mt-1 max-w-[260px]">
              Activity on your reviews, rankings, and follows will show up here.
            </p>
            <Link href="/login" className="mt-6 bg-ink text-white text-[13px] font-bold px-5 py-2.5 rounded-lg hover:opacity-80 transition">
              Sign In
            </Link>
          </div>
        )}

        {signedIn && (
          <>
            {/* Filter bar */}
            <div className="flex items-center justify-between mb-5 max-w-[760px] mx-auto">
              <div className="flex gap-1">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${filter === 'all' ? 'bg-ink text-white' : 'text-muted hover:bg-surface'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${filter === 'unread' ? 'bg-ink text-white' : 'text-muted hover:bg-surface'}`}
                >
                  Unread {unreadCount > 0 && `(${unreadCount})`}
                </button>
              </div>
              <div className="flex gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink transition px-2 py-1">
                    <Check size={14} /> Mark all read
                  </button>
                )}
                {notifs.length > 0 && (
                  <button onClick={clearAll} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-red-500 transition px-2 py-1">
                    <Trash2 size={14} /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Empty state — centered */}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center py-20 text-center">
                <Bell size={36} className="text-subtle mb-3" />
                <p className="text-[15px] font-semibold text-ink">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-[13px] text-muted mt-1 max-w-[260px]">
                  Activity on your reviews, rankings, and follows will show up here.
                </p>
              </div>
            )}

            {/* Notification list */}
            <div className="flex flex-col gap-1 max-w-[760px] mx-auto">
              {today.length > 0 && <NotifGroup title="Today" items={today} onMarkRead={markRead} />}
              {thisWeek.length > 0 && <NotifGroup title="This week" items={thisWeek} onMarkRead={markRead} />}
              {earlier.length > 0 && <NotifGroup title="Earlier" items={earlier} onMarkRead={markRead} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NotifGroup({ title, items, onMarkRead }: {
  title: string;
  items: Notification[];
  onMarkRead: (id: string) => void;
}) {
  return (
    <div className="mb-4">
      <h3
        className="text-[11px] font-bold text-muted uppercase mb-2 px-1"
        style={{ letterSpacing: '0.7px' }}
      >
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">
        {items.map(n => {
          const Icon = iconMap[n.type] ?? UserPlus;
          const cardClass = `flex items-start gap-3 rounded-xl border p-3.5 transition ${
            n.read
              ? 'border-divider bg-white hover:border-mid'
              : 'border-mint bg-mint-bg/30 hover:bg-mint-bg/50'
          }`;

          const inner = (
            <>
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${colorMap[n.type] ?? colorMap.follow}`}>
                <Icon size={15} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] leading-snug ${n.read ? 'font-medium text-mid' : 'font-bold text-ink'}`}>
                  {n.title}
                </p>
                <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[11px] text-subtle mt-1">{n.timeAgo}</p>
              </div>
              {!n.read && (
                <span className="w-2 h-2 rounded-full bg-mint flex-shrink-0 mt-1.5" />
              )}
            </>
          );

          return n.link ? (
            <Link key={n.id} href={n.link} onClick={() => onMarkRead(n.id)} className="block">
              <div className={cardClass}>{inner}</div>
            </Link>
          ) : (
            <div key={n.id} className={cardClass} onClick={() => onMarkRead(n.id)}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}

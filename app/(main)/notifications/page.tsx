'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Heart, MessageCircle, UserPlus, Trophy, Music, Star, Clock,
  Check, Trash2, Bell, type LucideIcon
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

type NotifType = 'like' | 'reply' | 'follow' | 'ranking' | 'new-release' | 'rate' | 'capsule';

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
  like: Heart,
  reply: MessageCircle,
  follow: UserPlus,
  ranking: Trophy,
  'new-release': Music,
  rate: Star,
  capsule: Clock,
};

const colorMap: Record<NotifType, string> = {
  like: 'bg-rose-50 text-rose-500 border-rose-100',
  reply: 'bg-blue-50 text-blue-500 border-blue-100',
  follow: 'bg-violet-50 text-violet-500 border-violet-100',
  ranking: 'bg-amber-50 text-amber-500 border-amber-100',
  'new-release': 'bg-emerald-50 text-emerald-500 border-emerald-100',
  rate: 'bg-orange-50 text-orange-500 border-orange-100',
  capsule: 'bg-cyan-50 text-cyan-500 border-cyan-100',
};

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) { setLoading(false); return; }
      setSignedIn(true);
      fetch(`/api/notifications?userId=${uid}`)
        .then(r => r.json())
        .then(json => { if (json.notifications) setNotifs(json.notifications); })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

  const unreadCount = notifs.filter(n => !n.read).length;
  const filtered = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  const markRead = (id: string) => setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  const clearAll = () => setNotifs([]);

  const today = filtered.filter(n => n.timeAgo.includes('min') || n.timeAgo.includes('hr'));
  const thisWeek = filtered.filter(n => n.timeAgo.includes('Yesterday') || n.timeAgo.includes('days') || n.timeAgo.includes('week'));
  const earlier = filtered.filter(n => !today.includes(n) && !thisWeek.includes(n));

  return (
    <div className="flex-1">
      <div className="border-b border-divider">
        <div className="max-w-[680px] mx-auto px-5 py-10 md:py-12">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative">
              <Bell size={28} className="text-ink" strokeWidth={1.8} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                  {unreadCount}
                </span>
              )}
            </div>
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Notifications</h1>
          </div>
          <p className="text-[14px] text-muted">
            {loading ? 'Loading…' : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
      </div>

      <div className="max-w-[680px] mx-auto px-5 py-6 pb-20 w-full">
        {!loading && !signedIn ? (
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
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
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

            <div className="flex flex-col gap-1">
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
          const Icon = iconMap[n.type] ?? Star;
          const cardClass = `flex items-start gap-3 rounded-xl border p-3.5 transition ${
            n.read
              ? 'border-divider bg-white hover:border-mid'
              : 'border-mint bg-mint-bg/30 hover:bg-mint-bg/50'
          }`;

          const inner = (
            <>
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${colorMap[n.type] ?? colorMap.rate}`}>
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

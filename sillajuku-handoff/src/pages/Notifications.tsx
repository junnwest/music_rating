import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Heart, MessageCircle, UserPlus, Trophy, Music, Star, Clock,
  Check, Trash2, Bell
} from 'lucide-react';

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

const initialNotifications: Notification[] = [
  {
    id: 'n1',
    type: 'like',
    title: 'jiyeon_music liked your review',
    body: '"Best Korean indie album of the decade for me." — on Broken Mirror',
    timeAgo: '12 min ago',
    read: false,
    link: '/album/broken-mirror',
  },
  {
    id: 'n2',
    type: 'reply',
    title: 'soundwatcher replied to your review',
    body: '"Totally agree on the production. Have you heard the live version?" — on Palette',
    timeAgo: '1 hr ago',
    read: false,
    link: '/album/palette',
  },
  {
    id: 'n3',
    type: 'follow',
    title: 'minwave followed you',
    body: 'minwave (@minwave) started following your music taste.',
    timeAgo: '3 hrs ago',
    read: false,
    link: '/profile/minwave',
  },
  {
    id: 'n4',
    type: 'ranking',
    title: 'Your ranking moved up',
    body: 'Illmatic climbed to #2 in "Greatest Hip-Hop Albums" after 14 new votes.',
    timeAgo: '5 hrs ago',
    read: false,
    link: '/rankings/build',
  },
  {
    id: 'n5',
    type: 'new-release',
    title: 'New release from IU',
    body: 'IU dropped a new single — check it out and be the first to rate.',
    timeAgo: '8 hrs ago',
    read: true,
    link: '/search?q=IU',
  },
  {
    id: 'n6',
    type: 'rate',
    title: 'popwatcher rated an album you rated',
    body: 'popwatcher gave Get Up 4.0 stars. You rated it 3.5.',
    timeAgo: 'Yesterday',
    read: true,
    link: '/album/get-up',
  },
  {
    id: 'n7',
    type: 'capsule',
    title: 'Your March capsule is ready',
    body: 'You rated 11 albums this month. See your full summary.',
    timeAgo: '2 days ago',
    read: true,
    link: '/wrapped',
  },
  {
    id: 'n8',
    type: 'follow',
    title: 'davebeats followed you',
    body: 'davebeats (@davebeats) started following you.',
    timeAgo: '3 days ago',
    read: true,
    link: '/profile/davebeats',
  },
  {
    id: 'n9',
    type: 'like',
    title: 'nara_k liked your review',
    body: '"Hauntingly minimalist." — on Night Swimming',
    timeAgo: '5 days ago',
    read: true,
    link: '/album/night-swimming',
  },
  {
    id: 'n10',
    type: 'ranking',
    title: 'New ranking available',
    body: '"Greatest Japanese Rock Albums" is now open for voting.',
    timeAgo: '1 week ago',
    read: true,
    link: '/rankings',
  },
];

const iconMap: Record<NotifType, typeof Heart> = {
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

export default function Notifications() {
  const [notifs, setNotifs] = useState<Notification[]>(initialNotifications);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const unreadCount = notifs.filter(n => !n.read).length;

  const filtered = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  const markRead = (id: string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifs([]);
  };

  // Group by time
  const today = filtered.filter(n => n.timeAgo.includes('min') || n.timeAgo.includes('hr'));
  const thisWeek = filtered.filter(n => n.timeAgo.includes('Yesterday') || n.timeAgo.includes('days') || n.timeAgo.includes('week'));
  const earlier = filtered.filter(n => !today.includes(n) && !thisWeek.includes(n));

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider">
        <div className="max-w-[680px] mx-auto px-5 py-10 md:py-12">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative">
              <Bell size={28} className="text-ink" strokeWidth={1.8} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 w-4.5 h-4.5 min-w-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </div>
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">Notifications</h1>
          </div>
          <p className="text-[14px] text-muted">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
      </div>

      <div className="max-w-[680px] mx-auto px-5 py-6 pb-20 w-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                filter === 'all' ? 'bg-ink text-white' : 'text-muted hover:bg-surface'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                filter === 'unread' ? 'bg-ink text-white' : 'text-muted hover:bg-surface'
              }`}
            >
              Unread {unreadCount > 0 && <span className="ml-0.5">({unreadCount})</span>}
            </button>
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink transition px-2 py-1"
              >
                <Check size={14} /> Mark all read
              </button>
            )}
            {notifs.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-red-500 transition px-2 py-1"
              >
                <Trash2 size={14} /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
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

        {/* Notification groups */}
        <div className="flex flex-col gap-1">
          {today.length > 0 && <Group title="Today" items={today} onClick={markRead} />}
          {thisWeek.length > 0 && <Group title="This week" items={thisWeek} onClick={markRead} />}
          {earlier.length > 0 && <Group title="Earlier" items={earlier} onClick={markRead} />}
        </div>
      </div>
    </div>
  );
}

function Group({ title, items, onClick }: { title: string; items: Notification[]; onClick: (id: string) => void }) {
  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-bold text-muted uppercase mb-2 px-1" style={{ letterSpacing: '0.7px' }}>{title}</h3>
      <div className="flex flex-col gap-1.5">
        <AnimatePresence>
          {items.map((n, i) => {
            const Icon = iconMap[n.type];
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2, delay: i * 0.03 }}
              >
                <Link
                  to={n.link || '#'}
                  onClick={() => onClick(n.id)}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
                    n.read
                      ? 'border-divider bg-white hover:border-mid'
                      : 'border-mint bg-mint-bg/30 hover:bg-mint-bg/50'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${colorMap[n.type]}`}>
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
                </Link>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

export function useUnreadCount(): number {
  const [count, setCount] = useState(0);
  const channelName = useRef(`unread-follows-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!supabase) return;

    let uid: string | null = null;

    const readIds = (): Set<string> =>
      new Set(JSON.parse(localStorage.getItem('sillajuku:notif-read') ?? '[]') as string[]);

    const fetchCount = async (userId: string) => {
      try {
        const res = await fetch(`/api/notifications?userId=${userId}`);
        const json = await res.json();
        const read = readIds();
        setCount((json.notifications ?? []).filter((n: any) => !n.read && !read.has(n.id)).length);
      } catch (err) {
        console.error('[useUnreadCount] fetch failed:', err);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      uid = data.session?.user?.id ?? null;
      if (uid) fetchCount(uid);
    });

    // Real-time: new follower → increment immediately
    const channel = supabase
      .channel(channelName.current)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'follows' },
        (payload) => {
          if (payload.new.following_id === uid) {
            setCount((c) => c + 1);
          }
        }
      )
      .subscribe();

    // Re-sync when the tab regains focus (catches changes made in other tabs)
    const onFocus = () => { if (uid) fetchCount(uid); };
    window.addEventListener('focus', onFocus);

    // Notifications page signals when all are read
    const onRead = () => setCount(0);
    window.addEventListener('sillajuku:notifs-read', onRead);

    return () => {
      supabase?.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('sillajuku:notifs-read', onRead);
    };
  }, []);

  return count;
}

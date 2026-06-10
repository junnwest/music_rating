'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Search, Flame, Trophy, User } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useUnreadCount } from '../lib/useUnreadCount';
import { useLanguage } from '../lib/i18n';

export default function BottomNav() {
  const pathname = usePathname();
  const [profilePath, setProfilePath] = useState('/profile');
  const unreadCount = useUnreadCount();
  const { t } = useLanguage();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      const { data: profile } = await supabase!
        .from('profiles')
        .select('username')
        .eq('id', uid)
        .maybeSingle();
      if (profile?.username) setProfilePath(`/profile/${profile.username}`);
    });
  }, []);

  const items = [
    { icon: Home,   label: t('nav.home'),     path: '/' },
    { icon: Search, label: t('nav.search'),   path: '/search' },
    { icon: Flame,  label: t('nav.feed'),     path: '/activity' },
    { icon: Trophy, label: t('nav.leaderboard'), path: '/leaderboard' },
    { icon: User,   label: t('nav.profile'),  path: profilePath },
  ];

  return (
    <nav
      className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-page border-t border-divider flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {items.map(({ icon: Icon, label, path }) => {
        const isActive =
          path === '/'
            ? pathname === '/'
            : pathname === path || pathname.startsWith(path + '/') || (label === 'Profile' && pathname.startsWith('/profile'));
        return (
          <Link
            key={label}
            href={path}
            className={`flex-1 flex flex-col items-center justify-center gap-[3px] py-2.5 transition-colors ${
              isActive ? 'text-ink' : 'text-muted'
            }`}
          >
            <div className="relative">
              <Icon
                size={22}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={isActive ? 'text-ink' : 'text-muted'}
              />
              {label === 'Profile' && unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-white" />
              )}
            </div>
            <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-ink' : 'text-muted'}`}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

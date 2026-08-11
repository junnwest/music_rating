'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Trophy,
  CirclePlus,
  Sparkles,
  User,
  Settings,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { SessionProvider, useSession } from './SessionContext';
import { RatingsProvider } from './RatingsStore';
import FlowerGlyph from './FlowerGlyph';
import SearchOmnibox from './SearchOmnibox';
import CursorTip from './CursorTip';
import { AvatarMenu, NotificationsBell } from './HeaderMenus';

/**
 * Desktop-first app shell: persistent left sidebar (nav) + top bar (global
 * search, notifications, avatar). The iOS bottom tab bar translates to the
 * sidebar on ≥md viewports and reappears as a bottom bar on small screens.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <RatingsProvider>
        <ShellInner>{children}</ShellInner>
      </RatingsProvider>
    </SessionProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { userId, profile } = useSession();
  const [hasUnread, setHasUnread] = useState(false);

  // Bare pages render without chrome
  const bare = pathname === '/onboarding';

  // A successful shell render clears the chunk-skew reload guard (app/error.tsx)
  useEffect(() => {
    try {
      sessionStorage.removeItem('sj-chunk-reload');
    } catch {
      /* private mode */
    }
  }, []);

  // "Add" = the rate-something flow (discovery + quick-rate), like iOS.
  // Global search lives solely in the top-bar omnibox.
  const nav = [
    { icon: Home, label: t('sj.nav.home'), path: '/' },
    { icon: Trophy, label: t('sj.nav.charts'), path: '/charts' },
    { icon: CirclePlus, label: t('sj.nav.add'), path: '/search' },
    { icon: Sparkles, label: t('sj.nav.taste'), path: '/taste' },
    { icon: User, label: t('sj.nav.profile'), path: '/profile' },
  ];

  // Unread notification dot — mirrors iOS HomeViewModel.refreshNotificationBadge()
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    (async () => {
      let q = supabase!
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      const lastSeen = profile?.notifications_last_seen_at;
      if (lastSeen) q = q.gt('created_at', lastSeen);
      const { count } = await q;
      if (!cancelled) setHasUnread((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, profile?.notifications_last_seen_at, pathname]);

  if (bare)
    return (
      <main className="min-h-screen">
        {children}
        <CursorTip />
      </main>
    );

  const isActive = (path: string) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path);

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar (≥md) ── */}
      <aside className="hidden md:flex sticky top-0 h-screen w-[212px] shrink-0 flex-col border-r border-divider bg-page">
        <Link href="/" className="flex items-center gap-2.5 px-5 pt-5 pb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-flower.svg" alt="" className="w-7 h-7" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-text.svg" alt="sillajuku" className="h-[15px] dark:invert" />
        </Link>
        <nav className="flex flex-col gap-1 px-3 flex-1">
          {nav.map(({ icon: Icon, label, path }) => (
            <Link
              key={path}
              href={path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] transition ${
                isActive(path)
                  ? 'bg-accent-soft text-accent-deep font-semibold'
                  : 'text-mid hover:bg-surface hover:text-ink font-medium'
              }`}
            >
              <Icon size={19} strokeWidth={isActive(path) ? 2.2 : 1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-3 pb-4">
          <Link
            href="/settings"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] transition ${
              isActive('/settings')
                ? 'bg-accent-soft text-accent-deep font-semibold'
                : 'text-mid hover:bg-surface hover:text-ink font-medium'
            }`}
          >
            <Settings size={19} strokeWidth={isActive('/settings') ? 2.2 : 1.8} />
            {t('sj.nav.settings')}
          </Link>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex items-center gap-3 px-4 md:px-6 h-[56px] bg-page/90 backdrop-blur border-b border-divider">
          <Link href="/" className="md:hidden flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-flower.svg" alt="sillajuku" className="w-7 h-7" />
          </Link>
          <SearchOmnibox />
          <div className="flex items-center gap-1.5 ml-auto">
            <NotificationsBell hasUnread={hasUnread} />
            {userId === null ? (
              <Link
                href="/login"
                className="px-3.5 py-1.5 rounded-[10px] bg-accent text-white text-[13px] font-semibold hover:opacity-90 transition"
              >
                {t('sj.nav.logIn')}
              </Link>
            ) : (
              <AvatarMenu />
            )}
          </div>
        </header>

        <main className="flex-1 pb-20 md:pb-0">{children}</main>

        <footer className="hidden md:flex items-center gap-4 px-6 py-5 border-t border-divider text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <FlowerGlyph size={11} className="text-muted" /> sillajuku
          </span>
          <Link href="/terms" className="hover:text-ink transition">
            {t('sj.footer.terms')}
          </Link>
          <Link href="/privacy" className="hover:text-ink transition">
            {t('sj.footer.privacy')}
          </Link>
          <Link href="/help" className="hover:text-ink transition">
            {t('sj.footer.help')}
          </Link>
        </footer>
      </div>

      <CursorTip />

      {/* ── Bottom bar (<md) ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch bg-page/95 backdrop-blur border-t border-divider">
        {nav.map(({ icon: Icon, label, path }) => (
          <Link
            key={path}
            href={path}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-semibold ${
              isActive(path) ? 'text-accent' : 'text-muted'
            }`}
          >
            <Icon size={21} strokeWidth={isActive(path) ? 2.2 : 1.8} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import {
  Search, Menu, User, Bookmark, Bell, Users,
  Settings, LogOut, HelpCircle, ArrowLeft
} from 'lucide-react';
import UserAvatar from './UserAvatar';
import { useUnreadCount } from '../lib/useUnreadCount';
import { useLanguage } from '../lib/i18n';

interface SiteHeaderProps {
  onMenuClick?: () => void;
}

export default function SiteHeader({ onMenuClick }: SiteHeaderProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [query, setQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileQuery, setMobileQuery] = useState('');
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const unreadCount = useUnreadCount();
  const { t } = useLanguage();
  const profileRef = useRef<HTMLDivElement>(null);

  const fetchProfile = async (uid: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', uid)
      .maybeSingle();
    if (data?.username) setProfileUsername(data.username);
    if (data?.display_name) setProfileDisplayName(data.display_name);
  };


  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) {
        fetchProfile(data.session.user.id);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user?.id) fetchProfile(s.user.id);
      if (s?.user && !s.user.user_metadata?.onboarding_completed) {
        const path = window.location.pathname;
        if (path !== '/onboarding' && path !== '/login') {
          router.push('/onboarding');
        }
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    if (profileOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?query=${encodeURIComponent(query.trim())}`);
    setQuery('');
  };

  const handleMobileSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileQuery.trim()) return;
    router.push(`/search?query=${encodeURIComponent(mobileQuery.trim())}`);
    setMobileSearchOpen(false);
    setMobileQuery('');
  };

  const closeMobileSearch = () => {
    setMobileSearchOpen(false);
    setMobileQuery('');
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setProfileOpen(false);
    await supabase.auth.signOut();
  };

  const username = profileUsername ?? session?.user?.email?.split('@')[0] ?? '';
  const displayName = profileDisplayName ?? username;
  const initial = (profileDisplayName ?? profileUsername ?? session?.user?.email ?? '')[0]?.toUpperCase() ?? '';

  const menuItems = [
    { icon: User,       label: t('nav.profile'),       href: username ? `/profile/${username}` : '/profile', isNotifications: false },
    { icon: Users,      label: t('nav.friends'),       href: '/friends', isNotifications: false },
    { icon: Bookmark,   label: t('nav.listenLater'),   href: '/listen-later', isNotifications: false },
    { icon: Bell,       label: t('nav.notifications'), href: '/notifications', isNotifications: true },
    { icon: Settings,   label: t('nav.settings'),      href: '/settings', isNotifications: false },
    { icon: HelpCircle, label: t('nav.help'),          href: '/help', isNotifications: false },
  ];

  return (
    <header className="h-[58px] bg-page border-b border-divider sticky top-0 z-50 flex items-center pr-5">

      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="md:hidden absolute inset-0 bg-page flex items-center px-4 gap-3 z-50">
          <button onClick={closeMobileSearch} className="p-1 text-muted hover:text-ink transition flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <form onSubmit={handleMobileSearch} className="flex-1">
            <input
              autoFocus
              value={mobileQuery}
              onChange={e => setMobileQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') closeMobileSearch(); }}
              placeholder={t('nav.searchPlaceholder')}
              className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-placeholder"
            />
          </form>
          {mobileQuery && (
            <button onClick={() => setMobileQuery('')} className="text-muted hover:text-ink text-[18px] leading-none flex-shrink-0">×</button>
          )}
        </div>
      )}

      {/* Hamburger — centered within the 72px sidebar column */}
      <div className="w-[72px] flex-shrink-0 flex justify-center">
        <button
          className="p-1 text-ink hover:text-mid transition"
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* Logo — starts right at the sidebar edge */}
      <Link href="/" className="flex items-center flex-shrink-0" aria-label="Home">
        <img src="/logo-text.svg" alt="sillajuku" className="h-[26px] w-auto dark:invert translate-y-[3px]" />
      </Link>

      {/* Center: Search — absolutely centered, hidden on mobile */}
      <form
        onSubmit={handleSearch}
        className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-full max-w-[560px] px-4"
      >
        <div className="bg-surface border border-divider rounded-xl px-4 py-2 flex items-center gap-2 w-full hover:border-mid transition">
          <Search size={15} className="text-muted flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('nav.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder"
          />
        </div>
      </form>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        {/* Mobile search icon */}
        <button onClick={() => setMobileSearchOpen(true)} className="md:hidden p-1 text-muted hover:text-ink transition" aria-label="Search">
          <Search size={20} />
        </button>

        {/* Profile avatar / auth */}
        {session?.user ? (
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`rounded-full border-2 transition ${
                profileOpen ? 'border-ink' : 'border-transparent hover:scale-105'
              }`}
              aria-label="Open profile menu"
            >
              <UserAvatar size={34} />
            </button>
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white pointer-events-none z-10" />
            )}

            {profileOpen && (
              <div className="absolute right-0 top-[42px] w-[200px] bg-page border border-divider rounded-xl shadow-lg py-2 z-50">
                <div className="px-3 py-2 border-b border-divider mb-1">
                  <p className="text-[13px] font-bold text-ink truncate">{displayName}</p>
                  <p className="text-[11px] text-muted truncate">@{username}</p>
                </div>

                {menuItems.map(({ icon: Icon, label, href, isNotifications }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-ink hover:bg-surface transition"
                  >
                    <Icon size={16} strokeWidth={1.8} className="text-muted flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                    {isNotifications && unreadCount > 0 && (
                      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    )}
                  </Link>
                ))}

                <div className="border-t border-divider mt-1 pt-1">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-muted hover:text-red-500 hover:bg-surface w-full text-left transition"
                  >
                    <LogOut size={16} strokeWidth={1.8} className="flex-shrink-0" />
                    {t('nav.logOut')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="text-[13px] font-semibold text-ink border border-divider rounded-lg px-4 py-2 hover:bg-surface transition"
          >
            {t('nav.logIn')}
          </Link>
        )}
      </div>
    </header>
  );
}

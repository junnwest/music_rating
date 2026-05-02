'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import {
  Search, Menu, User, Bookmark, BarChart3, Bell,
  Settings, LogOut, HelpCircle
} from 'lucide-react';

interface SiteHeaderProps {
  onMenuClick?: () => void;
}

export default function SiteHeader({ onMenuClick }: SiteHeaderProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [query, setQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
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

  const handleSignOut = async () => {
    if (!supabase) return;
    setProfileOpen(false);
    await supabase.auth.signOut();
  };

  const initial = session?.user?.email?.[0].toUpperCase() ?? '';
  const username = session?.user?.user_metadata?.username ?? session?.user?.email?.split('@')[0];

  const menuItems = [
    { icon: User, label: 'Profile', href: username ? `/profile/${username}` : '/profile' },
    { icon: Bookmark, label: 'Listen Later', href: '/listen-later' },
    { icon: BarChart3, label: 'Wrapped', href: '/wrapped' },
    { icon: Bell, label: 'Notifications', href: '/notifications' },
    { icon: Settings, label: 'Settings', href: '/settings' },
    { icon: HelpCircle, label: 'Help', href: '/help' },
  ];

  return (
    <header className="h-[72px] bg-white border-b border-divider sticky top-0 z-50 flex items-center px-5">

      {/* Left: hamburger (mobile/small screens) + logo */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          className="xl:hidden p-1 -ml-1 text-ink hover:text-mid transition"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <Link href="/" className="flex items-center" aria-label="Home">
          <img src="/sillajuku_logo.svg" alt="sillajuku" className="h-[52px] w-auto" />
        </Link>
      </div>

      {/* Center: Search — absolutely centered, hidden on mobile */}
      <form
        onSubmit={handleSearch}
        className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-full max-w-[560px] px-4"
      >
        <div className="bg-surface border border-divider rounded-full px-4 py-2 flex items-center gap-2 w-full hover:border-mid transition">
          <Search size={15} className="text-muted flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search albums, artists…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder"
          />
        </div>
      </form>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        {/* Mobile search icon */}
        <Link href="/search" className="md:hidden p-1 text-muted hover:text-ink transition" aria-label="Search">
          <Search size={20} />
        </Link>

        {/* Profile avatar / auth */}
        {session?.user ? (
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`w-[34px] h-[34px] rounded-full bg-mint-bg border-2 flex items-center justify-center font-bold text-[12px] transition relative ${
                profileOpen ? 'border-ink' : 'border-mint hover:scale-105'
              } text-mint-dark`}
              aria-label="Open profile menu"
            >
              {initial}
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-[42px] w-[200px] bg-white border border-divider rounded-xl shadow-lg py-2 z-50">
                <div className="px-3 py-2 border-b border-divider mb-1">
                  <p className="text-[13px] font-bold text-ink truncate">{session.user.user_metadata?.display_name ?? username}</p>
                  <p className="text-[11px] text-muted truncate">@{username}</p>
                </div>

                {menuItems.map(({ icon: Icon, label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-ink hover:bg-surface transition"
                  >
                    <Icon size={16} strokeWidth={1.8} className="text-muted flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                  </Link>
                ))}

                <div className="border-t border-divider mt-1 pt-1">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-muted hover:text-red-500 hover:bg-surface w-full text-left transition"
                  >
                    <LogOut size={16} strokeWidth={1.8} className="flex-shrink-0" />
                    Log out
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
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}

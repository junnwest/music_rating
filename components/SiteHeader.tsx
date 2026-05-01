'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

export default function SiteHeader() {
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
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?query=${encodeURIComponent(query.trim())}`);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setProfileOpen(false);
    await supabase.auth.signOut();
  };

  const initial = session?.user?.email?.[0].toUpperCase() ?? '';
  const username = session?.user?.email?.split('@')[0];

  return (
    <header className="h-[60px] bg-white border-b border-[#EBEBEB] sticky top-0 z-50 flex items-center px-5">

      {/* Logo — fixed left, navigates home */}
      <Link
        href="/"
        className="flex-shrink-0 text-base font-extrabold text-ink"
        style={{ letterSpacing: '-0.5px' }}
      >
        音色 <span className="text-mint">neiro</span>
      </Link>

      {/* Search — absolutely centered */}
      <div className="absolute left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4">
        <form onSubmit={handleSearch}>
          <div className="bg-surface border border-[#EBEBEB] rounded-full px-4 py-2 flex items-center gap-2">
            <span className="text-muted" style={{ fontSize: 15 }}>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search albums, artists…"
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-[#C0C0BE]"
            />
          </div>
        </form>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-6 flex-shrink-0">
        <Link href="/rankings" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Rankings
        </Link>
        <Link href="/activity" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Feed
        </Link>

        {/* Profile avatar / auth */}
        {session?.user?.email ? (
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="w-[34px] h-[34px] rounded-full bg-mint-bg border-2 border-mint flex items-center justify-center font-bold text-mint-dark text-[12px] transition hover:opacity-80"
              aria-label="Open profile menu"
            >
              {initial}
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-[#EBEBEB] bg-white py-1 shadow-lg">
                <div className="border-b border-[#EBEBEB] px-4 py-2">
                  <p className="text-xs text-muted truncate">{session.user.email}</p>
                </div>
                <Link
                  href={username ? `/profile/${username}` : '/profile'}
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2 text-sm text-mid hover:bg-surface transition"
                >
                  Profile
                </Link>
                <Link
                  href="/lists"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2 text-sm text-mid hover:bg-surface transition"
                >
                  For You
                </Link>
                <Link
                  href="/wrapped"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2 text-sm text-mid hover:bg-surface transition"
                >
                  Wrapped
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-surface transition"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/login" className="text-[13px] font-medium text-muted hover:text-ink transition">
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
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
    setDropdownOpen(false);
    await supabase.auth.signOut();
  };

  const initial = session?.user?.email?.[0].toUpperCase() ?? '';
  const username = session?.user?.email?.split('@')[0];

  return (
    <header className="h-[60px] bg-white border-b border-[#EBEBEB] sticky top-0 z-50 flex items-center px-5">

      {/* Logo — fixed left */}
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

      {/* Right side — nav + auth */}
      <div className="ml-auto flex items-center gap-6 flex-shrink-0">
        <Link href="/" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Home
        </Link>
        <Link href="/activity" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Activity
        </Link>
        <Link href="/lists" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          For You
        </Link>
        <Link href="/rankings" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Rankings
        </Link>
        <Link href="/collisions" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Collisions
        </Link>
        <Link href="/contradictions" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Contradictions
        </Link>
        <Link href="/wrapped" className="text-[13px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
          Wrapped
        </Link>

        {session?.user?.email ? (
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="w-[34px] h-[34px] rounded-full bg-mint-bg border-2 border-mint flex items-center justify-center font-bold text-mint-dark text-[12px] transition hover:opacity-80"
              aria-label="Open profile menu"
            >
              {initial}
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-[#EBEBEB] bg-white py-1 shadow-lg">
                <div className="border-b border-[#EBEBEB] px-4 py-2">
                  <p className="text-xs text-muted truncate">{session.user.email}</p>
                </div>
                <Link
                  href={username ? `/profile/${username}` : '/profile'}
                  onClick={() => setDropdownOpen(false)}
                  className="block px-4 py-2 text-sm text-mid hover:bg-surface transition"
                >
                  Profile
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

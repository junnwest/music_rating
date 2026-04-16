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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?query=${encodeURIComponent(query.trim())}`);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setDropdownOpen(false);
    await supabase.auth.signOut();
  };

  const initial = session?.user?.email?.[0].toUpperCase() ?? '';

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 py-2 backdrop-blur-xl">
      <div className="grid w-full items-center gap-4 px-6 md:grid-cols-[auto_1fr_auto]">
        <Link href="/" className="flex items-center gap-2 text-slate-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">B</div>
          <span className="text-sm font-semibold">Bside</span>
        </Link>

        <form onSubmit={handleSearch} className="mx-auto w-full max-w-xl">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search albums, artists, or releases"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button type="submit" className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-800">
              Search
            </button>
          </div>
        </form>

        <div className="flex items-center justify-end">
          {session?.user?.email ? (
            <div ref={dropdownRef} className="relative">
              {/* Avatar button */}
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white transition hover:opacity-80"
                aria-label="Open profile menu"
              >
                {initial}
              </button>

              {/* Dropdown */}
              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-xs text-slate-500 truncate">{session.user.email}</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                  >
                    Profile
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-slate-50 transition"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-900 transition hover:bg-slate-100"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

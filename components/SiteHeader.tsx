'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

export default function SiteHeader() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?query=${encodeURIComponent(query.trim())}`);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 py-4 backdrop-blur-xl">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-4 px-6 md:grid-cols-[auto_1fr_auto]">
        <Link href="/" className="flex items-center gap-3 text-slate-900">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white">B</div>
          <span className="text-lg font-semibold">Bside</span>
        </Link>

        <form onSubmit={handleSearch} className="mx-auto w-full max-w-xl">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 shadow-sm">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search albums, artists, or releases"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button type="submit" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
              Search
            </button>
          </div>
        </form>

        <div className="flex items-center justify-end gap-3">
          {session?.user?.email ? (
            <>
              <Link href="/profile" className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 transition hover:bg-slate-100">
                Profile
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 transition hover:bg-slate-100"
              >
                Log out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 transition hover:bg-slate-100"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

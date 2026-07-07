'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

type Provider = 'spotify' | 'apple' | 'google';

/**
 * OAuth-only login — web sibling of iOS AuthView (no email/password since the
 * 2026-06-17 pivot). Spotify first (recommended, taste seeding), Apple +
 * Google behind "More options".
 */
export default function LoginPage() {
  const { t } = useLanguage();
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    if (!supabase) return;
    setLoading(provider);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/`,
        scopes:
          provider === 'spotify'
            ? 'user-top-read user-read-recently-played'
            : undefined,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-page flex flex-col items-center justify-center px-6">
      {/* Decorative flowers — same treatment as iOS AuthView */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -top-40 -right-40 w-[560px] opacity-[0.09]"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -bottom-32 -left-32 w-[420px] opacity-[0.09]"
      />

      <div className="relative w-full max-w-sm flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-flower.svg" alt="" className="w-28 h-28" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-text.svg" alt="sillajuku" className="h-8 mt-2 dark:invert" />

        <p className="mt-10 mb-5 text-[22px] font-bold text-ink/60 text-center">
          {t('sj.auth.tagline')}
        </p>

        {error && (
          <p className="w-full mb-3 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[13px]">
            {error}
          </p>
        )}

        <div className="w-full flex flex-col gap-3">
          <button
            onClick={() => signIn('spotify')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-spotify text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition"
          >
            <SpotifyIcon />
            {loading === 'spotify' ? t('sj.auth.connecting') : t('sj.auth.spotify')}
          </button>

          <button
            onClick={() => setMore((m) => !m)}
            className="flex items-center justify-center gap-1.5 py-1 text-[13px] text-muted hover:text-ink transition"
          >
            {t('sj.auth.moreOptions')}
            {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {more && (
            <>
              <button
                onClick={() => signIn('apple')}
                disabled={loading !== null}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-black text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition dark:border dark:border-divider"
              >
                <AppleIcon />
                {loading === 'apple' ? t('sj.auth.connecting') : t('sj.auth.apple')}
              </button>
              <button
                onClick={() => signIn('google')}
                disabled={loading !== null}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-white text-[#1a1a1a] text-[15px] font-semibold border-[1.5px] border-divider hover:bg-white/80 disabled:opacity-60 transition"
              >
                <GoogleIcon />
                {loading === 'google' ? t('sj.auth.connecting') : t('sj.auth.google')}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="absolute bottom-8 inset-x-0 text-center text-[12px] text-muted px-10">
        {t('sj.auth.legalPrefix')}{' '}
        <Link href="/terms" className="font-bold hover:text-ink">
          {t('sj.auth.terms')}
        </Link>{' '}
        {t('sj.auth.legalAnd')}{' '}
        <Link href="/privacy" className="font-bold hover:text-ink">
          {t('sj.auth.privacy')}
        </Link>
      </p>
    </div>
  );
}

function SpotifyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.5 17.34a.75.75 0 0 1-1.03.25c-2.82-1.73-6.37-2.12-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.05 8.5-.6 11.66 1.34.35.21.46.67.25 1.03zm1.47-3.26a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 0 1-.55-1.8c4.37-1.32 9.8-.68 13.5 1.6.44.27.58.85.31 1.29zm.13-3.4C15.24 8.4 8.84 8.2 5.14 9.32a1.13 1.13 0 1 1-.65-2.16c4.25-1.29 11.3-1.04 15.75 1.6a1.13 1.13 0 0 1-1.14 1.94z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Provider } from '@supabase/supabase-js';

// ── SVG brand icons ────────────────────────────────────────────────────────────

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 814 1000" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-194.3 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3C6.477 3 2 6.477 2 11c0 2.91 1.636 5.47 4.125 7.006L5.25 21.75l4.219-2.813C10.285 19.297 11.13 19.5 12 19.5c5.523 0 10-3.477 10-8S17.523 3 12 3z"
        fill="#3A1D1D"
      />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

// ── OAuth providers config ─────────────────────────────────────────────────────

const OAUTH_PROVIDERS: {
  provider: Provider;
  label: string;
  icon: React.ReactNode;
  className: string;
}[] = [
  {
    provider: 'google',
    label: 'Google',
    icon: <GoogleIcon />,
    className: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  },
  {
    provider: 'apple',
    label: 'Apple',
    icon: <AppleIcon />,
    className: 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  },
  {
    provider: 'facebook',
    label: 'Facebook',
    icon: <FacebookIcon />,
    className: 'border-[#1877F2] bg-white text-[#1877F2] hover:bg-blue-50',
  },
  {
    provider: 'kakao',
    label: 'Kakao',
    icon: <KakaoIcon />,
    className: 'border-[#FEE500] bg-[#FEE500] text-[#3A1D1D] hover:brightness-95',
  },
  {
    provider: 'spotify',
    label: 'Spotify',
    icon: <SpotifyIcon />,
    className: 'border-[#1DB954] bg-white text-[#1DB954] hover:bg-green-50',
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<Provider | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    if (!supabase) {
      setMessage('Supabase is not configured. Please add your env variables in .env.local.');
      setLoading(false);
      return;
    }

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/profile');
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your inbox for a confirmation email to complete sign up.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: Provider) => {
    if (!supabase) return;
    setOauthLoading(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setMessage(error.message);
      setOauthLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-300 bg-white p-6">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        {message && (
          <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${message.startsWith('Check') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !supabase}
          className="mt-6 w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Working…' : 'Continue with email'}
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-slate-50 px-2 text-slate-600">OR</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {OAUTH_PROVIDERS.map(({ provider, label, icon, className }) => (
          <button
            key={provider}
            type="button"
            disabled={!!oauthLoading || !supabase}
            onClick={() => handleOAuth(provider)}
            className={`flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
          >
            {oauthLoading === provider ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              icon
            )}
            Continue with {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg bg-slate-50 p-4 text-center text-sm">
        <p className="text-slate-600">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(null); }}
            className="font-semibold text-blue-600 hover:underline"
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

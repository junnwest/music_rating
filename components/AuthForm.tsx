'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    if (!supabase) {
      setMessage('Supabase is not configured. Add your env variables in .env.local.');
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
        setMessage('Check your inbox for a confirmation email.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!supabase) return;
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setMessage(error.message);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="w-[420px]">
      {/* Toggle pill */}
      <div className="flex bg-surface rounded-[10px] p-1 mb-[30px]">
        {(['login', 'signup'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMessage(null); }}
            className={`flex-1 py-[10px] text-center rounded-[7px] text-[14px] font-semibold transition ${
              mode === m
                ? 'bg-white border border-[#EBEBEB] text-ink shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                : 'text-muted'
            }`}
          >
            {m === 'login' ? 'Log in' : 'Sign up'}
          </button>
        ))}
      </div>

      {/* Heading */}
      <h1
        className="text-[30px] font-extrabold text-ink mb-1.5"
        style={{ letterSpacing: '-0.9px' }}
      >
        {mode === 'login' ? 'Welcome back.' : 'Join neiro.'}
      </h1>
      <p className="text-[14px] text-muted mb-[30px] leading-relaxed">
        {mode === 'login'
          ? 'Log in to see your ratings, reviews, and recommendations.'
          : 'Start cataloging your listening life — free forever.'}
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'signup' && (
          <div>
            <label className="block text-[13px] font-semibold text-ink mb-[7px]">Username</label>
            <input
              type="text"
              placeholder="e.g. tonehunter"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white border-[1.5px] border-[#EBEBEB] rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-[#C0C0BE] outline-none focus:border-ink transition"
            />
          </div>
        )}

        <div>
          <label className="block text-[13px] font-semibold text-ink mb-[7px]">Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-white border-[1.5px] border-[#EBEBEB] rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-[#C0C0BE] outline-none focus:border-ink transition"
          />
        </div>

        <div>
          <div className="flex justify-between mb-[7px]">
            <label className="text-[13px] font-semibold text-ink">Password</label>
            {mode === 'login' && (
              <button type="button" className="text-[12px] font-medium text-muted hover:text-mid transition">
                Forgot password?
              </button>
            )}
          </div>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-white border-[1.5px] border-[#EBEBEB] rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-[#C0C0BE] outline-none focus:border-ink transition"
          />
        </div>

        {message && (
          <p
            className={`text-sm px-4 py-3 rounded-lg ${
              message.startsWith('Check')
                ? 'bg-mint-bg text-mint-dark'
                : 'bg-red-50 text-red-600'
            }`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !supabase}
          className="w-full bg-ink text-white rounded-lg py-[14px] text-[15px] font-bold text-center transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 mt-2"
        >
          {loading ? 'Working…' : mode === 'login' ? 'Log in →' : 'Create account →'}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-[#EBEBEB]" />
        <span className="text-[12px] text-muted">or</span>
        <div className="flex-1 h-px bg-[#EBEBEB]" />
      </div>

      {/* Google SSO */}
      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading || !supabase}
        className="w-full bg-white border-[1.5px] border-[#EBEBEB] rounded-lg py-3 text-[14px] font-semibold text-ink text-center transition hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {googleLoading ? 'Redirecting…' : 'Continue with Google'}
      </button>

      {/* Switch mode */}
      <p className="mt-[22px] text-center text-[13px] text-muted">
        {mode === 'login' ? (
          <>No account yet?{' '}
            <button onClick={() => { setMode('signup'); setMessage(null); }} className="font-semibold text-ink hover:underline">
              Sign up free →
            </button>
          </>
        ) : (
          <>Already have one?{' '}
            <button onClick={() => { setMode('login'); setMessage(null); }} className="font-semibold text-ink hover:underline">
              Log in →
            </button>
          </>
        )}
      </p>

      {/* Value prop card */}
      <div
        className="mt-[30px] px-4 py-[14px] rounded-[10px]"
        style={{ background: '#EDFFF9', border: '1.5px solid #3DFFD1' }}
      >
        <p className="text-[13px] font-semibold text-mint-dark mb-1">
          One rating per album. Your taste, tracked.
        </p>
        <p className="text-[12px] text-mint-dark leading-[1.55]" style={{ opacity: 0.75 }}>
          Rate out of 5 stars, write reviews, build your catalog, follow friends.
        </p>
      </div>
    </div>
  );
}

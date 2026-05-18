'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [underConstruction, setUnderConstruction] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (!awaitingConfirmation || !supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        router.push('/onboarding');
      }
    });
    return () => subscription.unsubscribe();
  }, [awaitingConfirmation]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (!supabase || resendCooldown > 0) return;
    await supabase.auth.resend({ type: 'signup', email });
    setResendCooldown(60);
  };

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
        let loginEmail = email.trim();
        if (!loginEmail.includes('@')) {
          const res = await fetch('/api/auth/resolve-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginEmail }),
          });
          if (!res.ok) throw new Error('No account found with that username.');
          const data = await res.json();
          loginEmail = data.email;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (error) throw error;
        router.push('/profile');
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          setMessage('Passwords do not match.');
          setLoading(false);
          return;
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        });
        if (error) throw error;
        if (signUpData.user?.identities?.length === 0) {
          setMessage('An account with this email already exists. Try logging in instead.');
          setLoading(false);
          return;
        }
        setAwaitingConfirmation(true);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setMessage('Check your inbox for a password reset link.');
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

  const handleSpotify = async () => {
    if (!supabase) return;
    setSpotifyLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'spotify',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setMessage(error.message);
      setSpotifyLoading(false);
    }
  };


  if (awaitingConfirmation) {
    return (
      <div className="w-[420px]">
        <div className="flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: '#EDFFF9', border: '1.5px solid #3DFFD1' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00C2A8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h1 className="text-[26px] font-extrabold text-ink mb-2" style={{ letterSpacing: '-0.7px' }}>
            Check your inbox.
          </h1>
          <p className="text-[14px] text-muted leading-relaxed mb-1">
            We sent a confirmation link to
          </p>
          <p className="text-[14px] font-semibold text-ink mb-6">{email}</p>
          <p className="text-[13px] text-muted leading-relaxed mb-8">
            Click the link in that email to confirm your address and finish setting up your profile. The link expires in 24 hours.
          </p>

          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
          </button>

          <button
            type="button"
            onClick={() => { setAwaitingConfirmation(false); setMode('signup'); setMessage(null); }}
            className="text-[13px] text-muted hover:text-ink transition"
          >
            ← Wrong email? Go back
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="w-[420px]">
        <h1 className="text-[30px] font-extrabold text-ink mb-1.5" style={{ letterSpacing: '-0.9px' }}>
          Reset your password.
        </h1>
        <p className="text-[14px] text-muted mb-[30px] leading-relaxed">
          Enter your email and we'll send you a link to set a new password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-ink mb-[7px]">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
            />
          </div>

          {message && (
            <p className={`text-sm px-4 py-3 rounded-lg ${message.startsWith('Check') ? 'bg-mint-bg text-mint-dark' : 'bg-red-50 text-red-600'}`}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !supabase}
            className="w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[14px] text-[15px] font-bold text-center transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 mt-2"
          >
            {loading ? 'Sending…' : 'Send reset link →'}
          </button>
        </form>

        <p className="mt-[22px] text-center text-[13px] text-muted">
          <button onClick={() => { setMode('login'); setMessage(null); }} className="font-semibold text-ink hover:underline">
            ← Back to log in
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="w-[420px]">
      {/* Toggle pill */}
      <div className="flex bg-surface rounded-[10px] p-1 mb-[30px]">
        {(['login', 'signup'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMessage(null); setConfirmPassword(''); }}
            className={`flex-1 py-[10px] text-center rounded-[7px] text-[14px] font-semibold transition ${
              mode === m
                ? 'bg-page border border-divider text-ink shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
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
        {mode === 'login' ? 'Welcome back.' : 'Join sillajuku.'}
      </h1>
      <p className="text-[14px] text-muted mb-[30px] leading-relaxed">
        {mode === 'login'
          ? 'Log in to see your ratings, reviews, and recommendations.'
          : 'Start cataloging your listening life — free forever.'}
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[13px] font-semibold text-ink mb-[7px]">
            {mode === 'login' ? 'Email or username' : 'Email'}
          </label>
          <input
            type={mode === 'login' ? 'text' : 'email'}
            placeholder={mode === 'login' ? 'you@example.com or username' : 'you@example.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
          />
        </div>

        <div>
          <div className="flex justify-between mb-[7px]">
            <label className="text-[13px] font-semibold text-ink">Password</label>
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setMessage(null); }}
                className="text-[12px] font-medium text-muted hover:text-mid transition"
              >
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
            className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
          />
        </div>

        {mode === 'signup' && (
          <div>
            <label className="block text-[13px] font-semibold text-ink mb-[7px]">Confirm password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
            />
          </div>
        )}

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
          className="w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[14px] text-[15px] font-bold text-center transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 mt-2"
        >
          {loading ? 'Working…' : mode === 'login' ? 'Log in →' : 'Create account →'}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-[#EBEBEB]" />
        <span className="text-[12px] text-muted">or continue with</span>
        <div className="flex-1 h-px bg-[#EBEBEB]" />
      </div>

      {/* OAuth buttons */}
      <div className="flex justify-center gap-10">
        {/* Google */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleLoading || !supabase}
          title="Continue with Google"
          className="w-12 h-12 rounded-xl border-[1.5px] border-divider bg-surface flex items-center justify-center hover:bg-surface transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        </button>

        {/* Spotify */}
        <button
          type="button"
          onClick={handleSpotify}
          disabled={spotifyLoading || !supabase}
          title="Continue with Spotify"
          className="w-12 h-12 rounded-xl bg-[#1DB954] flex items-center justify-center hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 0 1-.277-1.215c3.809-.87 7.077-.496 9.712 1.115a.622.622 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 0 1-.973-.519.781.781 0 0 1 .52-.973c3.632-1.102 8.147-.568 11.233 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 1 1-.543-1.793c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 0 1-.954 1.612z"/>
          </svg>
        </button>

        {/* KakaoTalk */}
        <button
          type="button"
          onClick={() => setUnderConstruction(true)}
          title="Continue with KakaoTalk"
          className="w-12 h-12 rounded-xl bg-[#FEE500] flex items-center justify-center hover:opacity-90 transition"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.607 5.086 4.035 6.534l-.963 3.574a.3.3 0 0 0 .453.328L9.941 18.9A11.66 11.66 0 0 0 12 19.1c5.523 0 10-3.477 10-7.8C22 6.477 17.523 3 12 3z" fill="#3C1E1E"/>
          </svg>
        </button>

        {/* Apple */}
        <button
          type="button"
          onClick={() => setUnderConstruction(true)}
          title="Continue with Apple"
          className="w-12 h-12 rounded-xl bg-black flex items-center justify-center hover:opacity-80 transition"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.39-1.32 2.76-2.54 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
        </button>
      </div>



      {/* Under construction modal */}
      {underConstruction && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setUnderConstruction(false)}>
          <div className="bg-page rounded-2xl p-8 max-w-[320px] w-full mx-4 text-center shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-2xl mb-3">🚧</p>
            <h3 className="text-[16px] font-bold text-ink mb-2">Coming soon</h3>
            <p className="text-[13px] text-muted leading-relaxed mb-5">This login option is under construction. Use email, Google, or Spotify for now.</p>
            <button onClick={() => setUnderConstruction(false)} className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition">
              Got it
            </button>
          </div>
        </div>
      )}

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

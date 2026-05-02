import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  return (
    <div className="bg-white text-ink flex flex-col min-h-screen">
      {/* Auth Header */}
      <header className="border-b border-divider flex items-center px-5 md:px-9 h-[72px]">
        <Link to="/" className="flex items-center">
          <img src="/logo.png" alt="sillajuku" className="h-[44px] w-auto object-contain" />
        </Link>
      </header>

      {/* Auth Form */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-[400px]"
        >
          {/* Brand icon */}
          <div className="mb-6">
            <img src="/logo.png" alt="sillajuku" className="h-20 w-auto object-contain" />
          </div>

          {/* Mode toggle */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-[13px] font-semibold border-b-2 transition ${mode === 'login' ? 'text-ink border-ink' : 'text-muted border-divider hover:text-ink'}`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 text-[13px] font-semibold border-b-2 transition ${mode === 'signup' ? 'text-ink border-ink' : 'text-muted border-divider hover:text-ink'}`}
            >
              Sign up
            </button>
          </div>

          {/* Heading */}
          <h1 className="text-[30px] font-extrabold text-ink mb-1.5 tracking-tight">
            {mode === 'login' ? 'Welcome back.' : 'Join sillajuku.'}
          </h1>
          <p className="text-[14px] text-muted mb-[30px] leading-relaxed">
            {mode === 'login'
              ? 'Log in to see your ratings, reviews, and recommendations.'
              : 'Create an account to start rating and discovering music.'}
          </p>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-ink mb-[7px]">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-ink mb-[7px]">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
              />
            </div>
            <button className="w-full bg-ink text-white rounded-lg py-[13px] text-[14px] font-bold hover:opacity-80 transition">
              {mode === 'login' ? 'Log in →' : 'Sign up →'}
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-divider" />
            <span className="text-[12px] text-muted">or</span>
            <div className="flex-1 h-px bg-divider" />
          </div>

          {/* Google OAuth */}
          <button className="w-full border border-divider rounded-lg py-[12px] text-[14px] font-semibold text-ink flex items-center justify-center gap-2 hover:bg-surface transition">
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>

          {/* Sign up link */}
          <p className="text-[13px] text-muted text-center mt-5">
            {mode === 'login' ? (
              <>Don't have an account? <Link to="/onboarding" className="text-ink font-semibold hover:underline">Sign up</Link></>
            ) : (
              <>Already have an account? <button onClick={() => setMode('login')} className="text-ink font-semibold hover:underline">Log in</button></>
            )}
          </p>
        </motion.div>
      </main>
    </div>
  );
}

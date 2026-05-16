'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);

    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }

    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace('/profile');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-[420px]">
      <h1 className="text-[30px] font-extrabold text-ink mb-1.5" style={{ letterSpacing: '-0.9px' }}>
        Set a new password.
      </h1>
      <p className="text-[14px] text-muted mb-[30px] leading-relaxed">
        Choose a strong password for your account.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[13px] font-semibold text-ink mb-[7px]">New password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold text-ink mb-[7px]">Confirm password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="w-full bg-surface border-[1.5px] border-divider rounded-lg px-[14px] py-3 text-[14px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition"
          />
        </div>

        {message && (
          <p className={`text-sm px-4 py-3 rounded-lg ${message.startsWith('Passwords') || message.startsWith('Password must') || message.startsWith('Failed') ? 'bg-red-50 text-red-600' : 'bg-mint-bg text-mint-dark'}`}>
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !supabase}
          className="w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[14px] text-[15px] font-bold text-center transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 mt-2"
        >
          {loading ? 'Saving…' : 'Update password →'}
        </button>
      </form>
    </div>
  );
}

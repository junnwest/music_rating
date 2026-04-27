'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function CreateListSection() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        setUserId(user.id);
        setUsername(user.email?.split('@')[0] ?? 'user');
      }
    });
  }, []);

  if (!userId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, userId, username }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? 'Failed to create list');
      return;
    }

    setTitle('');
    setDescription('');
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-4 py-2 hover:opacity-80 transition"
      >
        + New List
      </button>
    );
  }

  return (
    <div className="border border-[#EBEBEB] rounded-xl p-5 bg-surface w-full mt-6">
      <h3 className="text-[15px] font-bold text-ink mb-4">Create a new list</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="text-[12px] font-medium text-muted mb-1 block">List name *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. My Favorite K-Pop Albums"
            maxLength={80}
            required
            className="w-full text-sm border border-[#EBEBEB] rounded-lg px-3 py-2 bg-white text-ink outline-none focus:border-mint transition"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-muted mb-1 block">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this list about?"
            maxLength={200}
            className="w-full text-sm border border-[#EBEBEB] rounded-lg px-3 py-2 bg-white text-ink outline-none focus:border-mint transition"
          />
        </div>
        {error && <p className="text-[12px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-4 py-2 hover:opacity-80 transition disabled:opacity-40"
          >
            {submitting ? 'Creating…' : 'Create List'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setTitle(''); setDescription(''); setError(''); }}
            className="text-[13px] font-medium text-muted hover:text-ink transition px-4 py-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

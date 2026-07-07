'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpCircle, MessageSquare } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { profileHandle } from '../../lib/sj/data';
import { relativeTime } from '../../lib/sj/display';

interface CommentRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string | null; display_name: string | null } | null;
}

/** Comment thread on a rating — mirrors iOS CommentSheetView. */
export default function CommentsModal({
  open,
  onClose,
  ratingId,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  ratingId: string;
  onCountChange?: (count: number) => void;
}) {
  const { t, lang } = useLanguage();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const { data } = await supabase
      .from('rating_comments')
      .select(
        'id, user_id, content, created_at, profiles!rating_comments_user_id_fkey(username, display_name)',
      )
      .eq('rating_id', ratingId)
      .order('created_at', { ascending: true });
    const rows = (data as unknown as CommentRow[] | null) ?? [];
    setComments(rows);
    onCountChange?.(rows.length);
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ratingId]);

  async function send() {
    if (!supabase) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setError(t('sj.comments.signInRequired'));
      return;
    }
    setSending(true);
    const { error: insertError } = await supabase
      .from('rating_comments')
      .insert({ user_id: uid, rating_id: ratingId, content: trimmed });
    if (insertError) {
      setError(insertError.message);
    } else {
      setText('');
      setError(null);
      await load();
    }
    setSending(false);
  }

  const title = loading
    ? t('sj.comments.title')
    : comments.length === 1
      ? t('sj.comments.one')
      : t('sj.comments.many').replace('{n}', String(comments.length));

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-lg">
      <div className="flex flex-col min-h-[300px]">
        <div className="flex-1">
          {loading ? (
            <p className="py-14 text-center text-[13px] text-muted">…</p>
          ) : comments.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-3 text-muted">
              <MessageSquare size={32} className="text-divider" />
              <p className="text-[14px] whitespace-pre-line text-center">
                {t('sj.comments.empty')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-divider">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="flex w-8 h-8 rounded-full bg-accent-soft text-accent-deep items-center justify-center text-[12px] font-bold shrink-0">
                    {profileHandle(c.profiles).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-baseline gap-2">
                      <Link
                        href={`/profile/${c.profiles?.username ?? ''}`}
                        className="text-[13px] font-semibold text-ink hover:underline"
                      >
                        @{profileHandle(c.profiles)}
                      </Link>
                      <span className="text-[11.5px] text-muted">
                        {relativeTime(c.created_at, lang)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[14px] text-ink whitespace-pre-wrap break-words">
                      {c.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="px-5 py-2 text-[12px] text-red-500 bg-red-500/[0.06]">{error}</p>
        )}

        <div className="sticky bottom-0 flex items-center gap-2.5 px-4 py-3 bg-surface border-t border-divider">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={t('sj.comments.placeholder')}
            className="flex-1 bg-transparent text-[14px] text-ink placeholder-placeholder outline-none"
          />
          {text.trim() !== '' && (
            <button
              onClick={send}
              disabled={sending}
              aria-label={t('sj.comments.send')}
              className="text-accent hover:opacity-80 disabled:opacity-50 transition"
            >
              <ArrowUpCircle size={26} />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

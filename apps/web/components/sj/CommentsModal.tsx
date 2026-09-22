'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpCircle, MessageSquare, X } from 'lucide-react';
import Avatar from './Avatar';
import Modal from './Modal';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { profileHandle } from '../../lib/sj/data';
import { relativeTime } from '../../lib/sj/display';

interface CommentRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
}

/** Comment thread on a rating — mirrors iOS CommentSheetView, including its
 * edit UX: editing an own comment moves to the compose bar (an "Editing
 * comment" header above it, pre-filled, auto-focused) rather than inline in
 * the row, matching Instagram's own comment editing flow. */
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
  const { userId, requireAuth } = useSession();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!supabase) return;
    const { data } = await supabase
      .from('rating_comments')
      .select(
        'id, user_id, content, created_at, profiles!rating_comments_user_id_fkey(username, display_name, avatar_url)',
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

  function requestEdit(c: CommentRow) {
    setEditingId(c.id);
    setText(c.content);
    inputRef.current?.focus();
  }

  function cancelEdit() {
    setEditingId(null);
    setText('');
  }

  async function submit() {
    if (editingId) {
      await saveEdit(editingId);
    } else {
      await send();
    }
  }

  async function send() {
    if (!supabase) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!requireAuth() || !userId) return;
    setSending(true);
    const { error: insertError } = await supabase
      .from('rating_comments')
      .insert({ user_id: userId, rating_id: ratingId, content: trimmed });
    if (insertError) {
      setError(insertError.message);
    } else {
      setText('');
      setError(null);
      await load();
    }
    setSending(false);
  }

  async function saveEdit(id: string) {
    if (!supabase) return;
    const trimmed = text.trim();
    const original = comments.find((c) => c.id === id)?.content;
    setEditingId(null);
    setText('');
    if (!trimmed || trimmed === original) return;
    const { error: updateError } = await supabase
      .from('rating_comments')
      .update({ content: trimmed })
      .eq('id', id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setError(null);
      await load();
    }
  }

  async function deleteComment(id: string) {
    if (!supabase) return;
    setConfirmDeleteId(null);
    const { error: deleteError } = await supabase.from('rating_comments').delete().eq('id', id);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setError(null);
      await load();
    }
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
              {comments.map((c) => {
                const isOwn = userId != null && c.user_id === userId;
                return (
                  <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                    <Avatar url={c.profiles?.avatar_url} size={32} />
                    <div className="min-w-0 flex-1">
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
                      {isOwn && (
                        <div className="flex gap-3.5 mt-1">
                          <button
                            onClick={() => requestEdit(c)}
                            className="text-[12px] font-medium text-muted hover:text-ink"
                          >
                            {t('sj.common.edit')}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(c.id)}
                            className="text-[12px] font-medium text-muted hover:text-ink"
                          >
                            {t('sj.common.delete')}
                          </button>
                        </div>
                      )}
                      {confirmDeleteId === c.id && (
                        <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-red-500/[0.06] border border-red-500/20">
                          <p className="text-[12px] text-ink">{t('sj.comments.deleteConfirm')}</p>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-lg text-[11.5px] font-medium text-muted hover:text-ink"
                            >
                              {t('sj.common.cancel')}
                            </button>
                            <button
                              onClick={() => deleteComment(c.id)}
                              className="px-2 py-1 rounded-lg text-[11.5px] font-medium text-red-500 hover:bg-red-500/10"
                            >
                              {t('sj.common.delete')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="px-5 py-2 text-[12px] text-red-500 bg-red-500/[0.06]">{error}</p>
        )}

        <div className="sticky bottom-0 bg-surface border-t border-divider">
          {editingId && (
            <div className="flex items-center justify-between px-4 pt-2.5">
              <span className="text-[12px] font-medium text-muted">
                {t('sj.comments.editing')}
              </span>
              <button
                onClick={cancelEdit}
                aria-label={t('sj.common.cancel')}
                className="p-1 text-muted hover:text-ink transition"
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-4 py-3">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit()}
              placeholder={editingId ? t('sj.comments.editPlaceholder') : t('sj.comments.placeholder')}
              className="flex-1 bg-transparent text-[14px] text-ink placeholder-placeholder outline-none"
            />
            {text.trim() !== '' && (
              <button
                onClick={submit}
                disabled={sending}
                aria-label={t('sj.comments.send')}
                className="text-accent hover:opacity-80 disabled:opacity-50 transition"
              >
                <ArrowUpCircle size={26} />
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

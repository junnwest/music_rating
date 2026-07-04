'use client';

import { useState } from 'react';
import { MoreHorizontal, Flag, Ban, Check } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const REASONS = ['Spam', 'Inappropriate Content', 'Harassment', 'Other'] as const;

interface Props {
  reportedUserId: string;
  ratingId?: string | null;
  onBlocked?: () => void;
}

export default function ReportBlockMenu({ reportedUserId, ratingId = null, onBlocked }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'report' | 'reported' | 'blockConfirm' | 'blocked'>('menu');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setTimeout(() => setMode('menu'), 200);
  };

  const submitReport = async (reason: string) => {
    if (!supabase || submitting) return;
    setSubmitting(true);
    setError(null);
    const { data: session } = await supabase.auth.getSession();
    const reporterId = session.session?.user?.id;
    if (!reporterId) {
      setError('Sign in to report content.');
      setSubmitting(false);
      return;
    }
    const { error: err } = await supabase.from('reports').insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      rating_id: ratingId,
      reason,
    });
    setSubmitting(false);
    if (err) {
      setError('Could not submit your report. Please try again.');
      return;
    }
    setMode('reported');
  };

  const submitBlock = async () => {
    if (!supabase || submitting) return;
    setSubmitting(true);
    setError(null);
    const { data: session } = await supabase.auth.getSession();
    const blockerId = session.session?.user?.id;
    if (!blockerId) {
      setError('Sign in to block users.');
      setSubmitting(false);
      return;
    }
    const { error: err } = await supabase.from('blocked_users').insert({
      blocker_id: blockerId,
      blocked_id: reportedUserId,
    });
    setSubmitting(false);
    if (err) {
      setError('Could not block this user. Please try again.');
      return;
    }
    setMode('blocked');
    onBlocked?.();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        className="p-1 rounded-full text-muted hover:text-ink hover:bg-surface transition"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-page border border-divider rounded-xl shadow-lg overflow-hidden">
            {mode === 'menu' && (
              <>
                <button
                  onClick={() => setMode('report')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink hover:bg-surface transition text-left"
                >
                  <Flag size={14} className="text-muted" /> Report
                </button>
                <button
                  onClick={() => setMode('blockConfirm')}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink hover:bg-surface transition text-left"
                >
                  <Ban size={14} className="text-muted" /> Block user
                </button>
              </>
            )}

            {mode === 'report' && (
              <>
                <p className="px-4 pt-3 pb-2 text-[11px] font-semibold text-muted uppercase" style={{ letterSpacing: '0.5px' }}>
                  Why are you reporting this?
                </p>
                {REASONS.map((reason) => (
                  <button
                    key={reason}
                    disabled={submitting}
                    onClick={() => submitReport(reason)}
                    className="w-full flex items-center px-4 py-2.5 text-[13px] text-ink hover:bg-surface transition text-left disabled:opacity-50"
                  >
                    {reason}
                  </button>
                ))}
                {error && <p className="px-4 pb-3 text-[11px] text-red-500">{error}</p>}
              </>
            )}

            {mode === 'reported' && (
              <div className="px-4 py-4 flex items-start gap-2">
                <Check size={15} className="text-mint-dark flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold text-ink">Report submitted</p>
                  <p className="text-[12px] text-muted mt-0.5">Thanks for helping keep sillajuku safe.</p>
                </div>
              </div>
            )}

            {mode === 'blockConfirm' && (
              <div className="px-4 py-3">
                <p className="text-[13px] text-ink mb-3">Block this user? They won&apos;t appear in your feed anymore.</p>
                {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={submitting}
                    onClick={submitBlock}
                    className="flex-1 py-1.5 rounded-lg bg-ink text-white text-[12px] font-semibold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {submitting ? '…' : 'Block'}
                  </button>
                  <button
                    onClick={() => setMode('menu')}
                    className="flex-1 py-1.5 rounded-lg border border-divider text-[12px] font-semibold text-ink hover:bg-surface transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {mode === 'blocked' && (
              <div className="px-4 py-4 flex items-start gap-2">
                <Check size={15} className="text-mint-dark flex-shrink-0 mt-0.5" />
                <p className="text-[13px] font-semibold text-ink">User blocked</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

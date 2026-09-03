'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, X, Clock } from 'lucide-react';
import { useSession } from '../../../components/sj/SessionContext';
import {
  getPeerInviteStatus,
  generatePeerInvite,
  revokeInviteToken,
  listMySentInvites,
  type PeerInviteStatus,
  type SentInvite,
} from '../../../lib/sj/founding';

/**
 * Member-facing "send a peer invite" surface — the sending half of the flow
 * (BetaSwipeFlow/beta/[token] is the receiving half). Three states this page
 * has to carry, in order of how a real member encounters them:
 *  1. Badge still pending — zero invite privileges, explained plainly.
 *  2. Locked in, allotment > 0 remaining — the generate/manage UI.
 *  3. Locked in, allotment exhausted — same UI, generate disabled, progress
 *     toward the next one shown instead of a bare "0 left."
 * No progress *bar* — see design notes on avoiding a gamified-referral feel;
 * progress is one plain sentence, not a filling meter.
 */
export default function InvitePage() {
  const { userId, ready, requireAuth } = useSession();
  const [status, setStatus] = useState<PeerInviteStatus | null>(null);
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [s, invites] = await Promise.all([getPeerInviteStatus(userId), listMySentInvites()]);
    setStatus(s);
    setSent(invites);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!ready) return;
    if (!requireAuth()) return;
    load();
  }, [ready, requireAuth, load]);

  async function onGenerate() {
    setGenerating(true);
    const res = await generatePeerInvite();
    setGenerating(false);
    if (res.ok) await load();
  }

  async function onRevoke(token: string) {
    setRevoking(token);
    const ok = await revokeInviteToken(token);
    setRevoking(null);
    if (ok) await load();
  }

  function copy(token: string) {
    const url = `https://sillajuku.com/beta/${token}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1600);
    });
  }

  if (!ready || loading || !status) {
    return <div className="min-h-screen bg-page" />;
  }

  // ── State 1: badge still pending ──────────────────────────────────────────
  if (!status.badgeLockedIn) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-16">
        <h1 className="text-[24px] font-extrabold tracking-tight text-ink mb-3">Invites</h1>
        <div className="rounded-2xl border border-divider bg-surface px-6 py-8 text-center">
          <p className="text-[15px] font-semibold text-ink mb-2">Your badge isn't locked in yet</p>
          <p className="text-[13.5px] text-muted leading-relaxed max-w-[380px] mx-auto">
            Invite privileges open up once your founding badge locks in — that's what keeps every
            invite traceable to someone who's actually here.
          </p>
        </div>
      </div>
    );
  }

  const pct = status.ratingsPerInvite ? status.progressRatings / status.ratingsPerInvite : 0;

  return (
    <div className="max-w-[560px] mx-auto px-6 py-16">
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink mb-8">Invites</h1>

      {/* Allotment status — one number, one plain sentence. No progress bar. */}
      <div className="rounded-2xl border border-divider bg-surface px-6 py-6 mb-8">
        <div className="flex items-end gap-2 mb-3">
          <span className="text-[40px] font-extrabold tracking-tight text-ink leading-none tabular-nums">
            {status.remaining}
          </span>
          <span className="text-[13px] text-muted mb-1">
            {status.remaining === 1 ? 'invite remaining' : 'invites remaining'} · {status.used} sent
          </span>
        </div>
        {status.ratingsPerInvite != null && (
          <div className="flex items-center gap-2">
            <div className="relative h-1 w-24 rounded-full bg-divider overflow-hidden shrink-0">
              <div
                className="absolute inset-y-0 left-0 bg-ink/40 rounded-full"
                style={{ width: `${Math.round(pct * 100)}%` }}
              />
            </div>
            <p className="text-[12px] text-muted">
              {status.ratingsUntilNext} more rating{status.ratingsUntilNext === 1 ? '' : 's'} earns another
            </p>
          </div>
        )}
        <button
          onClick={onGenerate}
          disabled={generating || status.remaining <= 0}
          className="mt-5 w-full py-3 rounded-xl bg-ink text-page text-[14px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
        >
          {generating ? 'Creating…' : status.remaining <= 0 ? 'No invites left' : 'Create invite link'}
        </button>
      </div>

      {/* Sent invites — pending / redeemed / revoked / expired. */}
      <div>
        <p className="text-[13px] font-semibold text-muted mb-3">Sent</p>
        {sent.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing sent yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sent.map((inv) => (
              <SentInviteRow
                key={inv.token}
                invite={inv}
                onCopy={() => copy(inv.token)}
                onRevoke={() => onRevoke(inv.token)}
                copied={copiedToken === inv.token}
                revoking={revoking === inv.token}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentInviteRow({
  invite,
  onCopy,
  onRevoke,
  copied,
  revoking,
}: {
  invite: SentInvite;
  onCopy: () => void;
  onRevoke: () => void;
  copied: boolean;
  revoking: boolean;
}) {
  const now = Date.now();
  const expired = new Date(invite.expires_at).getTime() < now;
  const state = invite.redeemed_by
    ? 'redeemed'
    : invite.revoked_at
      ? 'revoked'
      : expired
        ? 'expired'
        : 'pending';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-divider bg-surface px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-mono text-ink truncate">{invite.token}</p>
        <p className="text-[11.5px] text-muted">
          {state === 'redeemed' && 'Redeemed'}
          {state === 'revoked' && 'Revoked'}
          {state === 'expired' && 'Expired — slot returned to your allotment'}
          {state === 'pending' && `Expires ${new Date(invite.expires_at).toLocaleDateString()}`}
        </p>
      </div>
      {state === 'pending' && (
        <>
          <button
            onClick={onCopy}
            aria-label="Copy link"
            className="p-2 rounded-lg text-muted hover:text-ink hover:bg-ink/5 transition"
          >
            {copied ? <Check size={15} className="text-accent" /> : <Copy size={15} />}
          </button>
          <button
            onClick={onRevoke}
            disabled={revoking}
            aria-label="Revoke"
            className="p-2 rounded-lg text-muted hover:text-red-500 hover:bg-red-500/5 transition disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </>
      )}
      {state === 'redeemed' && (
        <span className="p-2 text-accent">
          <Check size={15} />
        </span>
      )}
      {(state === 'expired' || state === 'revoked') && (
        <span className="p-2 text-muted">
          <Clock size={15} />
        </span>
      )}
    </div>
  );
}

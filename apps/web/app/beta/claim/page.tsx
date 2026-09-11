'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { redeemInviteToken } from '../../../lib/sj/founding';
import FoundingBadge from '../../../components/sj/FoundingBadge';

type Status = 'loading' | 'ready' | 'claiming' | 'claimed' | 'error';

/**
 * The post-auth half of the (now sole) signup path — see
 * InviteSwipeFlow.tsx for the pre-auth pages (was BetaSwipeFlow). Landed on
 * two ways: an already-onboarded user is sent here directly by
 * /auth/callback's `next` param; a brand-new user is sent here by
 * onboarding's finish() once their profiles row actually exists
 * (redeem_invite_token needs that row to attach the founding number to).
 * Either way the token itself travels via localStorage
 * (sj_pending_beta_token, set by InviteSwipeFlow before the OAuth redirect)
 * rather than the URL, since it has to survive a provider round-trip and,
 * for new users, the whole onboarding flow too.
 */
export default function ClaimInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [number, setNumber] = useState<number | null>(null);

  useEffect(() => {
    async function init() {
      if (!supabase) {
        router.replace('/');
        return;
      }
      const token = window.localStorage.getItem('sj_pending_beta_token');
      if (!token) {
        router.replace('/');
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setStatus('ready');
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function claim() {
    const token = window.localStorage.getItem('sj_pending_beta_token');
    if (!token) {
      router.replace('/');
      return;
    }
    setStatus('claiming');
    const result = await redeemInviteToken(token);
    window.localStorage.removeItem('sj_pending_beta_token');
    if (!result.ok) {
      setErrorMessage(errorCopy(result.reason));
      setStatus('error');
      return;
    }
    setNumber(result.number ?? null);
    setStatus('claimed');
  }

  if (status === 'loading') {
    return <div className="min-h-screen bg-page" />;
  }

  const claimed = status === 'claimed';

  return (
    <div className="relative min-h-screen overflow-hidden bg-page flex flex-col items-center justify-center px-6">
      <div className="relative w-full max-w-sm flex flex-col items-center text-center">
        <div className="text-[11px] font-bold tracking-[0.08em] text-muted mb-3">마지막 단계</div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink mb-7">당신의 혜택.</h1>

        <div className="w-full flex flex-col gap-2.5 mb-7">
          <BenefitRow
            icon={
              claimed && number != null ? (
                <FoundingBadge direction="chip" status="pending" number={number} size={22} />
              ) : (
                <span className="text-[13px] font-bold text-ink/30">#</span>
              )
            }
            title={claimed && number != null ? `창립 멤버 #${number}` : '창립 멤버 번호'}
            desc={
              claimed
                ? '활동을 시작하면 번호가 확정돼요'
                : '가입 즉시 번호가 예약돼요'
            }
            claimed={claimed}
          />
          <BenefitRow
            icon={<ShieldCheck size={17} />}
            iconColor="#2979B7"
            title="평생 광고 없음"
            desc="앞으로도 광고 없이."
            claimed={claimed}
          />
        </div>

        {status === 'error' && (
          <p className="w-full mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[13px]">
            {errorMessage}
          </p>
        )}

        {!claimed ? (
          <button
            onClick={claim}
            disabled={status === 'claiming'}
            className="w-full py-3.5 rounded-xl bg-ink text-page text-[14px] font-bold transition disabled:opacity-70 hover:opacity-90"
          >
            {status === 'claiming' ? '받는 중…' : '혜택 받기'}
          </button>
        ) : (
          <button
            onClick={() => router.push('/')}
            className="w-full py-3.5 rounded-xl bg-ink text-page text-[14px] font-bold transition hover:opacity-90"
          >
            sillajuku로 이동
          </button>
        )}

        {status === 'error' && (
          <button
            onClick={() => router.push('/')}
            className="mt-4 text-[12px] text-muted hover:text-ink transition"
          >
            나중에, sillajuku로 이동
          </button>
        )}
      </div>
    </div>
  );
}

function errorCopy(reason?: string): string {
  switch (reason) {
    case 'already_a_member':
      return '이미 창립 멤버로 등록되어 있어요.';
    case 'cap_reached':
      return '창립 멤버 999명이 모두 채워졌어요.';
    default:
      return '이미 사용되었거나 유효하지 않은 링크예요.';
  }
}

function BenefitRow({
  icon,
  iconColor,
  title,
  desc,
  claimed,
}: {
  icon: React.ReactNode;
  iconColor?: string;
  title: string;
  desc: string;
  claimed: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl border transition-all ${
        claimed ? 'bg-accent-soft border-accent/25 scale-[1.015]' : 'bg-ink/[0.035] border-divider'
      }`}
    >
      <div
        className="w-[34px] h-[34px] rounded-[10px] bg-page border border-divider flex items-center justify-center shrink-0"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[12.5px] font-bold text-ink">{title}</div>
        <div className="text-[10.5px] text-muted">{desc}</div>
      </div>
      <div
        className={`w-[18px] h-[18px] rounded-full bg-accent flex items-center justify-center shrink-0 transition-all ${
          claimed ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
        }`}
      >
        <Check size={10} strokeWidth={3} color="white" />
      </div>
    </div>
  );
}

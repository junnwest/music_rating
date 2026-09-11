'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getInviteTokenPreview, getFoundingCohortSummary, type InviteTokenPreview } from '../lib/sj/founding';

type Provider = 'spotify' | 'apple' | 'google';

// Same "force the account picker back open" params as app/(auth)/login/page.tsx —
// kept in sync there since this duplicates that OAuth call rather than importing
// it, to keep the invite flow self-contained.
function accountChooserParams(provider: Provider): Record<string, string> {
  switch (provider) {
    case 'google':
      return { prompt: 'select_account' };
    case 'spotify':
      return { show_dialog: 'true' };
    default:
      return {};
  }
}

const PAGE_COUNT = 4;

/**
 * The pre-auth half of the (now sole) signup path — sillajuku is fully
 * closed/invite-only, so every account arrives through here, whether the
 * token is team-issued or a peer invite. Was BetaSwipeFlow — renamed since
 * "beta" undersold what this is now (see app/beta/[token]/page.tsx, which
 * keeps its URL for Universal Link / already-sent-link compatibility even
 * though the component underneath changed).
 *
 * Fetches invite_token_preview() before rendering anything else: an invalid,
 * expired, revoked, already-redeemed, or cap-reached token gets its own
 * blocking screen instead of ever reaching the swipe pages — a redeemer who
 * arrives after the founding cohort is full should never get as far as
 * OAuth before finding that out.
 */
export default function InviteSwipeFlow({ token }: { token: string }) {
  const [preview, setPreview] = useState<InviteTokenPreview | 'loading'>('loading');
  const [index, setIndex] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "XXX of 999" — framed as trust (real people already here), not scarcity
  // ("hurry, only N left"). Locked-in count specifically, not pending — a
  // pending number isn't a real member yet, so it shouldn't inflate this.
  const [lockedIn, setLockedIn] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInviteTokenPreview(token).then((p) => {
      if (!cancelled) setPreview(p);
    });
    getFoundingCohortSummary().then((s) => {
      if (!cancelled && s) setLockedIn(s.lockedIn);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function goTo(i: number) {
    setIndex(Math.max(0, Math.min(PAGE_COUNT - 1, i)));
  }

  async function signIn(provider: Provider) {
    if (!supabase) return;
    setLoading(provider);
    setError(null);
    // Survives the OAuth round-trip (same-origin localStorage, unaffected by
    // navigating out to the provider and back) -- read by app/beta/claim and
    // by onboarding's finish() for the brand-new-account path, since a new
    // profiles row doesn't exist yet for the RPC to attach to until then.
    // Key name kept as-is (sj_pending_beta_token) — onboarding/claim already
    // read this exact key, and it's opaque to what kind of invite it is.
    window.localStorage.setItem('sj_pending_beta_token', token);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/beta/claim')}`,
        scopes: provider === 'spotify' ? 'user-top-read user-read-recently-played' : undefined,
        queryParams: accountChooserParams(provider),
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
  }

  if (preview === 'loading') {
    return <div className="min-h-screen bg-page" />;
  }

  if (!preview.valid) {
    return <InvalidTokenScreen reason={preview.reason} />;
  }

  const isPeer = preview.source === 'peer' && preview.inviterUsername;

  return (
    <div className="relative min-h-screen overflow-hidden bg-page flex flex-col items-center justify-center px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -top-40 -right-40 w-[560px] opacity-[0.09]"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -bottom-32 -left-32 w-[420px] opacity-[0.09]"
      />

      <div className="relative w-full max-w-sm flex flex-col items-center">
        <div className="flex items-center gap-1.5 mb-8">
          {Array.from({ length: PAGE_COUNT }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`${i + 1}단계로 이동`}
              className={`h-[5px] rounded-full transition-all ${
                i === index ? 'w-5 bg-ink' : 'w-[5px] bg-divider'
              }`}
            />
          ))}
        </div>

        {index === 0 && (
          <>
            <PageShell
              headline="당신이 사랑했던 모든 음반."
              body="언젠가 가슴을 뛰게 했던 그 음악을 기록하세요."
              onNext={() => goTo(1)}
            />
            {lockedIn != null && (
              <p className="mt-5 text-[11.5px] text-muted">
                지금까지 <span className="font-semibold text-ink/70">{lockedIn}명</span>이 실제로 활동하며 창립 멤버 자리를 지키고 있어요 (999명 중)
              </p>
            )}
          </>
        )}

        {index === 1 && (
          <PageShell
            headline="mélomane"
            tag="멜로마니아 · 프랑스어 · 명사"
            body={
              <>
                음악을 진심으로 사랑하는 사람.
                <br />
                cf. 씨네필 — 영화를 사랑하는 사람
              </>
            }
            onNext={() => goTo(2)}
          />
        )}

        {index === 2 && (
          <div className="flex flex-col items-center text-center w-full">
            {isPeer ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.inviterAvatarUrl || '/logo-flower.svg'}
                  alt=""
                  className="w-14 h-14 rounded-full object-cover mb-5 border border-divider"
                />
                <div className="text-[11px] font-bold tracking-[0.08em] text-muted mb-3">초대장</div>
                <h1 className="text-[22px] font-extrabold tracking-tight text-ink mb-2 max-w-[280px]">
                  {preview.inviterDisplayName || `@${preview.inviterUsername}`}님이 당신을 초대했어요.
                </h1>
                <p className="text-[14px] leading-relaxed text-ink/70 max-w-[260px] mb-8">
                  아무나 받는 초대가 아니에요 — 실라주쿠는 지금 이렇게만 들어올 수 있어요.
                </p>
              </>
            ) : (
              <PageShell
                eyebrow="감사 인사"
                headline="당신이, 가장 먼저입니다."
                body="오로지 실라주쿠가 직접 선정한 창립 멤버에게만 전하는 초대장."
                onNext={() => goTo(3)}
              />
            )}
            {isPeer && (
              <button
                onClick={() => goTo(3)}
                className="px-6 py-3 rounded-full bg-ink text-page text-[13px] font-semibold hover:opacity-90 transition"
              >
                계속
              </button>
            )}
          </div>
        )}

        {index === 3 && (
          <div className="flex flex-col items-center w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-flower.svg" alt="" className="w-16 h-16" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-text.svg" alt="sillajuku" className="h-5 mt-2 dark:invert" />
            <p className="mt-4 mb-6 text-[15px] font-bold text-ink">함께 시작해요.</p>

            {error && (
              <p className="w-full mb-3 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[13px]">
                {error}
              </p>
            )}

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => signIn('spotify')}
                disabled={loading !== null}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-spotify text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition"
              >
                <SpotifyIcon />
                {loading === 'spotify' ? '연결하는 중…' : 'Spotify로 계속하기'}
              </button>

              <button
                onClick={() => setMore((m) => !m)}
                className="text-[13px] text-muted hover:text-ink transition"
              >
                더 보기
              </button>

              {more && (
                <>
                  <button
                    onClick={() => signIn('apple')}
                    disabled={loading !== null}
                    className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-black text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition dark:border dark:border-divider"
                  >
                    <AppleIcon />
                    {loading === 'apple' ? '연결하는 중…' : 'Apple로 계속하기'}
                  </button>
                  <button
                    onClick={() => signIn('google')}
                    disabled={loading !== null}
                    className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-white text-[#1a1a1a] text-[15px] font-semibold border-[1.5px] border-divider hover:bg-white/80 disabled:opacity-60 transition"
                  >
                    <GoogleIcon />
                    {loading === 'google' ? '연결하는 중…' : 'Google로 계속하기'}
                  </button>
                </>
              )}
            </div>

            <p className="mt-8 text-center text-[11px] text-muted px-6">
              계속 진행하면 다음에 동의하게 됩니다
              <br />
              <a href="/terms" className="font-bold hover:text-ink">
                이용약관
              </a>{' '}
              및{' '}
              <a href="/privacy" className="font-bold hover:text-ink">
                개인정보처리방침
              </a>
            </p>
          </div>
        )}

        {index > 0 && index < PAGE_COUNT - 1 && (
          <button
            onClick={() => goTo(index - 1)}
            className="mt-6 text-[12px] text-muted hover:text-ink transition"
          >
            이전
          </button>
        )}
      </div>
    </div>
  );
}

/** The cap-reached / expired / revoked / already-used blocking screen — seen
 *  before OAuth, not just as a post-auth failure. Cap-reached gets its own
 *  distinct copy (the deliverable this session asked for); everything else
 *  collapses into one plain "this link isn't valid" state. */
function InvalidTokenScreen({ reason }: { reason?: InviteTokenPreview['reason'] }) {
  const capReached = reason === 'cap_reached';
  return (
    <div className="relative min-h-screen overflow-hidden bg-page flex flex-col items-center justify-center px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -top-40 -right-40 w-[560px] opacity-[0.09]"
      />
      <div className="relative w-full max-w-sm flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-flower.svg" alt="" className={`w-14 h-14 mb-5 ${capReached ? '' : 'opacity-40'}`} />
        {capReached ? (
          <>
            <h1 className="text-[20px] font-extrabold tracking-tight text-ink mb-2">
              창립 멤버 999명이 모두 채워졌어요.
            </h1>
            <p className="text-[14px] leading-relaxed text-ink/70 max-w-[280px] mb-8">
              이 초대장은 유효했지만, 자리가 그사이 다 찼습니다. 다음 시즌이 열리면 가장 먼저 알려드릴게요.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[20px] font-extrabold tracking-tight text-ink mb-2">
              유효하지 않은 초대예요.
            </h1>
            <p className="text-[14px] leading-relaxed text-ink/70 max-w-[280px] mb-8">
              {reason === 'already_redeemed'
                ? '이미 사용된 링크예요.'
                : reason === 'revoked'
                  ? '초대한 분이 이 링크를 취소했어요.'
                  : reason === 'expired'
                    ? '유효 기간이 지난 링크예요.'
                    : '더 이상 유효하지 않은 링크예요.'}
            </p>
          </>
        )}
        <a
          href="https://sillajuku.com"
          className="px-6 py-3 rounded-full border border-divider text-ink text-[13px] font-semibold hover:bg-ink/5 transition"
        >
          sillajuku 둘러보기
        </a>
      </div>
    </div>
  );
}

function PageShell({
  eyebrow,
  headline,
  tag,
  body,
  onNext,
}: {
  eyebrow?: string;
  headline: string;
  tag?: string;
  body: React.ReactNode;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-flower.svg" alt="" className="w-14 h-14 mb-5" />
      {eyebrow && (
        <div className="text-[11px] font-bold tracking-[0.08em] text-muted mb-3">{eyebrow}</div>
      )}
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink mb-2 max-w-[260px]">
        {headline}
      </h1>
      {tag && <p className="text-[12px] italic text-muted mb-4">{tag}</p>}
      <p className="text-[14px] leading-relaxed text-ink/70 max-w-[240px] mb-8">{body}</p>
      <button
        onClick={onNext}
        className="px-6 py-3 rounded-full bg-ink text-page text-[13px] font-semibold hover:opacity-90 transition"
      >
        계속
      </button>
    </div>
  );
}

// Identical to the icons in app/(auth)/login/page.tsx — duplicated rather
// than imported, matching this file's existing choice to keep the invite
// flow self-contained.
function SpotifyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.5 17.34a.75.75 0 0 1-1.03.25c-2.82-1.73-6.37-2.12-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.05 8.5-.6 11.66 1.34.35.21.46.67.25 1.03zm1.47-3.26a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 0 1-.55-1.8c4.37-1.32 9.8-.68 13.5 1.6.44.27.58.85.31 1.29zm.13-3.4C15.24 8.4 8.84 8.2 5.14 9.32a1.13 1.13 0 1 1-.65-2.16c4.25-1.29 11.3-1.04 15.75 1.6a1.13 1.13 0 0 1-1.14 1.94z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

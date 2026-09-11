'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import InviteSwipeFlow from '../../../components/InviteSwipeFlow';

// Same fallback as the invite-link landing page (app/i/[code]/page.tsx) —
// the app hasn't been submitted to the App Store yet.
const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://sillajuku.com';

// If the app is installed, iOS intercepts this URL as a Universal Link
// before Safari (or this component) ever loads — so seeing this page on a
// mobile device means the app genuinely isn't installed yet, and the right
// move is the App Store, not a web sign-up (mirrors the parent feature's
// original spec: "detect mobile, redirect to the App Store"). Desktop can't
// install the iOS app at all, so it gets the real web onboarding instead.
function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export default function BetaRedeemLandingPage() {
  const params = useParams<{ token: string }>();
  const token = (params.token || '').toUpperCase();
  const [mobile, setMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setMobile(isMobileDevice());
  }, []);

  if (mobile === null) {
    return <div className="min-h-screen bg-page" />;
  }

  if (mobile) {
    return <MobileAppStoreBounce token={token} />;
  }

  return <InviteSwipeFlow token={token} />;
}

function MobileAppStoreBounce({ token }: { token: string }) {
  const [status, setStatus] = useState<'copying' | 'redirecting' | 'error'>('copying');

  useEffect(() => {
    if (!token) return;

    // Clipboard handoff: the iOS app's BetaTokenClipboardHandoff checks the
    // clipboard on first launch via UIPasteboard's detectValues(for:
    // [.probableWebURL]), which doesn't trigger the system "pasted from"
    // banner and auto-applies the token — this is what lets it survive the
    // App Store install gap. Writes a plain URL (not a bare token string)
    // since that pattern-detection API only recognizes a fixed set of
    // built-in patterns, no custom ones.
    const payload = `https://sillajuku.com/beta/${token}`;

    navigator.clipboard
      .writeText(payload)
      .catch(() => {
        // Not fatal — tapping the same link again after install re-triggers
        // this page, and the Universal Link path takes over from there.
      })
      .finally(() => {
        setStatus('redirecting');
        const timer = setTimeout(() => {
          window.location.href = APP_STORE_URL;
        }, 900);
        return () => clearTimeout(timer);
      });
  }, [token]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '24px',
        textAlign: 'center',
        background: '#F8F8F5',
        color: '#1A1A18',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-flower.png" alt="" width={64} height={64} style={{ opacity: 0.9 }} />
      <p style={{ fontSize: '15px', color: '#8C8C8A', maxWidth: '320px' }}>
        {status === 'error'
          ? '앱으로 이동 중이에요. 자동으로 넘어가지 않으면, 설치 후 앱을 열어 초대를 마저 받아주세요.'
          : 'sillajuku에 초대되셨어요. 앱으로 이동할게요…'}
      </p>
      <a
        href={APP_STORE_URL}
        style={{
          fontSize: '13px',
          color: '#2979B7',
          textDecoration: 'underline',
        }}
      >
        직접 이동하기
      </a>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// App Store URL isn't set yet — the app hasn't been submitted (see README).
// Falls back to the marketing homepage until NEXT_PUBLIC_APP_STORE_URL is set,
// so this route degrades to "here's the code, here's the site" rather than a
// broken redirect.
const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://sillajuku.com';

export default function InviteLandingPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code || '').toUpperCase();
  const [status, setStatus] = useState<'copying' | 'redirecting' | 'error'>('copying');

  useEffect(() => {
    if (!code) return;

    // Clipboard handoff: the iOS app checks the clipboard on first launch via
    // UIPasteboard's detectValues(for: [.probableWebURL]), which doesn't
    // trigger the system "pasted from X" banner and auto-applies the code —
    // this is what lets the invite survive the App Store install gap for
    // someone who doesn't have the app yet. Writes a plain URL (not a custom-
    // prefixed string) because UIPasteboard's pattern detection only
    // recognizes a fixed set of built-in patterns (probableWebURL, number,
    // etc.) — there's no custom-pattern support, so this has to look like a
    // real URL for the app to be able to detect it without reading the
    // clipboard's raw string (which would trigger that banner).
    const payload = `https://sillajuku.com/i/${code}`;

    navigator.clipboard
      .writeText(payload)
      .catch(() => {
        // Clipboard write can fail (permissions, non-secure context, etc.) —
        // the manual "Enter invite code" field in the app is the fallback,
        // so a failure here isn't fatal, just less seamless.
      })
      .finally(() => {
        setStatus('redirecting');
        const timer = setTimeout(() => {
          window.location.href = APP_STORE_URL;
        }, 900);
        return () => clearTimeout(timer);
      });
  }, [code]);

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
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        background: '#F8F8F5',
        color: '#1A1A18',
      }}
    >
      <img src="/logo-flower.png" alt="" width={64} height={64} style={{ opacity: 0.9 }} />
      <p style={{ fontSize: '15px', color: '#8C8C8A', maxWidth: '320px' }}>
        {status === 'error'
          ? "Taking you to sillajuku — if nothing happens, open the app and enter your invite code manually."
          : 'Taking you to sillajuku…'}
      </p>
      <a
        href={APP_STORE_URL}
        style={{
          fontSize: '13px',
          color: '#2979B7',
          textDecoration: 'underline',
        }}
      >
        Continue manually
      </a>
      <p style={{ fontSize: '11px', color: '#8C8C8A', marginTop: '24px' }}>
        Invite code: <strong>{code}</strong>
      </p>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';

/**
 * Landing page for a confirmed email (Supabase's "Confirm signup" link),
 * reached at https://sillajuku.com/auth/confirmed — listed in the Universal
 * Links allowlist (app/.well-known/apple-app-site-association/route.ts), so
 * on a device with the app installed, iOS intercepts this URL and opens the
 * app directly; this page itself only ever actually renders when that
 * didn't happen (desktop, or the app isn't installed on this device).
 *
 * WHY this exists: sillajuku is OAuth-only (no email/password), but a
 * provider that doesn't assert a verified email (Spotify, unlike Google)
 * can still trigger Supabase's own email-confirmation requirement on a
 * brand-new signup. Before this page, that confirmation link dropped the
 * user into the full web onboarding flow — the wrong place for someone
 * who's mid-signup in the iOS app and has no reason to want a web account.
 *
 * REQUIRES a one-time Supabase Dashboard change this codebase can't make
 * itself: Authentication → URL Configuration → Site URL needs to be
 * https://sillajuku.com/auth/confirmed (this app is OAuth-only, so Site
 * URL's only real consumer is this confirmation-email redirect — safe to
 * repoint). See SESSIONS.md (2026-09-20) for the full reasoning.
 */
export default function AuthConfirmedPage() {
  // Best-effort only -- this page's actual job (getting mobile users back
  // into the app) is already done by the OS-level Universal Link before
  // this component ever mounts, on any device where it works. This is just
  // to word the fallback message right for whoever's left: not "why does
  // this look like a website" (desktop) vs "did I do something wrong"
  // (mobile without the app installed) should read differently.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-flower.svg" alt="" className="w-14 h-14 mb-5 opacity-70" />
      <h1 className="text-[20px] font-extrabold tracking-tight text-ink mb-2">이메일이 확인됐어요.</h1>
      {isMobile === false ? (
        <p className="text-[14px] leading-relaxed text-ink/70 max-w-[300px]">
          sillajuku 앱에서 계속 진행해주세요. 휴대폰에서 앱을 열고 가입을 다시 시도하면 돼요.
        </p>
      ) : (
        <p className="text-[14px] leading-relaxed text-ink/70 max-w-[300px]">
          sillajuku 앱이 설치되어 있다면 자동으로 열렸을 거예요. 앱으로 돌아가서 가입을 다시 시도해주세요.
        </p>
      )}
    </div>
  );
}

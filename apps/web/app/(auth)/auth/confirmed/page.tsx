'use client';

import { useEffect } from 'react';

/**
 * Landing page for a confirmed email (Supabase's "Confirm signup" link),
 * reached at https://sillajuku.com/auth/confirmed.
 *
 * WHY this exists: sillajuku is OAuth-only (no email/password), but a
 * provider that doesn't assert a verified email (Spotify, unlike Google)
 * can still trigger Supabase's own email-confirmation requirement on a
 * brand-new signup. Before this page, that confirmation link dropped the
 * user into the full web onboarding flow — the wrong place for someone
 * who's mid-signup in the iOS app and has no reason to want a web account.
 *
 * WHY a custom URL scheme, not just the Universal Links allowlist entry
 * (app/.well-known/apple-app-site-association/route.ts, /auth/confirmed is
 * still listed there): confirmed live 2026-09-20 that the Universal Link
 * alone doesn't reliably open the app. Root cause — Supabase's confirmation
 * link doesn't point straight at this page; it points at
 * <project>.supabase.co/auth/v1/verify, which verifies the token server-side
 * and then 30x-redirects here. Universal Links only ever intercept a DIRECT
 * user tap on a matching https:// link; a page merely *reached* via a
 * redirect chain never gets that treatment, no matter how it's configured.
 * A custom scheme (sillajuku://, already registered for OAuth callbacks —
 * see Config.oauthRedirectURL) has no such restriction, so this page
 * triggers it itself on mount. sillajukuApp.swift's `.onOpenURL` handles
 * `sillajuku://auth/confirmed` by posting `.sjEmailConfirmed`, same as the
 * Universal Link path did — AuthView shows a "you're verified, continue
 * below" banner either way.
 *
 * REQUIRES a one-time Supabase Dashboard change this codebase can't make
 * itself: Authentication → URL Configuration → Site URL needs to be
 * https://sillajuku.com/auth/confirmed (this app is OAuth-only, so Site
 * URL's only real consumer is this confirmation-email redirect — safe to
 * repoint). See SESSIONS.md (2026-09-20) for the full reasoning.
 */
const APP_SCHEME_URL = 'sillajuku://auth/confirmed';

export default function AuthConfirmedPage() {
  useEffect(() => {
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      window.location.href = APP_SCHEME_URL;
    }
  }, []);

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-flower.svg" alt="" className="w-14 h-14 mb-5 opacity-70" />
      <h1 className="text-[20px] font-extrabold tracking-tight text-ink mb-2">이메일이 확인되었습니다.</h1>
      <p className="text-[14px] leading-relaxed text-ink/70 max-w-[300px] mb-6">
        앱으로 돌아가서 가입을 완료해주세요.
      </p>
      {/* Manual fallback -- some mobile browsers only honor a custom-scheme
          navigation triggered by a direct tap, not the useEffect above. */}
      <a
        href={APP_SCHEME_URL}
        className="text-[13px] font-semibold text-ink/60 underline underline-offset-2"
      >
        앱이 자동으로 열리지 않았다면 여기를 눌러주세요
      </a>
    </div>
  );
}

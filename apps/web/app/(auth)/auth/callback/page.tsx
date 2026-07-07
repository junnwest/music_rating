'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { Suspense } from 'react';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!supabase) {
      router.replace('/');
      return;
    }

    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorCode = searchParams.get('error_code');
    const errorDescription = searchParams.get('error_description');
    const next = searchParams.get('next') ?? '/';

    if (error) {
      const message =
        errorCode === 'identity_already_exists'
          ? 'That account is already linked to a different user.'
          : errorDescription ?? 'Something went wrong.';
      router.replace(`/login?error=${encodeURIComponent(message)}`);
      return;
    }

    async function finish() {
      if (code) await supabase!.auth.exchangeCodeForSession(code);
      // First sign-in → no profile row yet → onboarding (mirrors iOS AppState)
      const { data: sessionData } = await supabase!.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (!uid) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase!
        .from('profiles')
        .select('username')
        .eq('id', uid)
        .maybeSingle();
      router.replace(profile?.username ? next : '/onboarding');
    }
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <p className="text-sm text-muted">Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}

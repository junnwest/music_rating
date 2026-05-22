'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { Suspense } from 'react';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!supabase) { router.replace('/'); return; }

    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorCode = searchParams.get('error_code');
    const errorDescription = searchParams.get('error_description');
    const next = searchParams.get('next') ?? '/profile';

    if (error) {
      const message = errorCode === 'identity_already_exists'
        ? 'That account is already linked to a different user.'
        : errorDescription ?? 'Something went wrong.';
      router.replace(`${next}?error=${encodeURIComponent(message)}`);
      return;
    }

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(() => {
        router.replace(next);
      });
    } else {
      router.replace(next);
    }
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-60px)] items-center justify-center">
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

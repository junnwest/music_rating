'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { Suspense } from 'react';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!supabase) { router.replace('/'); return; }

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(() => {
        router.replace('/profile');
      });
    } else {
      router.replace('/profile');
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

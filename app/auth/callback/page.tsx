'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500">Signing you in…</p>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get('code');
    if (!code || !supabase) {
      router.replace('/login');
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        console.error('[auth/callback]', error.message);
        router.replace('/login');
      } else {
        router.replace('/profile');
      }
    });
  }, [params, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-muted text-[14px]">Signing you in…</p>
    </div>
  );
}

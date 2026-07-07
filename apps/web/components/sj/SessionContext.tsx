'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import type { ProfileRow } from '../../lib/db/types';

interface SessionValue {
  /** undefined = still resolving; null = signed out */
  userId: string | null | undefined;
  profile: ProfileRow | null;
  /** true once both session and (if signed in) profile have been resolved */
  ready: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  userId: undefined,
  profile: null,
  ready: false,
  refreshProfile: async () => {},
  signOut: async () => {},
});

const PROFILE_COLS =
  'id, username, display_name, bio, avatar_url, rating_mode, manual_rating_step, ' +
  'notifications_last_seen_at, notify_likes, notify_replies, notify_followers, ' +
  'notify_rankings, notify_capsule, profile_visibility, catalog_visibility, ' +
  'listen_later_visibility, is_bot';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return null;
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', uid)
      .maybeSingle();
    return (data as ProfileRow | null) ?? null;
  }, []);

  useEffect(() => {
    if (!supabase) {
      setUserId(null);
      setReady(true);
      return;
    }
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) setProfile(await loadProfile(uid));
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setProfile(uid ? await loadProfile(uid) : null);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Signed-in but never finished onboarding (no profile row / no username) →
  // route to /onboarding, mirroring iOS AppState.onboarding.
  useEffect(() => {
    if (!ready || !userId) return;
    if (!profile?.username && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [ready, userId, profile, pathname, router]);

  const refreshProfile = useCallback(async () => {
    if (userId) setProfile(await loadProfile(userId));
  }, [userId, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    router.push('/login');
  }, [router]);

  return (
    <SessionContext.Provider value={{ userId, profile, ready, refreshProfile, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

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
  'library_visibility, stats_visibility, is_bot';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const [profileError, setProfileError] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', uid)
      .maybeSingle();
    // A failed fetch (bad column, RLS, timeout) must not be conflated with
    // "no profile row" — that would bounce an onboarded user to /onboarding.
    setProfileError(!!error);
    if (error) console.error('[SessionContext] profile fetch failed:', error.message);
    return (data as ProfileRow | null) ?? null;
  }, []);

  // Resolve the session only. The onAuthStateChange callback fires while
  // auth-js holds the session lock (navigator.locks), so it must NOT await any
  // Supabase call — a query inside would re-acquire the same lock and deadlock,
  // leaving the promise (and `ready`, and the whole app) hung on the loading
  // skeleton. We only setState here; the profile fetch happens in the effect
  // below, outside the lock. INITIAL_SESSION delivers the current session on
  // subscribe, so no separate getSession() call is needed.
  useEffect(() => {
    if (!supabase) {
      setUserId(null);
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Fetch the profile whenever the signed-in user changes. `ready` flips true
  // here — once the session is known and (if signed in) the profile fetch has
  // settled — so the onboarding redirect below never runs against a
  // not-yet-loaded profile. Running the query in a normal effect keeps it off
  // the auth-state-change lock.
  useEffect(() => {
    if (userId === undefined) return; // session still resolving
    if (userId === null) {
      setProfile(null);
      setProfileError(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    loadProfile(userId).then((p) => {
      if (cancelled) return;
      setProfile(p);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, loadProfile]);

  // Signed-in but never finished onboarding (no profile row / no username) →
  // route to /onboarding, mirroring iOS AppState.onboarding.
  useEffect(() => {
    if (!ready || !userId || profileError) return;
    if (!profile?.username && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [ready, userId, profile, profileError, pathname, router]);

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

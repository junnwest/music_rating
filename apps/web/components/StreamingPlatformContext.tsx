'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';

export type StreamingPlatform = 'spotify' | 'youtube_music' | 'tidal' | 'apple_music';

interface StreamingPlatformContextType {
  /** The user's chosen platform, or null for "show all". `undefined` while loading. */
  preferred: StreamingPlatform | null | undefined;
  /** True until the first fetch resolves. */
  loading: boolean;
  /** Optimistically set + persist the preference. Returns the save error, if any. */
  savePreferred: (platform: StreamingPlatform | null) => Promise<{ error: string | null }>;
}

const StreamingPlatformContext = createContext<StreamingPlatformContextType | null>(null);

const VALID: StreamingPlatform[] = ['spotify', 'youtube_music', 'tidal', 'apple_music'];
function normalize(v: unknown): StreamingPlatform | null {
  return VALID.includes(v as StreamingPlatform) ? (v as StreamingPlatform) : null;
}

/**
 * Fetches the signed-in user's preferred streaming platform exactly once and
 * shares it with every StreamingButtons / TrackStreamingButtons on the page —
 * replacing the old per-button DB query (N+1). Settings writes flow back through
 * `savePreferred`, so a change is reflected everywhere instantly.
 */
export function StreamingPlatformProvider({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = useState<StreamingPlatform | null | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setPreferred(null); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    if (!uid) { setPreferred(null); return; }
    const { data } = await supabase
      .from('profiles')
      .select('preferred_streaming_platform')
      .eq('id', uid)
      .maybeSingle();
    setPreferred(normalize(data?.preferred_streaming_platform));
  }, []);

  useEffect(() => {
    void load();
    if (!supabase) return;
    // Re-load on sign-in / sign-out so buttons reflect the right account.
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void load(); });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const savePreferred = useCallback(
    async (platform: StreamingPlatform | null): Promise<{ error: string | null }> => {
      if (!supabase || !userId) return { error: 'Not signed in' };
      const prev = preferred;
      setPreferred(platform); // optimistic
      const { error } = await supabase
        .from('profiles')
        .update({ preferred_streaming_platform: platform })
        .eq('id', userId);
      if (error) {
        setPreferred(prev); // roll back
        return { error: error.message };
      }
      return { error: null };
    },
    [userId, preferred],
  );

  return (
    <StreamingPlatformContext.Provider value={{ preferred, loading: preferred === undefined, savePreferred }}>
      {children}
    </StreamingPlatformContext.Provider>
  );
}

export function useStreamingPlatform() {
  const ctx = useContext(StreamingPlatformContext);
  if (!ctx) throw new Error('useStreamingPlatform must be inside StreamingPlatformProvider');
  return ctx;
}

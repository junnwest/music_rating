'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../../lib/supabaseClient';

/** Observe actual exposure, not prefetch/render. Tall reviews only need a
 * viewport-sized portion visible; background tabs never produce impressions. */
export default function FeedImpression({ children, postKey, sessionId, enabled }: {
  children: ReactNode; postKey: string; sessionId?: string; enabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !sessionId || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = false;
    let visible = false;
    const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      cancel();
      if (!visible || sent || document.visibilityState !== 'visible') return;
      timer = setTimeout(async () => {
        if (sent || document.visibilityState !== 'visible') return;
        sent = true;
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        if (!session) return;
        void fetch('/api/feed/impressions', { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ sessionId, keys: [postKey] }),
        }).catch(() => {});
      }, 1000);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height / 2, window.innerHeight / 2);
      schedule();
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', schedule);
    return () => { cancel(); observer.disconnect(); document.removeEventListener('visibilitychange', schedule); };
  }, [enabled, sessionId, postKey]);
  return <div ref={ref} data-feed-key={postKey}>{children}</div>;
}

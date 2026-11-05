'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchNearby, mapApiEnabled } from '../../../lib/tasteMap/client';
import { coverThumb } from '../../../lib/tasteMap/lens2d';
import type { NearbyAlbum } from '../../../lib/tasteMap/nearby';
import type { NodeKey } from '../../../lib/tasteMap/types';
import { useLanguage } from '../../../lib/i18n';

const COPY = {
  en: { title: 'Albums you might find here', loading: 'Looking nearby…', empty: 'Nothing new to suggest around here.' },
  ko: { title: '이 근처에서 찾을 만한 앨범', loading: '근처를 찾는 중…', empty: '이 근처엔 추천할 새 앨범이 없어요.' },
};

/**
 * The "What's here?" card's suggestions: unrated catalog albums near the map
 * nodes around the clicked point (GET /api/taste/map/nearby). Renders nothing
 * without API access (`?mock=1` / `?fixture=`) or when the call fails.
 */
export default function HereSuggestions({ query }: { query: { keys: NodeKey[]; w: number[] } | null }) {
  const { lang } = useLanguage();
  const t = COPY[lang === 'ko' ? 'ko' : 'en'];
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; albums: NearbyAlbum[] } | { kind: 'off' }>({ kind: 'loading' });
  const sig = query ? `${query.keys.join(',')}|${query.w.join(',')}` : '';

  useEffect(() => {
    if (!query || !query.keys.length || !mapApiEnabled()) {
      setState({ kind: 'off' });
      return;
    }
    const ctl = new AbortController();
    setState({ kind: 'loading' });
    fetchNearby(query, ctl.signal)
      .then((r) => setState({ kind: 'ok', albums: r.albums ?? [] }))
      .catch(() => {
        if (!ctl.signal.aborted) setState({ kind: 'off' });
      });
    return () => ctl.abort();
    // `sig` is the query's identity; the object itself is rebuilt every click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (state.kind === 'off') return null;
  return (
    <>
      <p className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{t.title}</p>
      {state.kind === 'loading' ? (
        <p className="mt-1 text-[11px] text-muted">{t.loading}</p>
      ) : state.albums.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted">{t.empty}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {state.albums.map((a) => (
            <li key={a.id}>
              <Link href={`/album/${a.id}`} className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 transition hover:bg-divider/50" title={a.why}>
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverThumb(a.coverUrl)} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded bg-divider" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-semibold leading-tight">{a.title}</span>
                  <span className="block truncate text-[10.5px] leading-tight text-muted">
                    {a.artist}
                    {a.year ? ` · ${a.year}` : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

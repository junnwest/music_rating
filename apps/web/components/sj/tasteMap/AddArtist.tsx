'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, Search, X } from 'lucide-react';
import Cover from '../Cover';
import { FlowerSpinner } from '../Loading';
import type { PlaceResponse } from '../../../lib/tasteMap/apiTypes';
import { TasteMapApiError, placeArtist } from '../../../lib/tasteMap/client';
import type { NodeKey, TasteMapPayloadNode } from '../../../lib/tasteMap/types';
import { PanelHeader, SectionLabel, SignInNote, pillPlain, pillSm, useCopy } from './ui';

/**
 * "Add artist" (TASTE_MAP_PLAN.md Phase 4): search the catalog with the app's
 * typeahead (/api/search/suggest, artists carry their artists.id), then GET
 * /place to see where that artist would land on this map. The result is a
 * GHOST: drawn translucent with lines to its anchors, never stored. An artist
 * joins the map for real once the user rates one of its albums.
 *
 * 409 with `key`: already on the map, so the shell selects that node instead.
 */

/** /api/search/suggest's artist shape (app/api/search/suggest/route.ts SuggestArtist). */
interface SuggestArtist {
  id: string;
  name: string;
  nameNative: string | null;
  coverUrl: string | null;
}

const COPY = {
  en: {
    label: 'Add artist',
    title: 'Where would they land?',
    ph: 'Search an artist',
    none: 'No artists found.',
    preview: 'Preview',
    previewOnly: 'Preview only, nothing is saved.',
    rate: 'Rate an album by {name} to add it to your map.',
    anchors: 'Placed near',
    dismiss: 'Dismiss',
    onMap: '{name} is already on your map.',
    noLayout: 'Your map hasn’t been saved yet. Open it once while signed in, then try again.',
    noData: 'There isn’t enough catalog data about {name} to place them yet.',
    failed: 'Couldn’t place this artist',
    signIn: 'Sign in to use',
    close: 'Close',
  },
  ko: {
    label: '아티스트 추가',
    title: '어디에 놓일까요?',
    ph: '아티스트 검색',
    none: '아티스트를 찾지 못했어요.',
    preview: '미리보기',
    previewOnly: '미리보기일 뿐, 저장되지 않아요.',
    rate: '{name}의 앨범을 평가하면 지도에 추가돼요.',
    anchors: '가까운 노드',
    dismiss: '닫기',
    onMap: '{name}은(는) 이미 지도에 있어요.',
    noLayout: '아직 지도가 저장되지 않았어요. 로그인한 상태로 한 번 연 뒤 다시 해 주세요.',
    noData: '{name}에 대한 카탈로그 정보가 부족해서 아직 놓을 수 없어요.',
    failed: '이 아티스트를 놓지 못했어요',
    signIn: '로그인하면 쓸 수 있어요',
    close: '닫기',
  },
};

export default function AddArtist({
  enabled,
  byKey,
  ghost,
  onGhost,
  onOnMap,
  onPickNode,
  onClose,
}: {
  enabled: boolean;
  byKey: Map<NodeKey, TasteMapPayloadNode>;
  ghost: PlaceResponse | null;
  onGhost: (p: PlaceResponse | null) => void;
  /** 409: the artist is already on the map as `key`. */
  onOnMap: (key: NodeKey, message: string) => void;
  onPickNode: (key: NodeKey) => void;
  onClose: () => void;
}) {
  const c = useCopy(COPY);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SuggestArtist[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (v: string) => {
    setQuery(v);
    clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(() => {
      const my = ++seq.current;
      fetch(`/api/search/suggest?query=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { artists: [] }))
        .then((body: { artists?: SuggestArtist[] }) => my === seq.current && setResults(body.artists ?? []))
        .catch(() => my === seq.current && setResults([]));
    }, 200);
  };

  const place = async (a: SuggestArtist) => {
    setBusy(a.id);
    setError(null);
    onGhost(null);
    try {
      const res = await placeArtist(a.id);
      onGhost(res);
    } catch (e) {
      const err = e as TasteMapApiError;
      const body = (err.body ?? null) as { key?: unknown } | null;
      if (err.status === 409 && body && typeof body.key === 'string') onOnMap(body.key, c.onMap.replace('{name}', a.name));
      else if (err.status === 409) setError(c.noLayout);
      else if (err.status === 422) setError(c.noData.replace('{name}', a.name));
      else setError(`${c.failed}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PanelHeader label={c.label} title={c.title} onClose={onClose} closeLabel={c.close} />
      {!enabled && <SignInNote text={c.signIn} />}
      <label className="mt-2.5 flex items-center gap-2 rounded-full border border-divider bg-page px-3 py-1.5 focus-within:border-ink/40">
        <Search size={13} className="shrink-0 text-muted" />
        <input
          value={query}
          disabled={!enabled}
          placeholder={c.ph}
          aria-label={c.ph}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-muted/70 disabled:cursor-not-allowed"
        />
        {query && (
          <button type="button" aria-label={c.close} onClick={() => onChange('')} className="shrink-0 text-muted hover:text-ink">
            <X size={13} />
          </button>
        )}
      </label>

      {results && !ghost && (
        <ul className="mt-1.5">
          {results.length === 0 && <li className="px-1 py-1.5 text-[11.5px] text-muted">{c.none}</li>}
          {results.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => place(a)}
                disabled={!!busy}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-ink/[0.04]"
              >
                <Cover url={a.coverUrl} alt={a.name} className="h-8 w-8 shrink-0" rounded="rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{a.name}</span>
                  {a.nameNative && a.nameNative !== a.name && <span className="block truncate text-[11px] text-muted">{a.nameNative}</span>}
                </span>
                {busy === a.id && <FlowerSpinner />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 break-words text-[11.5px] font-semibold text-ink">{error}</p>}

      {ghost && (
        <div className="mt-3 rounded-xl border border-dashed border-muted/60 bg-surface px-3 py-2.5" data-testid="ghost-card">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted px-2 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
              <Eye size={10} />
              {c.preview}
            </span>
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink">{ghost.label}</h3>
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-ink" data-testid="ghost-explanation">
            {ghost.explanation}
          </p>
          {ghost.anchors.length > 0 && (
            <>
              <SectionLabel className="mt-3">{c.anchors}</SectionLabel>
              <ul className="mt-1 space-y-1.5">
                {ghost.anchors.slice(0, 5).map((nb) => {
                  const n = byKey.get(nb.key);
                  return (
                    <li key={nb.key}>
                      <button
                        type="button"
                        onClick={() => n && onPickNode(nb.key)}
                        className="flex w-full items-baseline justify-between gap-2 text-left hover:underline"
                      >
                        <span className="min-w-0 truncate text-[12px] font-semibold text-ink">
                          {n?.label ?? nb.key}
                          {n?.eraLabel && <span className="ml-1 font-normal text-muted">{n.eraLabel}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted">{Math.round(nb.sim * 100)}%</span>
                      </button>
                      <p className="text-[11px] leading-snug text-muted">
                        {nb.why.slice(0, 3).map((w, i) => (
                          <span key={w.label}>
                            {i > 0 && ' · '}
                            <span className="text-mid">{w.label}</span> {Math.round(w.share * 100)}%
                          </span>
                        ))}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="mt-3 text-[11.5px] font-semibold text-ink">{c.rate.replace('{name}', ghost.label)}</p>
          <p className="text-[11px] text-muted">{c.previewOnly}</p>
          <button type="button" onClick={() => onGhost(null)} className={`${pillPlain} ${pillSm} mt-2`}>
            <X size={12} />
            {c.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}

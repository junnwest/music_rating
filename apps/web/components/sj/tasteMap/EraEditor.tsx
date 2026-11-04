'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Merge, RotateCcw, Scissors } from 'lucide-react';
import Cover from '../Cover';
import { FlowerSpinner } from '../Loading';
import type { EraGetResponse } from '../../../lib/tasteMap/apiTypes';
import { getEras, putEras } from '../../../lib/tasteMap/client';
import { PanelHeader, SignInNote, pillPlain, pillSm, pillSolid, useCopy } from './ui';

/**
 * Era split / merge for one artist (TASTE_MAP_PLAN.md D1, Phase 4). Lists the
 * whole discography in order (GET /eras/[artistId]); between two albums that
 * count for the map the user toggles "new era starts here". Save PUTs the
 * split-before ids, "Merge into one" PUTs [], "Back to automatic" PUTs null.
 * Any save changes the artist's node keys, so the shell reloads the map.
 *
 * Albums that don't count for the map (compilations, live, soundtracks the
 * user hasn't rated) are greyed and can't start an era; the route rejects
 * those, and a split before the first counted album.
 */

const COPY = {
  en: {
    label: 'Eras',
    hint: 'Tap the line between two albums to start a new era there. Each era is its own node on your map.',
    nowAuto: 'Now: automatic',
    nowManual: 'Now: your split',
    nowMerged: 'Now: merged into one',
    eras: 'eras',
    era: 'era',
    splitHere: 'Split here',
    newEra: 'Era {n} starts here',
    auto: 'auto',
    rated: 'rated',
    notCounted: 'not on the map',
    save: 'Save eras',
    saving: 'Saving…',
    merge: 'Merge into one',
    automatic: 'Back to automatic',
    warn: 'Saving rebuilds this artist’s nodes. Pins and group memberships on its current era nodes won’t carry over.',
    signIn: 'Sign in to use',
    failed: 'Couldn’t load eras',
    saveFailed: 'Not saved',
    close: 'Close',
    unchanged: 'No changes',
    noYear: 'n.d.',
  },
  ko: {
    label: '시기',
    hint: '두 앨범 사이의 선을 탭하면 거기서 새 시기가 시작돼요. 시기마다 지도에 따로 노드가 생겨요.',
    nowAuto: '현재: 자동',
    nowManual: '현재: 직접 나눔',
    nowMerged: '현재: 하나로 합침',
    eras: '개 시기',
    era: '개 시기',
    splitHere: '여기서 나누기',
    newEra: '시기 {n} 시작',
    auto: '자동',
    rated: '평가함',
    notCounted: '지도에 없음',
    save: '시기 저장',
    saving: '저장 중…',
    merge: '하나로 합치기',
    automatic: '자동으로 되돌리기',
    warn: '저장하면 이 아티스트의 노드가 다시 만들어져요. 지금 시기 노드에 있는 고정과 그룹 비중은 옮겨지지 않아요.',
    signIn: '로그인하면 쓸 수 있어요',
    failed: '시기를 불러오지 못했어요',
    saveFailed: '저장 안 됨',
    close: '닫기',
    unchanged: '바뀐 게 없어요',
    noYear: '연도 없음',
  },
};

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: EraGetResponse };

export default function EraEditor({
  artistId,
  artistName,
  enabled,
  onClose,
  onSaved,
}: {
  artistId: string;
  artistName: string;
  /** Server calls allowed (signed in, or the dev `?api=1` fixture mode). */
  enabled: boolean;
  onClose: () => void;
  /** After a successful PUT: node keys changed, reload the map. */
  onSaved: () => Promise<void> | void;
}) {
  const c = useCopy(COPY);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [splits, setSplits] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    getEras(artistId)
      .then((data) => {
        if (cancelled) return;
        setLoad({ kind: 'ready', data });
        setSplits(new Set(data.override ?? data.auto));
      })
      .catch((e: Error) => !cancelled && setLoad({ kind: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [artistId, enabled]);

  const data = load.kind === 'ready' ? load.data : null;
  // Counted albums in order; a split may go before any of them but the first.
  const counted = useMemo(() => (data ? data.albums.filter((a) => a.counts) : []), [data]);
  const firstCounted = counted[0]?.id ?? null;
  const ordered = (s: Set<string>) => counted.filter((a) => s.has(a.id)).map((a) => a.id);
  const current = data ? (data.override ?? data.auto) : [];
  const dirty = data ? ordered(splits).join() !== ordered(new Set(current)).join() : false;
  const autoSet = useMemo(() => new Set(data?.auto ?? []), [data]);

  const put = async (body: string[] | null) => {
    setSaving(true);
    setError(null);
    try {
      await putEras(artistId, { splitAlbumIds: body });
      await onSaved();
    } catch (e) {
      setError(`${c.saveFailed}: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setSplits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let eraNo = 1;
  const status = data
    ? data.override === null
      ? c.nowAuto
      : data.override.length === 0
        ? c.nowMerged
        : c.nowManual
    : '';
  const nEras = current.length + 1;

  return (
    <div>
      <PanelHeader label={c.label} title={artistName} onClose={onClose} closeLabel={c.close} />
      {!enabled && <SignInNote text={c.signIn} />}
      {enabled && load.kind === 'loading' && (
        <div className="flex h-40 items-center justify-center">
          <FlowerSpinner />
        </div>
      )}
      {enabled && load.kind === 'error' && (
        <p className="mt-2 text-[12px] text-ink">
          {c.failed}: {load.message}
        </p>
      )}
      {data && (
        <>
          <p className="mt-1 text-[11.5px] font-semibold text-ink" data-testid="era-status">
            {status} · {nEras} {nEras === 1 ? c.era : c.eras}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">{c.hint}</p>

          <ol className="mt-2.5">
            {data.albums.map((a) => {
              const cuttable = a.counts && a.id !== firstCounted;
              const on = cuttable && splits.has(a.id);
              if (on) eraNo += 1;
              return (
                <Fragment key={a.id}>
                  {cuttable && (
                    <li>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${c.splitHere}: ${a.title}`}
                        onClick={() => toggle(a.id)}
                        disabled={saving}
                        className={`group my-0.5 flex w-full items-center gap-2 rounded-md px-1 py-1 text-[10.5px] font-bold transition ${
                          on ? 'text-ink' : 'text-muted/70 hover:text-ink'
                        }`}
                      >
                        <span className={`h-0 flex-1 border-t ${on ? 'border-solid border-ink' : 'border-dashed border-divider group-hover:border-muted'}`} />
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <Scissors size={11} />
                          {on ? c.newEra.replace('{n}', String(eraNo)) : c.splitHere}
                          {autoSet.has(a.id) && (
                            <span className="rounded bg-ink/[0.06] px-1 py-px text-[9.5px] font-semibold uppercase text-muted">{c.auto}</span>
                          )}
                        </span>
                        <span className={`h-0 flex-1 border-t ${on ? 'border-solid border-ink' : 'border-dashed border-divider group-hover:border-muted'}`} />
                      </button>
                    </li>
                  )}
                  <li
                    className={`flex items-center gap-2 rounded-lg px-1 py-1 ${a.counts ? '' : 'opacity-40'}`}
                    title={a.counts ? undefined : c.notCounted}
                  >
                    <Cover url={a.coverUrl} alt={a.title} className="h-8 w-8 shrink-0" rounded="rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink">{a.title}</span>
                      <span className="block text-[10.5px] text-muted">
                        {a.year ?? c.noYear}
                        {!a.counts && ` · ${c.notCounted}`}
                      </span>
                    </span>
                    {a.rated && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-ink" title={c.rated} aria-label={c.rated} />
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>

          <p className="mt-3 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-[11px] leading-snug text-muted">{c.warn}</p>
          {error && <p className="mt-2 break-words text-[11.5px] font-semibold text-ink">{error}</p>}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => put(ordered(splits))}
              className={`${pillSolid} ${pillSm}`}
              title={dirty ? undefined : c.unchanged}
            >
              <Scissors size={12} />
              {saving ? c.saving : c.save}
            </button>
            <button
              type="button"
              disabled={saving || data.override?.length === 0 || counted.length < 2}
              onClick={() => put([])}
              className={`${pillPlain} ${pillSm}`}
            >
              <Merge size={12} />
              {c.merge}
            </button>
            <button type="button" disabled={saving || data.override === null} onClick={() => put(null)} className={`${pillPlain} ${pillSm}`}>
              <RotateCcw size={12} />
              {c.automatic}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

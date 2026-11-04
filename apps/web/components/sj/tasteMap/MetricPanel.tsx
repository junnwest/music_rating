'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { FlowerSpinner } from '../Loading';
import type { MetricFitResponse } from '../../../lib/tasteMap/apiTypes';
import { TasteMapApiError, fitMetric, getMetric } from '../../../lib/tasteMap/client';
import { BLOCKS, type BlockName, type NodeKey, type Vec3 } from '../../../lib/tasteMap/types';
import { PanelHeader, SectionLabel, SignInNote, pillPlain, pillSm, pillSolid, useCopy } from './ui';

/**
 * "Your map weights" (TASTE_MAP_PLAN.md D6): what the personal metric learned
 * from the user's arranged map, and whether it was kept. GET /metric on open
 * shows the stored state; "Learn from my map" POSTs /metric with the working
 * layout (the shell flushes the pending autosave first, so the stored pins the
 * route reads are current). The route keeps the learned weights only when they
 * beat the defaults on leave-one-pin-out; its reason sentence is shown verbatim.
 * A fit that changes the weights in use offers "Rebuild map" (reload with
 * ?refresh=1), since node placement depends on them.
 */

const COPY = {
  en: {
    label: 'Your map weights',
    title: 'What your map says matters',
    intro: 'Learns from how you arranged and pinned your map which kinds of similarity matter to you.',
    learn: 'Learn from my map',
    learning: 'Learning…',
    never: 'Not learned yet. The map uses the default weights.',
    keptLearned: 'Using learned weights',
    keptUnit: 'Using the default weights',
    unitPlain: 'Your map keeps the default weights.',
    test: 'Pin test',
    testHint: 'Each pinned node is placed from the others; lower error is better.',
    noTest: 'No pins to test on yet.',
    dflt: 'Default',
    learned: 'Learned',
    pins: 'pins',
    triplets: 'comparisons',
    blocks: 'Kinds of similarity',
    blocksUnused: 'Kinds of similarity (learned, not in use)',
    tags: 'Genre tags',
    text: 'Description',
    graph: 'Listeners overlap',
    era: 'Same era',
    more: 'Matters more',
    less: 'Matters less',
    rebuild: 'Rebuild map',
    rebuildHint: 'The weights in use changed. Rebuild to re-place your map with them.',
    fitted: 'Fitted',
    signIn: 'Sign in to use',
    tooMany: 'Too many tries. Wait a minute and try again.',
    failed: 'Couldn’t learn',
    loadFailed: 'Couldn’t load',
    close: 'Close',
  },
  ko: {
    label: '내 지도 가중치',
    title: '내 지도가 중요하게 보는 것',
    intro: '지도를 배치하고 고정한 방식에서 어떤 종류의 유사성이 나에게 중요한지 배워요.',
    learn: '내 지도에서 배우기',
    learning: '배우는 중…',
    never: '아직 배우지 않았어요. 기본 가중치를 써요.',
    keptLearned: '배운 가중치 사용 중',
    keptUnit: '기본 가중치 사용 중',
    unitPlain: '지도는 기본 가중치를 그대로 써요.',
    test: '고정 테스트',
    testHint: '고정한 노드를 나머지로부터 다시 배치해 봐요. 오차가 작을수록 좋아요.',
    noTest: '아직 테스트할 고정이 없어요.',
    dflt: '기본',
    learned: '배운 값',
    pins: '개 고정',
    triplets: '개 비교',
    blocks: '유사성의 종류',
    blocksUnused: '유사성의 종류 (배운 값, 사용 안 함)',
    tags: '장르 태그',
    text: '설명',
    graph: '청취자 겹침',
    era: '같은 시기',
    more: '더 중요',
    less: '덜 중요',
    rebuild: '지도 다시 만들기',
    rebuildHint: '사용하는 가중치가 바뀌었어요. 다시 만들면 새 가중치로 배치돼요.',
    fitted: '학습',
    signIn: '로그인하면 쓸 수 있어요',
    tooMany: '시도가 너무 많아요. 1분 뒤에 다시 해 주세요.',
    failed: '배우지 못했어요',
    loadFailed: '불러오지 못했어요',
    close: '닫기',
  },
};

/** The weights actually in use, for "did this fit change anything". */
function inUse(r: MetricFitResponse | null): string {
  if (!r || r.kept === 'unit') return 'unit';
  return JSON.stringify([r.learned.block, r.learned.topTags, r.learned.bottomTags]);
}

function Bar({ value, max, strong, label, testId }: { value: number; max: number; strong: boolean; label: string; testId?: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="w-[104px] shrink-0 truncate text-[11.5px] font-semibold text-ink">{label}</span>
      <span className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-divider/60">
        <span
          className="block h-full rounded-full"
          style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: `rgb(var(--color-ink) / ${strong ? 0.75 : 0.32})` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted">{value.toFixed(3)}</span>
    </div>
  );
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; stored: MetricFitResponse | null };

export default function MetricPanel({
  enabled,
  onClose,
  getPositions,
  onRebuild,
}: {
  enabled: boolean;
  onClose: () => void;
  /** Flushes any pending autosave, then returns the working layout to fit on. */
  getPositions: () => Promise<Record<NodeKey, Vec3>>;
  onRebuild?: () => void;
}) {
  const c = useCopy(COPY);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [fit, setFit] = useState<MetricFitResponse | null>(null);
  const [fitting, setFitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getMetric()
      .then((r) => !cancelled && setLoad({ kind: 'ready', stored: 'stored' in r ? null : r }))
      .catch((e: Error) => !cancelled && setLoad({ kind: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const learn = async () => {
    setFitting(true);
    setError(null);
    try {
      const positions = await getPositions();
      setFit(await fitMetric({ positions }));
    } catch (e) {
      const err = e as TasteMapApiError;
      setError(err.status === 429 ? c.tooMany : `${c.failed}: ${err.message}`);
    } finally {
      setFitting(false);
    }
  };

  const shown = fit ?? (load.kind === 'ready' ? load.stored : null);
  // The map on screen was placed with the weights stored when it loaded; offer a rebuild once they differ.
  const changed = !!fit && inUse(fit) !== inUse(load.kind === 'ready' ? load.stored : null);
  const blockLabel: Record<BlockName, string> = { tags: c.tags, text: c.text, graph: c.graph, era: c.era };
  const blockMax = shown ? Math.max(...BLOCKS.map((b) => shown.learned.block[b] ?? 0)) : 0;
  const errMax = shown ? Math.max(shown.eval.errBaseline, shown.eval.errLearned) : 0;
  const learned = shown?.kept === 'learned';

  return (
    <div>
      <PanelHeader label={c.label} title={c.title} onClose={onClose} closeLabel={c.close} />
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{c.intro}</p>
      {!enabled && <SignInNote text={c.signIn} />}
      <button type="button" onClick={learn} disabled={!enabled || fitting || load.kind === 'loading'} className={`${pillSolid} ${pillSm} mt-2.5`}>
        <Sparkles size={12} />
        {fitting ? c.learning : c.learn}
      </button>
      {error && <p className="mt-2 break-words text-[11.5px] font-semibold text-ink">{error}</p>}
      {enabled && load.kind === 'loading' && (
        <div className="flex h-24 items-center justify-center">
          <FlowerSpinner />
        </div>
      )}
      {enabled && load.kind === 'error' && !fit && (
        <p className="mt-2 text-[11.5px] text-ink">
          {c.loadFailed}: {load.message}
        </p>
      )}
      {enabled && load.kind === 'ready' && !shown && <p className="mt-3 text-[11.5px] text-muted">{c.never}</p>}

      {changed && onRebuild && (
        <div className="mt-3 rounded-xl border border-divider bg-surface px-3 py-2.5">
          <p className="text-[11.5px] leading-snug text-ink">{c.rebuildHint}</p>
          <button type="button" onClick={onRebuild} className={`${pillPlain} ${pillSm} mt-2`}>
            <RefreshCw size={12} />
            {c.rebuild}
          </button>
        </div>
      )}

      {shown && (
        <div data-testid="metric-result">
          <div className="mt-3.5 flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${learned ? 'bg-ink text-page' : 'border border-divider text-ink'}`}
              data-testid="metric-kept"
            >
              {learned ? c.keptLearned : c.keptUnit}
            </span>
            <span className="text-[10.5px] text-muted">
              {c.fitted} {shown.fittedAt.slice(0, 10)}
            </span>
          </div>
          {!learned && <p className="mt-2 text-[12px] font-semibold text-ink">{c.unitPlain}</p>}
          <p className="mt-1 text-[12px] leading-snug text-ink" data-testid="metric-reason">
            {shown.reason}
          </p>

          <SectionLabel className="mt-4">{c.test}</SectionLabel>
          {shown.eval.n > 0 ? (
            <div className="mt-1.5 space-y-1">
              <Bar label={c.dflt} value={shown.eval.errBaseline} max={errMax} strong={!learned} testId="metric-err-default" />
              <Bar label={c.learned} value={shown.eval.errLearned} max={errMax} strong={learned} testId="metric-err-learned" />
              <p className="text-[10.5px] leading-snug text-muted">
                {shown.eval.n} {c.pins} · {shown.nTriplets} {c.triplets}. {c.testHint}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11.5px] text-muted">{c.noTest}</p>
          )}

          <SectionLabel className="mt-4">{learned ? c.blocks : c.blocksUnused}</SectionLabel>
          <div className="mt-1.5 space-y-1">
            {BLOCKS.map((b) => (
              <Bar key={b} label={blockLabel[b]} value={shown.learned.block[b] ?? 0} max={blockMax} strong={learned} />
            ))}
          </div>

          {(shown.learned.topTags.length > 0 || shown.learned.bottomTags.length > 0) && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(
                [
                  [c.more, shown.learned.topTags],
                  [c.less, shown.learned.bottomTags],
                ] as const
              ).map(([title, tags]) => (
                <div key={title} className="min-w-0">
                  <SectionLabel>{title}</SectionLabel>
                  <ul className="mt-1 space-y-0.5">
                    {tags.slice(0, 6).map((t) => (
                      <li key={t.id} className="flex items-baseline justify-between gap-1.5 text-[11.5px]">
                        <span className="min-w-0 truncate text-ink">{t.label}</span>
                        <span className="shrink-0 tabular-nums text-muted">×{t.w.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

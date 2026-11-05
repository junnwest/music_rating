'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, Eye, EyeOff, Ghost, MapPin } from 'lucide-react';
import type { GhostQuestion, NodeStateValue } from '../../../lib/tasteMap/ghostApi';
import { getQuestions, postAnswer, putNodeState } from '../../../lib/tasteMap/client';
import type { NodeKey, TasteMapPayloadNode } from '../../../lib/tasteMap/types';
import { pillPlain, pillSm, pillSolid, useCopy } from './ui';

/**
 * "Not placed yet" tray (lib/tasteMap/thin.ts): the map's ghost nodes, thin
 * (too little data) or misfit (like nothing else here), with what the user can
 * do about each:
 *
 *   Place it     selects the node; dragging it onto the map pins it, and a
 *                pinned ghost is a normal node (state 'placed').
 *   Answer       thin only: "Is X closer to A, B or C?" chips (GET/POST
 *                /api/taste/map/questions). An answer reshapes the node's
 *                tags, so the map is reloaded.
 *   Leave out    'hidden': not drawn, only listed here. Show again clears it.
 *   Include      "include anyway": a normal node wherever the data puts it.
 *
 * Choices are applied to the shell's working nodes in place (like a drag) and
 * `onChanged` re-renders; with `api` they're also stored
 * (PUT /api/taste/map/node-state). Without `api` (fixture / mock) everything
 * stays local and there are no questions.
 */

const COPY = {
  en: {
    title: 'Not placed yet',
    sub: 'Artists the map can’t place on its own. No need to force them in.',
    thin: 'Not much data about them yet',
    misfit: 'Doesn’t sit near anything else on your map',
    hidden: 'Left out of the map',
    place: 'Place it',
    answer: 'Answer',
    leaveOut: 'Leave out',
    showAgain: 'Show again',
    include: 'Include anyway',
    dragHint: 'Drag {name} onto the map where it belongs.',
    dragSwitch: 'Switch to To scale or 3D, then drag {name} where it belongs.',
    none: 'None of these',
    noneThanks: 'Got it. You can still place it by hand.',
    answered: 'Thanks, rebuilding your map…',
    loading: 'Loading question…',
    noQuestion: 'No question for this one. Place it by hand instead.',
    signIn: 'Sign in to answer',
    failed: 'Couldn’t save',
  },
  ko: {
    title: '아직 놓이지 않은 아티스트',
    sub: '지도가 스스로 자리를 찾지 못한 아티스트예요. 억지로 넣지 않아도 돼요.',
    thin: '아직 정보가 적어요',
    misfit: '지도 위 다른 아티스트와 잘 맞지 않아요',
    hidden: '지도에서 뺐어요',
    place: '직접 놓기',
    answer: '답하기',
    leaveOut: '빼기',
    showAgain: '다시 보이기',
    include: '그래도 넣기',
    dragHint: '{name}을(를) 지도 위 어울리는 곳으로 끌어다 놓아 주세요.',
    dragSwitch: '실제 거리 또는 3D로 바꾼 뒤 {name}을(를) 끌어다 놓아 주세요.',
    none: '해당 없음',
    noneThanks: '알겠어요. 직접 놓을 수도 있어요.',
    answered: '고마워요, 지도를 다시 그리는 중…',
    loading: '질문 불러오는 중…',
    noQuestion: '이 아티스트에 대한 질문이 없어요. 직접 놓아 주세요.',
    signIn: '로그인하면 답할 수 있어요',
    failed: '저장하지 못했어요',
  },
};

type Note = { key: NodeKey; text: string; error?: boolean };

export default function GhostTray({
  nodes,
  pins,
  api,
  canDrag,
  onPick,
  onChanged,
  onReload,
}: {
  /** The shell's working nodes (mutated in place, like a drag). */
  nodes: TasteMapPayloadNode[];
  /** Current pins: a ghost that gets pinned has been placed. */
  pins: ReadonlyMap<NodeKey, unknown>;
  api: boolean;
  /** False on the schematic view (nothing can be dragged there). */
  canDrag: boolean;
  onPick: (key: NodeKey) => void;
  /** Re-render after a node's `ghost` changed in place. */
  onChanged: () => void;
  /** Re-fetch the map (after an answer moved a node). */
  onReload?: (opts?: { refresh?: boolean }) => void;
}) {
  const c = useCopy(COPY);
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState<NodeKey | null>(null);
  const [asking, setAsking] = useState<NodeKey | null>(null);
  const [questions, setQuestions] = useState<Map<NodeKey, GhostQuestion> | null>(null);
  const [busy, setBusy] = useState<NodeKey | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [done, setDone] = useState<Set<NodeKey>>(() => new Set());

  const ghosts = nodes.filter((n) => n.ghost);
  const shown = ghosts.filter((n) => !n.ghost?.hidden);
  const name = (n: TasteMapPayloadNode) => (n.eraLabel ? `${n.label} (${n.eraLabel})` : n.label);

  const store = useCallback(
    async (key: NodeKey, state: NodeStateValue | null) => {
      if (!api) return;
      await putNodeState({ key, state });
    },
    [api],
  );

  // A ghost dropped onto the map is pinned: it's placed, a normal node now.
  const seenPins = useRef(new Set(pins.keys()));
  useEffect(() => {
    for (const n of nodes) {
      if (!n.ghost || !pins.has(n.key) || seenPins.current.has(n.key)) continue;
      n.ghost = undefined;
      if (placing === n.key) setPlacing(null);
      onChanged();
      void store(n.key, 'placed').catch(() => setNote({ key: n.key, text: c.failed, error: true }));
    }
    seenPins.current = new Set(pins.keys());
  }, [pins, nodes, placing, onChanged, store, c.failed]);

  // Questions: fetched once per map load, when the tray is first opened.
  useEffect(() => {
    setQuestions(null);
    setDone(new Set());
  }, [nodes]);
  useEffect(() => {
    if (!open || !api || questions) return;
    const ctl = new AbortController();
    getQuestions(ctl.signal)
      .then((r) => setQuestions(new Map(r.questions.map((q) => [q.key, q]))))
      .catch(() => {
        if (!ctl.signal.aborted) setQuestions(new Map());
      });
    return () => ctl.abort();
  }, [open, api, questions]);

  if (!ghosts.length) return null;

  const act = async (n: TasteMapPayloadNode, fn: () => Promise<void>, after: () => void) => {
    setBusy(n.key);
    setNote(null);
    try {
      await fn();
      after();
      onChanged();
    } catch (e) {
      setNote({ key: n.key, text: `${c.failed}: ${(e as Error).message}`, error: true });
    } finally {
      setBusy(null);
    }
  };

  const leaveOut = (n: TasteMapPayloadNode) =>
    act(n, () => store(n.key, 'hidden'), () => {
      if (n.ghost) n.ghost = { ...n.ghost, hidden: true };
      if (placing === n.key) setPlacing(null);
      if (asking === n.key) setAsking(null);
    });
  const showAgain = (n: TasteMapPayloadNode) =>
    act(n, () => store(n.key, null), () => {
      if (n.ghost) n.ghost = { reason: n.ghost.reason, evidence: n.ghost.evidence };
    });
  const include = (n: TasteMapPayloadNode) =>
    act(n, () => store(n.key, 'included'), () => {
      n.ghost = undefined;
    });
  const place = (n: TasteMapPayloadNode) => {
    setAsking(null);
    setPlacing(n.key);
    onPick(n.key);
  };
  const answer = (n: TasteMapPayloadNode, genreId: string | null) =>
    act(
      n,
      async () => {
        await postAnswer(genreId ? { key: n.key, genreId } : { key: n.key, none: true });
      },
      () => {
        setDone((prev) => new Set(prev).add(n.key));
        setAsking(null);
        if (genreId) {
          n.ghost = undefined;
          setNote({ key: n.key, text: c.answered });
          onReload?.();
        } else {
          setNote({ key: n.key, text: c.noneThanks });
        }
      },
    );

  const placingNode = placing ? nodes.find((n) => n.key === placing && n.ghost) : null;

  return (
    <div className="mt-2 rounded-xl border border-dashed border-divider bg-surface px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Ghost size={14} className="shrink-0 text-muted" />
        <span className="text-[12.5px] font-bold text-ink">
          {c.title} ({ghosts.length})
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
            {shown.map(name).join(' · ')}
          </span>
        )}
        <ChevronDown size={14} className={`ml-auto shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {placingNode && (
        <p className="mt-1.5 rounded-lg bg-ink/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink">
          {(canDrag ? c.dragHint : c.dragSwitch).replace('{name}', name(placingNode))}
        </p>
      )}

      {open && (
        <div className="mt-1.5">
          <p className="text-[11.5px] leading-snug text-muted">{c.sub}</p>
          <ul className="mt-2 space-y-2">
            {ghosts.map((n) => {
              const g = n.ghost!;
              const q = questions?.get(n.key);
              const canAsk = g.reason === 'thin' && !g.hidden && !done.has(n.key);
              return (
                <li key={n.key} className="border-t border-divider/60 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onPick(n.key)}
                      className="min-w-0 max-w-full truncate text-[12.5px] font-bold text-ink hover:underline"
                    >
                      {name(n)}
                    </button>
                    <span className="min-w-0 text-[11px] text-muted">{g.hidden ? c.hidden : g.reason === 'thin' ? c.thin : c.misfit}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.hidden ? (
                      <button type="button" disabled={busy === n.key} onClick={() => showAgain(n)} className={`${pillPlain} ${pillSm}`}>
                        <Eye size={12} />
                        {c.showAgain}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy === n.key}
                          aria-pressed={placing === n.key}
                          onClick={() => place(n)}
                          className={`${placing === n.key ? pillSolid : pillPlain} ${pillSm}`}
                        >
                          <MapPin size={12} />
                          {c.place}
                        </button>
                        {canAsk && (
                          <button
                            type="button"
                            disabled={busy === n.key}
                            aria-expanded={asking === n.key}
                            onClick={() => setAsking((k) => (k === n.key ? null : n.key))}
                            className={`${asking === n.key ? pillSolid : pillPlain} ${pillSm}`}
                          >
                            <CircleHelp size={12} />
                            {c.answer}
                          </button>
                        )}
                        <button type="button" disabled={busy === n.key} onClick={() => leaveOut(n)} className={`${pillPlain} ${pillSm}`}>
                          <EyeOff size={12} />
                          {c.leaveOut}
                        </button>
                        <button
                          type="button"
                          disabled={busy === n.key}
                          onClick={() => include(n)}
                          className="px-1 text-[11px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                        >
                          {c.include}
                        </button>
                      </>
                    )}
                  </div>

                  {asking === n.key && (
                    <div className="mt-2 rounded-lg bg-ink/[0.04] px-2.5 py-2">
                      {!api ? (
                        <p className="text-[11.5px] font-semibold text-muted">{c.signIn}</p>
                      ) : !questions ? (
                        <p className="text-[11.5px] text-muted">{c.loading}</p>
                      ) : !q ? (
                        <p className="text-[11.5px] text-muted">{c.noQuestion}</p>
                      ) : (
                        <QuestionCard q={q} busy={busy === n.key} c={c} onAnswer={(id) => void answer(n, id)} onLeaveOut={() => void leaveOut(n)} />
                      )}
                    </div>
                  )}

                  {note?.key === n.key && (
                    <p role="status" className={`mt-1 text-[11px] ${note.error ? 'font-semibold text-ink' : 'text-muted'}`}>
                      {note.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  busy,
  c,
  onAnswer,
  onLeaveOut,
}: {
  q: GhostQuestion;
  busy: boolean;
  c: (typeof COPY)['en'];
  onAnswer: (genreId: string | null) => void;
  onLeaveOut: () => void;
}) {
  const ko = c === COPY.ko;
  const opts = q.options.map((o) => (ko ? o.labelKo : o.label));
  const who = q.eraLabel ? `${q.label} (${q.eraLabel})` : q.label;
  const prompt = ko ? `${who}은(는) ${opts.join(', ')} 중 어디에 더 가까울까요?` : q.prompt;
  return (
    <>
      <p className="text-[12px] font-semibold leading-snug text-ink">{prompt}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {q.options.map((o, i) => (
          <button key={o.genreId} type="button" disabled={busy} onClick={() => onAnswer(o.genreId)} className={`${pillPlain} ${pillSm}`}>
            {opts[i]}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(null)}
          className="px-1 text-[11px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          {c.none}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onLeaveOut}
          className="px-1 text-[11px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          {c.leaveOut}
        </button>
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, SquarePen, Star, Trash2 } from 'lucide-react';
import FlowerGlyph from './FlowerGlyph';
import { useLanguage } from '../../lib/i18n';
import { formatScore } from '../../lib/sj/display';

/**
 * Inline manual-rating editor for the album page — replaces the rate/edit
 * modal flow so editing never displaces the user:
 *
 * - Collapsed: 5 stars (empty when unrated, filled by score when rated) +
 *   an edit glyph. Clicking a star opens the editor at that value.
 * - Expanded: a dropdown panel in-flow (no overlay) with stars, an editable
 *   number, and the slider. Every change AUTO-SAVES (debounced) — no Save
 *   button. Undo reverts to the value the edit session started with.
 * - The number is focused + selected on entry, so digits type straight in;
 *   two digits auto-insert the period ("43" → 4.3). The scroll wheel over
 *   the panel nudges the rating by one step.
 */
export default function InlineRatingEditor({
  score,
  step = 0.5,
  onSave,
}: {
  /** The saved score (null = unrated). Parent owns persistence + refresh. */
  score: number | null;
  step?: number;
  onSave: (score: number | null) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(score ?? 3);
  const [numText, setNumText] = useState('');
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const sessionStart = useRef<number | null>(null);
  const lastSaved = useRef<number | null>(score);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!editing) lastSaved.current = score;
  }, [score, editing]);

  const clampSnap = useCallback(
    (v: number) => {
      const snapped = Math.round(v / step) * step;
      return Math.min(5, Math.max(0.5, Math.round(snapped * 10) / 10));
    },
    [step],
  );

  const fmt = (v: number) => v.toFixed(1);

  const update = useCallback(
    (v: number, alsoText = true) => {
      const next = clampSnap(v);
      dirtyRef.current = true;
      draftRef.current = next;
      setDraft(next);
      if (alsoText) setNumText(fmt(next));
    },
    [clampSnap],
  );

  function openEditor(initial?: number) {
    sessionStart.current = score;
    lastSaved.current = score;
    dirtyRef.current = false;
    const start = initial != null ? clampSnap(initial) : (score ?? 3);
    draftRef.current = start;
    setDraft(start);
    setNumText(fmt(start));
    setEditing(true);
    if (initial != null && (score == null || Math.abs(initial - score) > 1e-9)) {
      dirtyRef.current = true; // opening via a star click is already an edit
    }
  }

  // Focus + select the number so typing replaces it immediately
  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      numRef.current?.focus();
      numRef.current?.select();
    });
  }, [editing]);

  // Debounced auto-save of edits
  useEffect(() => {
    if (!editing || !dirtyRef.current) return;
    if (lastSaved.current != null && Math.abs(lastSaved.current - draft) < 1e-9) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      lastSaved.current = draft;
      await onSave(draft);
      setSavedFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1400);
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [draft, editing, onSave]);

  const flushAndClose = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (
      dirtyRef.current &&
      (lastSaved.current == null || Math.abs(lastSaved.current - draftRef.current) > 1e-9)
    ) {
      lastSaved.current = draftRef.current;
      void onSave(draftRef.current);
    }
    setEditing(false);
  }, [onSave]);

  // Click outside closes (saving anything pending)
  useEffect(() => {
    if (!editing) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) flushAndClose();
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [editing, flushAndClose]);

  // Scroll wheel over the panel nudges by one step (native listener —
  // React's synthetic wheel handlers can't preventDefault reliably)
  useEffect(() => {
    if (!editing) return;
    const el = panelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      update(draftRef.current + (e.deltaY < 0 ? step : -step));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editing, step, update]);

  // "43" and "4.3" both mean 4.3 — insert the period after the first digit
  function onNumChange(raw: string) {
    let v = raw.replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    const digits = v.replace(/\./g, '');
    if (!v.includes('.') && digits.length >= 2) v = `${digits[0]}.${digits[1]}`;
    if (v.length > 3) v = v.slice(0, 3);
    setNumText(v);
    const parsed = parseFloat(v);
    if (!Number.isNaN(parsed) && parsed > 0) update(parsed, false);
  }

  async function undo() {
    clearTimeout(saveTimer.current);
    if (sessionStart.current != null) {
      update(sessionStart.current);
    } else {
      // Session started unrated → undo removes the rating entirely
      dirtyRef.current = false;
      lastSaved.current = null;
      setEditing(false);
      await onSave(null);
    }
  }

  async function removeRating() {
    clearTimeout(saveTimer.current);
    dirtyRef.current = false;
    lastSaved.current = null;
    setEditing(false);
    await onSave(null);
  }

  const canUndo =
    sessionStart.current == null
      ? dirtyRef.current || lastSaved.current != null
      : Math.abs((sessionStart.current ?? 0) - draft) > 1e-9;

  function starsRow(value: number | null, interactive: boolean, size = 20) {
    return (
      <span
        className={`flex items-center gap-0.5 ${value == null ? 'text-muted' : 'text-accent'}`}
        onMouseLeave={() => interactive && setHoverStar(null)}
      >
        {[1, 2, 3, 4, 5].map((s) => {
          const shown = interactive && hoverStar != null ? hoverStar : value;
          const cls =
            shown != null && shown >= s
              ? 'fill-current'
              : shown != null && shown >= s - 0.5
                ? 'fill-current opacity-50'
                : 'opacity-25';
          const star = <Star key={s} size={size} className={cls} />;
          if (!interactive) return star;
          return (
            <button
              key={s}
              aria-label={`${s}.0`}
              onMouseEnter={() => setHoverStar(s)}
              onClick={() => (editing ? update(s) : openEditor(s))}
              className="transition-transform hover:scale-110"
            >
              {star}
            </button>
          );
        })}
      </span>
    );
  }

  return (
    <div ref={rootRef}>
      {/* Collapsed row — same anatomy rated or not */}
      <div className="flex items-center gap-3 flex-wrap">
        {starsRow(editing ? draft : score, true)}
        {!editing && score != null && (
          <button
            onClick={() => openEditor()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/[0.16] transition"
          >
            <FlowerGlyph size={12} className="text-accent" />
            <span className="text-[14px] font-bold text-accent">{formatScore(score)}</span>
          </button>
        )}
        <span className="flex-1" />
        {!editing && (
          <button
            onClick={() => openEditor()}
            aria-label={score == null ? t('sj.album.rateThisAlbum') : t('sj.common.edit')}
            className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-page transition"
          >
            <SquarePen size={16} />
          </button>
        )}
      </div>

      {/* Edit panel — in-flow dropdown, auto-saves */}
      {editing && (
        <div
          ref={panelRef}
          className="mt-3 rounded-xl border border-divider bg-page p-4 sj-pop-in"
        >
          <div className="flex items-center gap-3">
            <input
              ref={numRef}
              value={numText}
              onChange={(e) => onNumChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  flushAndClose();
                }
              }}
              inputMode="decimal"
              aria-label={t('sj.rate.yourRating')}
              className="w-[64px] px-1 py-0.5 rounded-lg bg-surface border border-divider text-center text-[22px] font-bold text-accent tabular-nums outline-none focus:border-accent/60"
            />
            <span className="text-[13px] text-muted">/ 5</span>
            <span className="flex-1" />
            <span
              aria-live="polite"
              className={`flex items-center gap-1 text-[11.5px] text-muted transition-opacity ${
                savedFlash ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Check size={12} className="text-accent" /> {t('sj.rate.saved')}
            </span>
            {canUndo && (
              <button
                onClick={undo}
                aria-label={t('sj.rate.undo')}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
              >
                <RotateCcw size={15} />
              </button>
            )}
            {score != null && (
              <button
                onClick={removeRating}
                aria-label={t('sj.rate.removeRating')}
                className="p-1.5 rounded-lg text-muted hover:text-red-500 hover:bg-surface transition"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>

          <input
            type="range"
            min={0.5}
            max={5}
            step={step}
            value={draft}
            onChange={(e) => update(parseFloat(e.target.value))}
            className="w-full mt-3 accent-[#2979B7]"
            aria-label={t('sj.rate.yourRating')}
          />
          <div className="flex justify-between text-[10px] text-muted px-0.5 mt-1">
            <span>0.5</span>
            <span>5.0</span>
          </div>
        </div>
      )}
    </div>
  );
}

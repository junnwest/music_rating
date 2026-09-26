'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, ListMusic, Plus, Search, X, AlertCircle } from 'lucide-react';
import { useMixName, useMixTarget } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import type { MixItemMeta, MixItemRef } from '../../lib/sj/mixes';

/**
 * D2 — the Spotify-style "Saved to {mix} · Change" dropdown.
 *
 * Non-blocking by design: no backdrop, the page keeps scrolling, and the
 * dropdown tracks its anchor every frame — fading out once the anchor leaves
 * the viewport (or, for a cursor anchor, on the first scroll). The "saved" view
 * auto-dismisses after ~4s unless hovered/focused; ignoring it keeps the save.
 * "Change" swaps in a searchable, checkable mix list (+ New mix) in place.
 *
 * Rendered once, by `MixTargetProvider`; surfaces open it via `saveAndShow`.
 */

export type PopoverAnchor = HTMLElement | { x: number; y: number };

const W = 272;
const EDGE = 8;
const DISMISS_MS = 4000;

interface Props {
  state: {
    item: MixItemRef;
    meta?: MixItemMeta;
    anchor: PopoverAnchor;
    mixId: string | null;
    view: 'saved' | 'change';
    error: boolean;
  };
  onChangeView: (view: 'saved' | 'change') => void;
  onClose: () => void;
}

function anchorRect(anchor: PopoverAnchor): DOMRect | null {
  if (anchor instanceof HTMLElement) {
    if (!anchor.isConnected) return null;
    return anchor.getBoundingClientRect();
  }
  return new DOMRect(anchor.x, anchor.y, 0, 0);
}

export default function SavedToMixPopover({ state, onChangeView, onClose }: Props) {
  const { t } = useLanguage();
  const mixName = useMixName();
  const { mixes, membership, add, remove, setTarget, createMix, defaultMixName } = useMixTarget();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const { item, anchor, view } = state;
  const members = membership(item);
  const about = mixes?.find((m) => m.id === state.mixId) ?? null;
  const others = members.filter((id) => id !== state.mixId).length;

  // Fade, then unmount — used for the timeout and for the anchor scrolling away.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fadeOut = () => {
    setLeaving(true);
    setTimeout(() => closeRef.current(), 160);
  };

  // Follow the anchor. rAF rather than scroll listeners so it also tracks
  // layout shifts (a shelf scrolling horizontally, a card collapsing).
  useLayoutEffect(() => {
    let raf = 0;
    const isPoint = !(anchor instanceof HTMLElement);
    const place = () => {
      const r = anchorRect(anchor);
      const el = ref.current;
      if (!r) {
        fadeOut();
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!isPoint && (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw)) {
        fadeOut();
        return;
      }
      const h = el?.offsetHeight ?? 120;
      const left = Math.min(
        Math.max(EDGE, isPoint ? r.left : r.right - W),
        vw - W - EDGE,
      );
      let top = r.bottom + 6;
      if (top + h > vh - EDGE && r.top - 6 - h > EDGE) top = r.top - 6 - h;
      top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      if (!isPoint) raf = requestAnimationFrame(place);
    };
    place();
    const onScroll = () => fadeOut();
    if (isPoint) window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      if (isPoint) window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Click-away + Escape. Deferred so the opening click doesn't close it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      closeRef.current();
    };
    // Capture phase + stop, so Escape closes only this dropdown and not a
    // modal it was opened from (e.g. the post-rating sheet).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    const id = setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  // Auto-dismiss only the passive "saved" view, and never while the pointer
  // or focus is inside it.
  useEffect(() => {
    if (view !== 'saved' || hovered || state.error) return;
    const id = setTimeout(fadeOut, DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hovered, state.error]);

  if (typeof document === 'undefined') return null;

  const filtered = (mixes ?? []).filter((m) =>
    query.trim() === '' ? true : mixName(m).toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function toggle(mixId: string) {
    if (members.includes(mixId)) {
      await remove(item, mixId);
    } else {
      setTarget(mixId);
      await add(item, { mixId, meta: state.meta, from: anchorRect(anchor) });
    }
  }

  async function submitNew() {
    if (busy) return;
    setBusy(true);
    // A blank name is fine — createMix falls back to defaultMixName.
    const mix = await createMix(newName);
    if (mix) {
      setTarget(mix.id);
      await add(item, { mixId: mix.id, meta: state.meta, from: anchorRect(anchor) });
      setCreating(false);
      setNewName('');
    }
    setBusy(false);
  }

  const MixIcon = ({ isDefault }: { isDefault: boolean }) =>
    isDefault ? (
      <Clock size={15} className="text-accent shrink-0" />
    ) : (
      <ListMusic size={15} className="text-accent shrink-0" />
    );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('sj.mix.saveToMix')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setHovered(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`fixed z-[130] rounded-xl bg-surface border border-divider shadow-xl transition-opacity duration-150 ${
        leaving ? 'opacity-0' : 'opacity-100 sj-pop-in'
      }`}
      style={{
        width: W,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
      }}
    >
      {view === 'saved' ? (
        <div className="py-1.5">
          {state.error ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-red-500">
              <AlertCircle size={15} className="shrink-0" />
              <span className="flex-1">{t('sj.mix.saveFailed')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Check size={15} className="text-accent shrink-0" />
              <span className="flex-1 min-w-0 text-[13px] text-ink truncate">
                {t('sj.mix.savedToPrefix')}
                <span className="font-semibold">{mixName(about)}</span>
                {t('sj.mix.savedToSuffix')}
                {others > 0 && (
                  <span className="text-muted">
                    {' '}
                    {t('sj.mix.andNMore').replace('{n}', String(others))}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onChangeView('change')}
                className="shrink-0 px-2 py-1 -my-1 rounded-md text-[12.5px] font-semibold text-accent hover:bg-page transition"
              >
                {t('sj.mix.change')}
              </button>
            </div>
          )}
          {about && members.includes(about.id) && (
            <>
              <div className="h-px bg-divider my-1" />
              <button
                type="button"
                onClick={() => {
                  void remove(item, about.id);
                  fadeOut();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-red-500 hover:bg-page transition"
              >
                <X size={15} className="shrink-0" />
                <span className="truncate">
                  {t('sj.mix.removeFrom').replace('{mix}', mixName(about))}
                </span>
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col max-h-[min(420px,70vh)]">
          <div className="p-2 border-b border-divider">
            <label className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-page border border-divider focus-within:border-accent/60 transition">
              <Search size={13} className="text-muted shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sj.mix.findMix')}
                className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder-placeholder outline-none"
              />
            </label>
          </div>
          <ul className="flex-1 overflow-y-auto py-1" role="listbox" aria-multiselectable>
            {mixes === null ? (
              <li className="px-3 py-3 text-[12.5px] text-muted">{t('sj.common.loading')}</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-3 text-[12.5px] text-muted">{t('sj.mix.noMatch')}</li>
            ) : (
              filtered.map((m) => {
                const on = members.includes(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => void toggle(m.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-page transition"
                    >
                      <MixIcon isDefault={m.is_default} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] text-ink truncate">{mixName(m)}</span>
                        <span className="block text-[11px] text-muted">
                          {m.itemCount === 1
                            ? t('sj.mix.oneItem')
                            : t('sj.mix.nItems').replace('{n}', String(m.itemCount))}
                        </span>
                      </span>
                      <span
                        className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition ${
                          on ? 'bg-accent text-white' : 'border border-divider'
                        }`}
                      >
                        {on && <Check size={12} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-divider p-1.5">
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitNew();
                }}
                className="flex items-center gap-1.5 p-1"
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setCreating(false);
                    }
                  }}
                  maxLength={100}
                  placeholder={defaultMixName || t('sj.mix.namePlaceholder')}
                  aria-label={t('sj.mix.namePlaceholder')}
                  className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-page border border-divider text-[13px] text-ink placeholder-placeholder outline-none focus:border-accent/60"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="h-8 px-3 rounded-lg bg-accent text-white text-[12.5px] font-semibold disabled:opacity-50 hover:opacity-90 transition"
                >
                  {t('sj.mix.createBtn')}
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-page transition"
                >
                  <Plus size={15} className="text-accent" />
                  {t('sj.mix.newMix')}
                </button>
                <button
                  type="button"
                  onClick={fadeOut}
                  className="px-3 py-2 rounded-lg text-[13px] font-semibold text-accent hover:bg-page transition"
                >
                  {t('sj.mix.done')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

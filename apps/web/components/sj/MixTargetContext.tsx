'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from './SessionContext';
import SavedToMixPopover, { type PopoverAnchor } from './SavedToMixPopover';
import { useLanguage } from '../../lib/i18n';
import {
  addToMix,
  createMix as createMixRow,
  itemKey,
  listMyMixes,
  loadMembershipIndex,
  removeFromMix,
  type MixItemMeta,
  type MixItemRef,
  type MixSummary,
} from '../../lib/sj/mixes';

/**
 * App-wide "add to mix" state (P1 of WEB_CHANGE_PROMPTS_2).
 *
 * - **Target (D1):** dock mix (when the Mix Dock is open) → the last mix the
 *   user saved to (localStorage, per user) → the default "Listen Later" mix.
 *   Choosing a mix anywhere updates it.
 * - **Membership (D3):** one in-memory index of every item the user has saved,
 *   so each bookmark knows its filled state without a query per cover.
 * - **Popover (D2):** a single anchored "Saved to {mix} · Change" dropdown for
 *   the whole app, opened via `saveAndShow`.
 * - **`lastAdded`:** a signal the dock animates on.
 */

export interface LastAdded {
  seq: number;
  item: MixItemRef;
  meta?: MixItemMeta;
  mixId: string;
  /** Viewport rect of whatever triggered the save — where a flying thumbnail starts. */
  from: DOMRect | null;
}

interface PopoverState {
  item: MixItemRef;
  meta?: MixItemMeta;
  anchor: PopoverAnchor;
  /** The mix this dropdown is "about" — the one just saved to, or a current home. */
  mixId: string | null;
  view: 'saved' | 'change';
  error: boolean;
}

interface MixTargetValue {
  /** null while loading (or signed out). */
  mixes: MixSummary[] | null;
  target: MixSummary | null;
  setTarget: (mixId: string) => void;
  /** Set by the Mix Dock while it's open; it then *is* the target. */
  dockMixId: string | null;
  setDockMixId: (mixId: string | null) => void;
  /** Mix ids currently holding this item. */
  membership: (item: MixItemRef) => string[];
  isSaved: (item: MixItemRef) => boolean;
  /** Add to a mix (default: the target). Optimistic; resolves false on failure. */
  add: (
    item: MixItemRef,
    opts?: {
      mixId?: string;
      meta?: MixItemMeta;
      from?: DOMRect | null;
      /** false = don't make this mix the "last used" target (curating a mix in place). */
      remember?: boolean;
    },
  ) => Promise<boolean>;
  remove: (item: MixItemRef, mixId: string) => Promise<boolean>;
  createMix: (name: string, isPublic?: boolean) => Promise<MixSummary | null>;
  /**
   * The bookmark press: unsaved → save to target and show the dropdown;
   * already saved → show the dropdown only (D3, never unsaves). Signed-out
   * users get the auth prompt.
   */
  saveAndShow: (item: MixItemRef, anchor: PopoverAnchor, meta?: MixItemMeta) => void;
  /** Open the dropdown straight to the mix list ("Save to another mix…"). */
  openChange: (item: MixItemRef, anchor: PopoverAnchor, meta?: MixItemMeta) => void;
  lastAdded: LastAdded | null;
  /** Bumped on every membership change — lets pages re-read mix contents. */
  version: number;
  refresh: () => Promise<void>;
}

const noop = async () => false;
const MixTargetContext = createContext<MixTargetValue>({
  mixes: null,
  target: null,
  setTarget: () => {},
  dockMixId: null,
  setDockMixId: () => {},
  membership: () => [],
  isSaved: () => false,
  add: noop,
  remove: noop,
  createMix: async () => null,
  saveAndShow: () => {},
  openChange: () => {},
  lastAdded: null,
  version: 0,
  refresh: async () => {},
});

const storageKey = (userId: string) => `sj-mix-target:${userId}`;

function readStoredTarget(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeStoredTarget(userId: string, mixId: string) {
  try {
    localStorage.setItem(storageKey(userId), mixId);
  } catch {
    /* private mode / storage blocked — the target just won't persist */
  }
}

/** "Listen Later" is stored in English; show it in the viewer's language. */
export function useMixName() {
  const { t } = useLanguage();
  return useCallback(
    (mix: Pick<MixSummary, 'name' | 'is_default'> | null | undefined) =>
      !mix ? '' : mix.is_default && mix.name === 'Listen Later' ? t('listenLater.title') : mix.name,
    [t],
  );
}

export function MixTargetProvider({ children }: { children: ReactNode }) {
  const { userId, requireAuth } = useSession();
  const [mixes, setMixes] = useState<MixSummary[] | null>(null);
  const [index, setIndex] = useState<Map<string, Set<string>>>(new Map());
  const [storedTargetId, setStoredTargetId] = useState<string | null>(null);
  const [dockMixId, setDockMixId] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<LastAdded | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [version, setVersion] = useState(0);
  const seqRef = useRef(0);
  const loadRef = useRef<Promise<MixSummary[] | null> | null>(null);
  // Mirrors for callbacks that must see the latest value without re-binding.
  const mixesRef = useRef<MixSummary[] | null>(null);
  const indexRef = useRef(index);
  mixesRef.current = mixes;
  indexRef.current = index;

  const load = useCallback(async () => {
    if (!userId) return null;
    const { data, error } = await listMyMixes(userId);
    if (error || !data) {
      console.error('[mixes] failed to load mixes:', error?.message);
      setMixes([]);
      return null;
    }
    setMixes(data);
    const idx = await loadMembershipIndex(data.map((m) => m.id));
    if (idx.error || !idx.data) {
      console.error('[mixes] failed to load membership:', idx.error?.message);
    } else {
      setIndex(idx.data);
    }
    return data;
  }, [userId]);

  useEffect(() => {
    setMixes(null);
    setIndex(new Map());
    setPopover(null);
    setDockMixId(null);
    if (!userId) {
      loadRef.current = null;
      return;
    }
    setStoredTargetId(readStoredTarget(userId));
    loadRef.current = load();
  }, [userId, load]);

  const refresh = useCallback(async () => {
    loadRef.current = load();
    await loadRef.current;
    setVersion((v) => v + 1);
  }, [load]);

  const resolveTarget = useCallback(
    (list: MixSummary[] | null): MixSummary | null => {
      if (!list || list.length === 0) return null;
      return (
        (dockMixId ? list.find((m) => m.id === dockMixId) : undefined) ??
        (storedTargetId ? list.find((m) => m.id === storedTargetId) : undefined) ??
        list.find((m) => m.is_default) ??
        list[0]
      );
    },
    [dockMixId, storedTargetId],
  );

  const target = useMemo(() => resolveTarget(mixes), [resolveTarget, mixes]);

  const setTarget = useCallback(
    (mixId: string) => {
      if (!userId) return;
      setStoredTargetId(mixId);
      writeStoredTarget(userId, mixId);
      // While the dock is open it *is* the target — keep the two in step.
      setDockMixId((cur) => (cur ? mixId : cur));
    },
    [userId],
  );

  const membership = useCallback(
    (item: MixItemRef) => Array.from(index.get(itemKey(item)) ?? []),
    [index],
  );
  const isSaved = useCallback((item: MixItemRef) => (index.get(itemKey(item))?.size ?? 0) > 0, [
    index,
  ]);

  function patchIndex(item: MixItemRef, mixId: string, present: boolean) {
    setIndex((prev) => {
      const next = new Map(prev);
      const key = itemKey(item);
      const set = new Set(next.get(key) ?? []);
      if (present) set.add(mixId);
      else set.delete(mixId);
      if (set.size) next.set(key, set);
      else next.delete(key);
      return next;
    });
  }

  function patchMix(mixId: string, delta: number, coverUrl?: string | null) {
    setMixes((prev) =>
      prev
        ? prev.map((m) =>
            m.id !== mixId
              ? m
              : {
                  ...m,
                  itemCount: Math.max(0, m.itemCount + delta),
                  covers:
                    delta > 0 && coverUrl
                      ? [coverUrl, ...m.covers.filter((c) => c !== coverUrl)].slice(0, 4)
                      : m.covers,
                },
          )
        : prev,
    );
  }

  const add = useCallback<MixTargetValue['add']>(
    async (item, opts = {}) => {
      if (!userId) return false;
      const list = mixesRef.current ?? (await loadRef.current) ?? null;
      const mixId = opts.mixId ?? resolveTarget(list)?.id;
      if (!mixId) return false;
      if (indexRef.current.get(itemKey(item))?.has(mixId)) return true;
      patchIndex(item, mixId, true);
      patchMix(mixId, 1, opts.meta?.coverUrl);
      if (opts.remember !== false) {
        setStoredTargetId(mixId);
        writeStoredTarget(userId, mixId);
      }
      seqRef.current += 1;
      setLastAdded({ seq: seqRef.current, item, meta: opts.meta, mixId, from: opts.from ?? null });
      const { error } = await addToMix(mixId, item);
      if (error) {
        console.error('[mixes] add failed:', error.message);
        patchIndex(item, mixId, false);
        patchMix(mixId, -1);
        return false;
      }
      setVersion((v) => v + 1);
      return true;
    },
    [userId, resolveTarget],
  );

  const remove = useCallback<MixTargetValue['remove']>(
    async (item, mixId) => {
      if (!userId) return false;
      // No early-out on "not in the index": a caller (the mix page) may know
      // about an item before the index has loaded.
      const wasPresent = !!indexRef.current.get(itemKey(item))?.has(mixId);
      patchIndex(item, mixId, false);
      patchMix(mixId, -1);
      const { error } = await removeFromMix(mixId, item);
      if (error) {
        console.error('[mixes] remove failed:', error.message);
        if (wasPresent) patchIndex(item, mixId, true);
        patchMix(mixId, 1);
        return false;
      }
      setVersion((v) => v + 1);
      return true;
    },
    [userId],
  );

  const createMix = useCallback<MixTargetValue['createMix']>(
    async (name, isPublic = false) => {
      if (!userId || name.trim() === '') return null;
      const { data, error } = await createMixRow(userId, name, isPublic);
      if (error || !data) {
        console.error('[mixes] create failed:', error?.message);
        return null;
      }
      setMixes((prev) => [...(prev ?? []), data]);
      return data;
    },
    [userId],
  );

  const saveAndShow = useCallback<MixTargetValue['saveAndShow']>(
    (item, anchor, meta) => {
      if (!requireAuth()) return;
      const from = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
      const current = Array.from(indexRef.current.get(itemKey(item)) ?? []);
      if (current.length > 0) {
        // D3: a filled bookmark opens the membership dropdown, never unsaves.
        const tgt = resolveTarget(mixesRef.current);
        const about = tgt && current.includes(tgt.id) ? tgt.id : current[0];
        setPopover({ item, meta, anchor, mixId: about, view: 'saved', error: false });
        return;
      }
      void (async () => {
        const list = mixesRef.current ?? (await loadRef.current) ?? null;
        const tgt = resolveTarget(list);
        if (!tgt) {
          // No mixes at all (the default-mix trigger should prevent this) —
          // go straight to the list, where "+ New mix" lives.
          setPopover({ item, meta, anchor, mixId: null, view: 'change', error: false });
          return;
        }
        setPopover({ item, meta, anchor, mixId: tgt.id, view: 'saved', error: false });
        const ok = await add(item, { mixId: tgt.id, meta, from });
        if (!ok) setPopover((p) => (p && itemKey(p.item) === itemKey(item) ? { ...p, error: true } : p));
      })();
    },
    [requireAuth, resolveTarget, add],
  );

  const openChange = useCallback<MixTargetValue['openChange']>(
    (item, anchor, meta) => {
      if (!requireAuth()) return;
      const current = Array.from(indexRef.current.get(itemKey(item)) ?? []);
      setPopover({ item, meta, anchor, mixId: current[0] ?? null, view: 'change', error: false });
    },
    [requireAuth],
  );

  const value: MixTargetValue = {
    mixes: userId ? mixes : null,
    target: userId ? target : null,
    setTarget,
    dockMixId,
    setDockMixId,
    membership,
    isSaved,
    add,
    remove,
    createMix,
    saveAndShow,
    openChange,
    lastAdded,
    version,
    refresh,
  };

  return (
    <MixTargetContext.Provider value={value}>
      {children}
      {popover && (
        <SavedToMixPopover
          key={`${itemKey(popover.item)}:${popover.view}:${popover.mixId}`}
          state={popover}
          onChangeView={(view) => setPopover((p) => (p ? { ...p, view } : p))}
          onClose={() => setPopover(null)}
        />
      )}
    </MixTargetContext.Provider>
  );
}

export function useMixTarget() {
  return useContext(MixTargetContext);
}

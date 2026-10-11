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
  defaultMixName as nextDefaultMixName,
  getMixSummary,
  itemKey,
  listMyMixes,
  loadMembershipIndex,
  removeFromMix,
  type MixItemMeta,
  type MixItemRef,
  type MixKind,
  type MixSummary,
} from '../../lib/sj/mixes';

/**
 * App-wide "add to mix" state (P1 of WEB_CHANGE_PROMPTS_2).
 *
 * - **Target (D1), one per kind** — Mixes are typed (album or song, migration
 *   20261011000000), so an album and a song each save to a Mix of their own
 *   kind: the dock mix (when the Mix Dock is open and of that kind) → the last
 *   mix of that kind the user saved to (localStorage, per user and kind) →
 *   for albums the default "Listen Later" mix, for songs the first song Mix.
 *   With no song Mix yet, saving a song opens the list to create one.
 * - **Membership (D3):** one in-memory index of every item the user has saved,
 *   so each bookmark knows its filled state without a query per cover. A
 *   filled bookmark pressed again unsaves (see `saveAndShow`).
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
  /** Where a one-tap save of this kind of item goes; null if no Mix of that kind exists. */
  targetFor: (kind: MixKind) => MixSummary | null;
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
  /** `coverUrl`, when known, drops that cover from the mix's thumbnails right away. */
  remove: (item: MixItemRef, mixId: string, meta?: MixItemMeta) => Promise<boolean>;
  /** A blank name gets `defaultMixName`. The kind is fixed for the Mix's life. */
  createMix: (name: string, kind: MixKind, isPublic?: boolean) => Promise<MixSummary | null>;
  /** What a mix created with a blank name will be called ("New Mix", "New Mix 2"…). */
  defaultMixName: string;
  /**
   * The bookmark press: unsaved → save to target and show the dropdown;
   * saved → a second press unsaves it (from the target mix, or its only mix;
   * if it sits in several and the target isn't one, the mix list opens so
   * the user picks). Signed-out users get the auth prompt.
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
  targetFor: () => null,
  setTarget: () => {},
  dockMixId: null,
  setDockMixId: () => {},
  membership: () => [],
  isSaved: () => false,
  add: noop,
  remove: noop,
  createMix: async () => null,
  defaultMixName: '',
  saveAndShow: () => {},
  openChange: () => {},
  lastAdded: null,
  version: 0,
  refresh: async () => {},
});

// The album key is the pre-2026-10-11 single key, so existing targets carry over.
const storageKey = (userId: string, kind: MixKind) =>
  kind === 'album' ? `sj-mix-target:${userId}` : `sj-mix-target:${userId}:song`;

type StoredTargets = Record<MixKind, string | null>;

function readStoredTargets(userId: string): StoredTargets {
  const read = (kind: MixKind) => {
    try {
      return localStorage.getItem(storageKey(userId, kind));
    } catch {
      return null;
    }
  };
  return { album: read('album'), song: read('song') };
}

function writeStoredTarget(userId: string, kind: MixKind, mixId: string) {
  try {
    localStorage.setItem(storageKey(userId, kind), mixId);
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
  const { t } = useLanguage();
  const [mixes, setMixes] = useState<MixSummary[] | null>(null);
  const [index, setIndex] = useState<Map<string, Set<string>>>(new Map());
  const [storedTargets, setStoredTargets] = useState<StoredTargets>({ album: null, song: null });
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
    setStoredTargets(readStoredTargets(userId));
    loadRef.current = load();
  }, [userId, load]);

  const refresh = useCallback(async () => {
    loadRef.current = load();
    await loadRef.current;
    setVersion((v) => v + 1);
  }, [load]);

  const resolveTarget = useCallback(
    (list: MixSummary[] | null, kind: MixKind): MixSummary | null => {
      const ofKind = (list ?? []).filter((m) => m.kind === kind);
      if (ofKind.length === 0) return null;
      const stored = storedTargets[kind];
      return (
        (dockMixId ? ofKind.find((m) => m.id === dockMixId) : undefined) ??
        (stored ? ofKind.find((m) => m.id === stored) : undefined) ??
        ofKind.find((m) => m.is_default) ??
        ofKind[0]
      );
    },
    [dockMixId, storedTargets],
  );

  const targetFor = useCallback((kind: MixKind) => resolveTarget(mixes, kind), [resolveTarget, mixes]);

  const remember = useCallback(
    (mixId: string, kind: MixKind) => {
      if (!userId) return;
      setStoredTargets((prev) => ({ ...prev, [kind]: mixId }));
      writeStoredTarget(userId, kind, mixId);
    },
    [userId],
  );

  const setTarget = useCallback(
    (mixId: string) => {
      const mix = mixesRef.current?.find((m) => m.id === mixId);
      if (!mix) return;
      remember(mixId, mix.kind);
      // While the dock is open it *is* the target — keep the two in step.
      setDockMixId((cur) => (cur ? mixId : cur));
    },
    [remember],
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
        ? prev.map((m) => {
            if (m.id !== mixId) return m;
            const itemCount = Math.max(0, m.itemCount + delta);
            let covers = m.covers;
            if (itemCount === 0) covers = [];
            else if (delta > 0 && coverUrl)
              covers = [coverUrl, ...m.covers.filter((c) => c !== coverUrl)].slice(0, 4);
            else if (delta < 0 && coverUrl) covers = m.covers.filter((c) => c !== coverUrl);
            return { ...m, itemCount, covers };
          })
        : prev,
    );
  }

  // The optimistic patch is a guess (a removed album may share its cover with
  // a song still in the mix, and the next-newest cover isn't known), so each
  // change re-reads the mix's real count + covers. Per-mix sequence numbers
  // drop a slow response that a newer change has already superseded.
  const syncSeq = useRef(new Map<string, number>());
  const syncMix = useCallback(async (mixId: string) => {
    const seq = (syncSeq.current.get(mixId) ?? 0) + 1;
    syncSeq.current.set(mixId, seq);
    const { data, error } = await getMixSummary(mixId);
    if (syncSeq.current.get(mixId) !== seq) return;
    if (error || !data) {
      if (error) console.error('[mixes] failed to re-sync mix:', error.message);
      return;
    }
    setMixes((prev) => (prev ? prev.map((m) => (m.id === mixId ? data : m)) : prev));
  }, []);

  const add = useCallback<MixTargetValue['add']>(
    async (item, opts = {}) => {
      if (!userId) return false;
      const list = mixesRef.current ?? (await loadRef.current) ?? null;
      const mixId = opts.mixId ?? resolveTarget(list, item.kind)?.id;
      if (!mixId) return false;
      // A Mix holds one kind; the DB would reject this anyway.
      const mix = list?.find((m) => m.id === mixId);
      if (mix && mix.kind !== item.kind) return false;
      if (indexRef.current.get(itemKey(item))?.has(mixId)) return true;
      patchIndex(item, mixId, true);
      patchMix(mixId, 1, opts.meta?.coverUrl);
      if (opts.remember !== false) remember(mixId, item.kind);
      seqRef.current += 1;
      setLastAdded({ seq: seqRef.current, item, meta: opts.meta, mixId, from: opts.from ?? null });
      const { error } = await addToMix(mixId, item);
      if (error) {
        console.error('[mixes] add failed:', error.message);
        patchIndex(item, mixId, false);
        patchMix(mixId, -1);
        void syncMix(mixId);
        return false;
      }
      setVersion((v) => v + 1);
      void syncMix(mixId);
      return true;
    },
    [userId, resolveTarget, syncMix, remember],
  );

  const remove = useCallback<MixTargetValue['remove']>(
    async (item, mixId, meta) => {
      if (!userId) return false;
      // No early-out on "not in the index": a caller (the mix page) may know
      // about an item before the index has loaded.
      const wasPresent = !!indexRef.current.get(itemKey(item))?.has(mixId);
      patchIndex(item, mixId, false);
      patchMix(mixId, -1, meta?.coverUrl);
      const { error } = await removeFromMix(mixId, item);
      if (error) {
        console.error('[mixes] remove failed:', error.message);
        if (wasPresent) patchIndex(item, mixId, true);
        patchMix(mixId, 1);
        void syncMix(mixId);
        return false;
      }
      setVersion((v) => v + 1);
      void syncMix(mixId);
      return true;
    },
    [userId, syncMix],
  );

  const defaultMixName = useMemo(
    () => nextDefaultMixName(t('sj.mix.newMix'), (mixes ?? []).map((m) => m.name)),
    [t, mixes],
  );

  const createMix = useCallback<MixTargetValue['createMix']>(
    async (name, kind, isPublic = false) => {
      if (!userId) return null;
      const { data, error } = await createMixRow(userId, name.trim() || defaultMixName, isPublic, kind);
      if (error || !data) {
        console.error('[mixes] create failed:', error?.message);
        return null;
      }
      setMixes((prev) => [...(prev ?? []), data]);
      return data;
    },
    [userId, defaultMixName],
  );

  const saveAndShow = useCallback<MixTargetValue['saveAndShow']>(
    (item, anchor, meta) => {
      if (!requireAuth()) return;
      const from = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
      const current = Array.from(indexRef.current.get(itemKey(item)) ?? []);
      if (current.length > 0) {
        // Press again to unsave (toggle). Unambiguous cases act directly.
        const tgt = resolveTarget(mixesRef.current, item.kind);
        const from =
          tgt && current.includes(tgt.id) ? tgt.id : current.length === 1 ? current[0] : null;
        if (from) {
          setPopover(null);
          void remove(item, from, { coverUrl: meta?.coverUrl });
        } else {
          setPopover({ item, meta, anchor, mixId: current[0], view: 'change', error: false });
        }
        return;
      }
      void (async () => {
        const list = mixesRef.current ?? (await loadRef.current) ?? null;
        const tgt = resolveTarget(list, item.kind);
        if (!tgt) {
          // No Mix of this kind yet (the usual case for a first song save) —
          // go straight to the list, where "+ New mix" creates one of this kind.
          setPopover({ item, meta, anchor, mixId: null, view: 'change', error: false });
          return;
        }
        setPopover({ item, meta, anchor, mixId: tgt.id, view: 'saved', error: false });
        const ok = await add(item, { mixId: tgt.id, meta, from });
        if (!ok) setPopover((p) => (p && itemKey(p.item) === itemKey(item) ? { ...p, error: true } : p));
      })();
    },
    [requireAuth, resolveTarget, add, remove],
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
    targetFor: (kind) => (userId ? targetFor(kind) : null),
    setTarget,
    dockMixId,
    setDockMixId,
    membership,
    isSaved,
    add,
    remove,
    createMix,
    defaultMixName,
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

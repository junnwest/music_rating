'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  PanelRightClose,
  Plus,
  X,
} from 'lucide-react';
import Cover from './Cover';
import MixMosaic from './MixMosaic';
import SongChip from './SongChip';
import AlbumSongPicker from './AlbumSongPicker';
import { useContextMenuFor, openInNewTab } from './ContextMenu';
import { useSession } from './SessionContext';
import { useMixName, useMixTarget } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import { itemKey, type MixItemRef } from '../../lib/sj/mixes';
import { loadMixEntries, mixEntryHref, mixEntryRef, type MixEntry } from '../../lib/sj/mixEntries';

/**
 * P3 — the Mix Dock: a browser-style side panel on the right edge.
 *
 * Closed, it's a slim rail (bookmark + item count). Open,
 * it pushes the page at ≥xl and overlays below that; hidden under md, where the
 * "Saved to…" dropdown is the whole UX. While it's open, the dock's mix *is*
 * the save target (D1), so every bookmark in the app lands here — with a cover
 * flying in from the button that saved it.
 *
 * Open/closed and width are per-user UI state in localStorage.
 */

const RAIL = 48;
const MIN_W = 280;
const MAX_W = 480;
const DEFAULT_W = 320;

/** Where saving makes sense — the dock only appears on these pages. */
const DOCK_PATHS = ['/', '/search', '/album', '/artist', '/song', '/charts', '/mix', '/profile'];

function onDockPage(pathname: string) {
  return DOCK_PATHS.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
}

const prefsKey = (userId: string) => `sj-mix-dock:${userId}`;

function readPrefs(userId: string): { open: boolean; width: number } {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (raw) {
      const p = JSON.parse(raw);
      return {
        open: !!p.open,
        width: Math.min(MAX_W, Math.max(MIN_W, Number(p.width) || DEFAULT_W)),
      };
    }
  } catch {
    /* storage blocked — defaults */
  }
  return { open: false, width: DEFAULT_W };
}

function writePrefs(userId: string, prefs: { open: boolean; width: number }) {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** /album/<id> or /song/<id>?rg=<rg> dropped from a dragged link → a mix item. */
function itemFromUrl(raw: string): MixItemRef | null {
  try {
    const url = new URL(raw.trim().split('\n')[0], window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const album = url.pathname.match(/^\/album\/([0-9a-f-]{36})$/i);
    if (album) return { kind: 'album', releaseGroupId: album[1] };
    const song = url.pathname.match(/^\/song\/([0-9a-f-]{36})$/i);
    const rg = url.searchParams.get('rg');
    if (song && rg) return { kind: 'song', recordingId: song[1], releaseGroupId: rg };
  } catch {
    /* not a URL */
  }
  return null;
}

export default function MixDock() {
  const pathname = usePathname();
  const { userId } = useSession();
  const { t } = useLanguage();
  const mixName = useMixName();
  const { mixes, target, setTarget, setDockMixId, lastAdded, version, add, remove, createMix } =
    useMixTarget();
  const isMd = useMedia('(min-width: 768px)');
  const isXl = useMedia('(min-width: 1280px)');
  const [prefs, setPrefs] = useState({ open: false, width: DEFAULT_W });
  const [loadedPrefsFor, setLoadedPrefsFor] = useState<string | null>(null);

  const available = !!userId && isMd && onDockPage(pathname);
  const open = available && prefs.open;

  useEffect(() => {
    if (!userId) return;
    setPrefs(readPrefs(userId));
    setLoadedPrefsFor(userId);
  }, [userId]);

  const updatePrefs = useCallback(
    (patch: Partial<{ open: boolean; width: number }>) => {
      setPrefs((p) => {
        const next = { ...p, ...patch };
        if (userId) writePrefs(userId, next);
        return next;
      });
    },
    [userId],
  );

  // D1: while the dock is open, its mix is the target. Opening adopts the
  // current target; closing hands control back to "last used".
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (open && targetId) setDockMixId(targetId);
    if (!open) setDockMixId(null);
  }, [open, targetId, setDockMixId]);

  // Alt+M toggles the dock (by key code, so macOS's Option+M → "µ" still works).
  useEffect(() => {
    if (!available) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyM') return;
      e.preventDefault();
      updatePrefs({ open: !prefs.open });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, prefs.open, updatePrefs]);

  // ── Items ────────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<MixEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || !targetId) return;
    let cancelled = false;
    loadMixEntries(targetId).then((rows) => {
      if (cancelled) return;
      if (rows) {
        setEntries(rows);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, targetId, version]);
  // A different mix shouldn't flash the previous one's rows (or its error).
  useEffect(() => {
    setEntries(null);
    setFailed(false);
  }, [targetId]);

  // ── Add animation ────────────────────────────────────────────────────────
  const railBtnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pulse, setPulse] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const seenSeq = useRef(0);
  useEffect(() => {
    if (!lastAdded || lastAdded.seq === seenSeq.current) return;
    seenSeq.current = lastAdded.seq;
    if (!available || lastAdded.mixId !== targetId) return;
    setPulse((n) => n + 1);
    const key = itemKey(lastAdded.item);
    setHighlight(key);
    const clear = setTimeout(() => setHighlight((h) => (h === key ? null : h)), 1800);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = lastAdded.from;
    const dest = open ? listRef.current : railBtnRef.current;
    if (reduced || !from || !dest) return () => clearTimeout(clear);
    const to = dest.getBoundingClientRect();
    const size = 44;
    const fly = document.createElement('div');
    fly.setAttribute('aria-hidden', 'true');
    Object.assign(fly.style, {
      position: 'fixed',
      zIndex: '140',
      left: `${from.left + from.width / 2 - size / 2}px`,
      top: `${from.top + from.height / 2 - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '8px',
      pointerEvents: 'none',
      boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      background: 'var(--sj-accent, #888) center/cover no-repeat',
    } as Partial<CSSStyleDeclaration>);
    if (lastAdded.meta?.coverUrl) fly.style.backgroundImage = `url("${lastAdded.meta.coverUrl}")`;
    document.body.appendChild(fly);
    const destX = open ? to.left + 16 : to.left + to.width / 2 - size / 2;
    const destY = open ? to.top + 8 : to.top + to.height / 2 - size / 2;
    const dx = destX - parseFloat(fly.style.left);
    const dy = destY - parseFloat(fly.style.top);
    const anim = fly.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 60}px) scale(0.85)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.2 },
      ],
      { duration: 620, easing: 'cubic-bezier(.3,.7,.4,1)' },
    );
    anim.onfinish = () => fly.remove();
    // Backstop: a throttled/background tab can skip `finish`, which would strand
    // the thumbnail on screen.
    const backstop = setTimeout(() => fly.remove(), 1000);
    return () => {
      clearTimeout(clear);
      clearTimeout(backstop);
      fly.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAdded]);

  // ── Drop a dragged album/song link onto the dock ─────────────────────────
  const [dropping, setDropping] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/uri-list')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    const item = itemFromUrl(e.dataTransfer.getData('text/uri-list'));
    if (!item || !targetId) return;
    e.preventDefault();
    void add(item, { mixId: targetId, from: new DOMRect(e.clientX - 22, e.clientY - 22, 44, 44) });
  };

  // ── Resize ───────────────────────────────────────────────────────────────
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = liveWidth ?? prefs.width;
  const endResize = () => {
    resizeRef.current = null;
    if (liveWidth != null) updatePrefs({ width: liveWidth });
    setLiveWidth(null);
  };

  if (!available || loadedPrefsFor !== userId) return null;

  const count = target?.itemCount ?? 0;

  return (
    <aside
      aria-label={t('sj.dock.title')}
      className="hidden md:block sticky top-0 h-screen shrink-0 z-30 transition-[width] duration-200 ease-out"
      style={{ width: open && isXl ? width : RAIL }}
    >
      {/* Rail — always there; the open panel covers it. Clipped: the rail sits
          on the viewport's right edge, and the count badge's save pulse
          (scale 1.45) otherwise pokes past it, briefly overflowing the page
          horizontally and jolting the whole layout sideways mid-animation. */}
      <div className="absolute inset-y-0 right-0 flex flex-col items-center gap-2 pt-4 border-l border-divider bg-page overflow-hidden" style={{ width: RAIL }}>
        <button
          ref={railBtnRef}
          type="button"
          onClick={() => updatePrefs({ open: true })}
          aria-label={`${t('sj.dock.open')} (Alt+M)`}
          className="relative grid place-items-center w-9 h-9 rounded-xl text-mid hover:text-ink hover:bg-surface transition"
        >
          <Bookmark size={18} className={count > 0 ? 'fill-current text-accent' : ''} />
          {count > 0 && (
            <span
              key={pulse}
              className={`absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-white text-[10px] font-bold leading-[17px] text-center tabular-nums ${
                pulse > 0 ? 'sj-badge-pulse' : ''
              }`}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          className={`absolute inset-y-0 right-0 z-10 flex flex-col bg-page border-l border-divider ${
            isXl ? '' : 'shadow-2xl'
          }`}
          style={{ width }}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={onDrop}
        >
          {/* Resize handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sj.dock.resize')}
            className="absolute inset-y-0 -left-1 w-2 cursor-col-resize z-10 hover:bg-accent/20 active:bg-accent/30 transition"
            onPointerDown={(e) => {
              resizeRef.current = { startX: e.clientX, startW: width };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const r = resizeRef.current;
              if (!r) return;
              setLiveWidth(Math.min(MAX_W, Math.max(MIN_W, r.startW + (r.startX - e.clientX))));
            }}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />

          <DockHeader
            onClose={() => updatePrefs({ open: false })}
            onPick={setTarget}
            onCreate={async (name) => {
              const mix = await createMix(name);
              if (mix) setTarget(mix.id);
              return !!mix;
            }}
          />

          <div ref={listRef} className="relative flex-1 overflow-y-auto">
            {failed ? (
              <p className="px-4 py-6 text-[12.5px] text-muted">{t('sj.common.loadError')}</p>
            ) : entries === null || mixes === null ? (
              <div className="px-3 py-2 space-y-2" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="w-10 h-10 rounded-md bg-surface animate-pulse" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-2.5 w-3/4 rounded bg-surface animate-pulse" />
                      <span className="block h-2 w-1/2 rounded bg-surface animate-pulse" />
                    </span>
                  </div>
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bookmark size={28} className="mx-auto text-divider" />
                <p className="mt-3 text-[13px] font-semibold text-ink">{t('sj.mix.empty')}</p>
                <p className="mt-1 text-[12px] text-muted">{t('sj.dock.emptyDesc')}</p>
              </div>
            ) : (
              <DockList
                entries={entries}
                mixId={targetId!}
                highlight={highlight}
                onRemove={async (entry) => {
                  const before = entries;
                  setEntries((prev) => prev?.filter((x) => x.id !== entry.id) ?? prev);
                  const ok = await remove(mixEntryRef(entry), targetId!, { coverUrl: entry.coverUrl });
                  // Put the row back if the delete didn't land.
                  if (!ok) setEntries(before);
                }}
              />
            )}
            {dropping && (
              <div className="absolute inset-2 rounded-xl border-2 border-dashed border-accent bg-accent/10 grid place-items-center text-[13px] font-semibold text-accent pointer-events-none">
                {t('sj.dock.dropHere').replace('{mix}', mixName(target))}
              </div>
            )}
          </div>
          <p className="px-4 py-2 border-t border-divider text-[11px] text-muted">
            {t('sj.dock.hint')}
          </p>
        </div>
      )}
    </aside>
  );
}

// ── Header: mix switcher ────────────────────────────────────────────────────

function DockHeader({
  onClose,
  onPick,
  onCreate,
}: {
  onClose: () => void;
  onPick: (mixId: string) => void;
  /** Resolves false when the mix couldn't be created (the form stays open). */
  onCreate: (name: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const mixName = useMixName();
  const { mixes, target, defaultMixName } = useMixTarget();
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Closing the switcher abandons a half-typed new mix.
  useEffect(() => {
    if (switching) return;
    setCreating(false);
    setName('');
  }, [switching]);

  useEffect(() => {
    if (!switching) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setSwitching(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSwitching(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [switching]);

  return (
    <div ref={rootRef} className="relative px-3 pt-3 pb-2 border-b border-divider">
      <p className="px-1 mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase text-muted">
        {t('sj.dock.savingTo')}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSwitching((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={switching}
          className="flex-1 min-w-0 flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-surface transition text-left"
        >
          <MixMosaic covers={target?.covers ?? []} isDefault={target?.is_default} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-ink truncate">{mixName(target)}</span>
            <span className="block text-[11.5px] text-muted">
              {(target?.itemCount ?? 0) === 1
                ? t('sj.mix.oneItem')
                : t('sj.mix.nItems').replace('{n}', String(target?.itemCount ?? 0))}
            </span>
          </span>
          <ChevronDown size={15} className={`text-muted transition ${switching ? 'rotate-180' : ''}`} />
        </button>
        {target && (
          <Link
            href={`/mix/${target.id}`}
            aria-label={t('sj.dock.openMixPage')}
            className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
          >
            <ArrowUpRight size={16} />
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`${t('sj.dock.close')} (Alt+M)`}
          className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {switching && (
        <div className="absolute left-3 right-3 top-full mt-1 z-20 rounded-xl bg-surface border border-divider shadow-xl py-1 sj-pop-in">
          <ul role="listbox" className="max-h-[50vh] overflow-y-auto">
            {(mixes ?? []).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === target?.id}
                  onClick={() => {
                    onPick(m.id);
                    setSwitching(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-page transition text-left"
                >
                  <MixMosaic covers={m.covers} isDefault={m.is_default} className="w-8 h-8" rounded="rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink truncate">{mixName(m)}</span>
                    <span className="block text-[11px] text-muted">
                      {m.itemCount === 1
                        ? t('sj.mix.oneItem')
                        : t('sj.mix.nItems').replace('{n}', String(m.itemCount))}
                    </span>
                  </span>
                  {m.id === target?.id && <Check size={15} className="text-accent shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-divider mt-1 pt-1 px-1.5">
            {creating ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (busy) return;
                  // A blank name is fine — the mix gets defaultMixName.
                  setBusy(true);
                  const ok = await onCreate(name);
                  setBusy(false);
                  if (ok) setSwitching(false);
                }}
                className="flex items-center gap-1.5 p-1"
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setCreating(false);
                      setName('');
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
                  className="h-8 px-3 rounded-lg bg-accent text-white text-[12.5px] font-semibold disabled:opacity-50"
                >
                  {t('sj.mix.createBtn')}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-page transition"
              >
                <Plus size={15} className="text-accent" />
                {t('sj.mix.newMix')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Item list ───────────────────────────────────────────────────────────────

function DockList({
  entries,
  mixId,
  highlight,
  onRemove,
}: {
  entries: MixEntry[];
  mixId: string;
  highlight: string | null;
  onRemove: (entry: MixEntry) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { onContextMenu, menu } = useContextMenuFor<MixEntry>((entry) => [
    {
      key: 'open',
      label: entry.kind === 'song' ? t('sj.context.openSong') : t('sj.context.openAlbum'),
      icon: <ChevronRight size={15} />,
      onSelect: () => router.push(mixEntryHref(entry)),
    },
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(mixEntryHref(entry)),
    },
    {
      key: 'remove',
      label: t('sj.context.removeFromMix'),
      icon: <X size={15} />,
      destructive: true,
      onSelect: () => onRemove(entry),
    },
  ]);

  return (
    <ul className="py-1">
      {entries.map((entry) => {
        const key = itemKey(mixEntryRef(entry));
        const isOpen = expanded.has(entry.id);
        return (
          <li key={`${entry.kind}:${entry.id}`}>
            <div
              onContextMenu={(e) => onContextMenu(e, entry)}
              className={`group flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 transition-colors duration-700 ${
                highlight === key ? 'bg-accent/10 sj-row-in' : 'hover:bg-surface'
              }`}
            >
              {entry.kind === 'album' ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                  aria-label={isOpen ? t('sj.dock.hideSongs') : t('sj.dock.showSongs')}
                  className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-page transition shrink-0"
                >
                  <ChevronRight size={14} className={`transition ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              ) : (
                <span className="w-6 shrink-0" />
              )}
              <Link href={mixEntryHref(entry)} className="flex items-center gap-2.5 min-w-0 flex-1">
                <Cover url={entry.coverUrl} className="w-10 h-10" rounded="rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] font-semibold text-ink truncate">{entry.title}</span>
                    {entry.kind === 'song' && <SongChip />}
                  </span>
                  <span className="block text-[11.5px] text-muted truncate">{entry.subtitle}</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => onRemove(entry)}
                aria-label={t('sj.mix.remove')}
                className="grid place-items-center w-7 h-7 rounded-md text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            {entry.kind === 'album' && isOpen && (
              <AlbumSongPicker releaseGroupId={entry.releaseGroupId} coverUrl={entry.coverUrl} mixId={mixId} />
            )}
          </li>
        );
      })}
      {menu}
    </ul>
  );
}

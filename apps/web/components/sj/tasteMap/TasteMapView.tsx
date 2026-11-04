'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Download, Map as MapIcon, Pencil, Pin, PinOff, Scissors, Shuffle, SlidersHorizontal, Square, Upload, UserPlus, X } from 'lucide-react';
import Cover from '../Cover';
import { FlowerSpinner } from '../Loading';
import { useLanguage } from '../../../lib/i18n';
import { formatScore, spectrumColor, spectrumFill, spectrumNumber } from '../../../lib/sj/display';
import type { PlaceResponse, TasteMapExport } from '../../../lib/tasteMap/apiTypes';
import { downloadJson, exportMap, importMap, parseExportFile, saveLayout, savePins } from '../../../lib/tasteMap/client';
import { createRearrange, type Rearrange } from '../../../lib/tasteMap/forceLayout';
import { fromPlane, planeBasis, toPlane } from '../../../lib/tasteMap/plane';
import type { NodeKey, TasteMapPayload, TasteMapPayloadNode, Vec2, Vec3 } from '../../../lib/tasteMap/types';
import AddArtist from './AddArtist';
import EraEditor from './EraEditor';
import GroupEditor from './GroupEditor';
import Map2D from './Map2D';
import MembershipEditor from './MembershipEditor';
import MetricPanel from './MetricPanel';
import { useGroupEdits } from './useGroupEdits';

/**
 * Taste Map viewer shell (TASTE_MAP_PLAN.md Phases 2–3).
 *
 * Renders a `TasteMapPayload` either as a 3D scene (react-three-fiber, loaded
 * lazily so the 2D view never pulls three) or a 2D canvas of the payload's
 * principal plane. Both read the same canonical positions (`pos` / `pos2d`), so
 * switching modes keeps the selection and re-frames it. The inspector ("Why
 * here?") shows the hovered-or-selected node; at phone width it becomes a
 * bottom sheet over the stage for the selected node.
 *
 * Phase 3 editing: drag a node (2D or 3D) to pin it there, unpin from the
 * inspector, "Re-arrange" runs the D4 force solve (lib/tasteMap/forceLayout)
 * animated in the browser, and changes autosave (debounced PUT pins / layout)
 * when `persist` is on. In fixture / mock mode nothing is sent anywhere.
 *
 * Positions: the shell keeps a working copy of the payload's nodes and mutates
 * their `pos` / `pos2d` in place (a drag or a simulation tick touches every
 * frame; rebuilding node objects would make the 3D labels rebuild their
 * textures). Each change bumps `layoutVersion` and hands the scenes a new
 * shallow payload object, so anything memoized on `payload` recomputes while
 * memos on `payload.nodes` (label textures, the 2D view frame) stay put.
 * 2D and 3D share one layout (D5): `pos2d` is always `pos` projected onto the
 * plane basis computed once when the payload loads, kept fixed for the session.
 *
 * Phase 4 (each piece in its own file, wired here): group CRUD + per-node
 * membership sliders (useGroupEdits, GroupEditor, MembershipEditor), era
 * split/merge (EraEditor), "Your map weights" (MetricPanel) and the Add-artist
 * ghost (AddArtist + a small ghost layer in each scene). The side panel (aside
 * on desktop, bottom sheet on phones) shows one of those panels or the
 * inspector. `api` gates server calls: group edits stay in memory without it;
 * eras / weights / placement say "Sign in to use".
 *
 * Copy is inline en/ko (the dictionaries aren't part of this dev-only shell
 * yet); move it to lib/i18n when the route ships.
 */

const Scene3D = dynamic(() => import('./Scene3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <FlowerSpinner />
    </div>
  ),
});

export type MapMode = '3d' | '2d';

/** Canvas-side theme colors, read from the app's CSS variables. */
export interface MapTheme {
  dark: boolean;
  bg: string;
  ink: string;
  muted: string;
  divider: string;
  font: string;
}

/** Pin state per node. `softZ`: pinned from the 2D view (plane position fixed, depth free, D5). */
export interface PinState {
  softZ: boolean;
}

export type DragPhase = 'start' | 'move' | 'end';

/** An Add-artist preview: never stored, drawn translucent with lines to its anchors. */
export interface SceneGhost {
  key: NodeKey;
  label: string;
  /** Short localized tag drawn with it ("preview"). */
  tag: string;
  pos: Vec3;
  /** `pos` on the session's fixed plane basis (D5), like every node's pos2d. */
  pos2d: Vec2;
  anchors: NodeKey[];
}

/** What both scenes receive — positions come from the payload, state from the shell. */
export interface SceneProps {
  /** The working layout; node `pos` / `pos2d` change in place, see `layoutVersion`. */
  payload: TasteMapPayload;
  /** Bumped whenever node positions change (drag, re-arrange, import). */
  layoutVersion: number;
  pins: Map<NodeKey, PinState>;
  /** Dragging allowed (off while a re-arrange runs). */
  editable: boolean;
  /** A drag or a re-arrange is in progress: skip expensive per-layout work until it settles. */
  busy: boolean;
  /** 2D drags report `pos2d` (plane coords), 3D drags report `pos` (world). */
  onDragNode: (key: NodeKey, phase: DragPhase, at: { pos?: Vec3; pos2d?: Vec2 }) => void;
  /** Keys not hidden by the group toggles. */
  visible: Set<NodeKey>;
  hiddenGroups: Set<string>;
  selectedKey: NodeKey | null;
  hoveredKey: NodeKey | null;
  /** Bumped whenever the shell wants the scene to frame a node (mode switch, inspector click). */
  focus: { key: NodeKey; nonce: number } | null;
  onHover: (key: NodeKey | null) => void;
  onSelect: (key: NodeKey | null) => void;
  theme: MapTheme;
  ghost: SceneGhost | null;
}

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v.split(/\s+/).join(', ')})` : '#888';
}

function readTheme(): MapTheme {
  const dark = document.documentElement.classList.contains('dark');
  return {
    dark,
    bg: cssVar('--color-surface'),
    ink: cssVar('--color-ink'),
    muted: cssVar('--color-muted'),
    divider: cssVar('--color-divider'),
    font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
  };
}

/** Below Tailwind's `md`: the side panel is a bottom sheet. Panels mount in one place only (they fetch on mount). */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767.98px)');
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** Follows the `.dark` class on <html> (the app's theme switch). */
function useMapTheme(): MapTheme | null {
  const [theme, setTheme] = useState<MapTheme | null>(null);
  useEffect(() => {
    setTheme(readTheme());
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

const COPY = {
  en: {
    title: 'Taste map',
    sub: 'Dev preview',
    rearrange: 'Re-arrange',
    stop: 'Stop',
    export: 'Export',
    import: 'Import',
    pin: 'Pin here',
    unpin: 'Unpin',
    pinned: 'Pinned',
    pinned2d: 'Pinned in 2D (depth free)',
    saved: 'Saved',
    saving: 'Saving…',
    notSaved: 'Not saved',
    localOnly: 'Local only (fixture)',
    importTitle: 'Replace your map with this file?',
    importBody: 'Your pins, groups, era splits, weights and saved layout are replaced by the file’s.',
    importLocal: 'Fixture mode: only pins and layout are applied, locally.',
    importConfirm: 'Replace',
    cancel: 'Cancel',
    importBad: 'Can’t import this file',
    imported: 'Imported',
    exportFailed: 'Export failed',
    importFailed: 'Import failed',
    pinsWord: 'pins',
    groupsWord: 'groups',
    groups: 'Groups',
    whyHere: 'Why here?',
    nearest: 'Nearest on your map',
    avg: 'avg',
    weight: 'weight',
    albums: 'albums',
    otherEras: 'Other eras',
    hint: 'Hover or tap a node to see why it sits where it does. Drag a node to pin it somewhere else, drag the background to move around, scroll or pinch to zoom.',
    biggest: 'Biggest on your map',
    unrated: 'unrated',
    score: 'avg score',
    close: 'Close',
    editGroups: 'Edit groups',
    addArtist: 'Add artist',
    weights: 'Map weights',
    eras: 'Eras',
    erasEdit: 'Split or merge eras',
    preview: 'preview',
  },
  ko: {
    title: '취향 지도',
    sub: '개발 미리보기',
    rearrange: '다시 배치',
    stop: '멈추기',
    export: '내보내기',
    import: '가져오기',
    pin: '여기에 고정',
    unpin: '고정 해제',
    pinned: '고정됨',
    pinned2d: '2D에서 고정됨 (깊이는 자유)',
    saved: '저장됨',
    saving: '저장 중…',
    notSaved: '저장 안 됨',
    localOnly: '로컬 전용 (픽스처)',
    importTitle: '이 파일로 지도를 바꿀까요?',
    importBody: '고정, 그룹, 시기 나누기, 가중치, 저장된 배치가 파일의 내용으로 바뀌어요.',
    importLocal: '픽스처 모드: 고정과 배치만 이 화면에 적용돼요.',
    importConfirm: '바꾸기',
    cancel: '취소',
    importBad: '이 파일은 가져올 수 없어요',
    imported: '가져왔어요',
    exportFailed: '내보내기 실패',
    importFailed: '가져오기 실패',
    pinsWord: '고정',
    groupsWord: '그룹',
    groups: '그룹',
    whyHere: '왜 여기에?',
    nearest: '지도에서 가까운 아티스트',
    avg: '평균',
    weight: '비중',
    albums: '앨범',
    otherEras: '다른 시기',
    hint: '노드에 마우스를 올리거나 탭하면 그 자리에 있는 이유가 보여요. 노드를 드래그하면 그 자리에 고정되고, 배경을 드래그하면 이동, 스크롤이나 핀치로 확대할 수 있어요.',
    biggest: '지도에서 큰 비중',
    unrated: '평가 없음',
    score: '평균 점수',
    close: '닫기',
    editGroups: '그룹 편집',
    addArtist: '아티스트 추가',
    weights: '지도 가중치',
    eras: '시기',
    erasEdit: '시기 나누기 · 합치기',
    preview: '미리보기',
  },
} as const;
type Copy = { [K in keyof (typeof COPY)['en']]: string };

/** Collision radius in map units: the 3D sphere radius (Scene3D radiusOf) over its SCALE of 10. */
const sizeOf = (mass: number) => (0.12 + 0.07 * Math.sqrt(Math.max(mass, 0))) / 10;

/**
 * Anchor pull toward the current layout, decaying as the user corrects more
 * (D4): with no pins the solve mostly tidies (0.1, the forceLayout default);
 * each pin says the computed layout was wrong somewhere, so links, groups and
 * pins get more say. ~0.065 at 6 pins, ~0.04 at 16, floor 0.03.
 */
const anchorFor = (pinCount: number) => 0.03 + 0.07 * Math.exp(-pinCount / 8);

const AUTOSAVE_MS = 1500;
/** Saved coordinates are rounded to keep the PUT small (1e-6 of a ±1 layout). */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

type SaveState =
  | { kind: 'local' }
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; reason: string };

type ImportPending = { file: string; data: TasteMapExport };

type Panel = { kind: 'eras'; artistId: string; label: string } | { kind: 'metric' } | { kind: 'add' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TasteMapView({
  payload,
  persist = false,
  api = persist,
  onReload,
}: {
  payload: TasteMapPayload;
  /** Autosave + server export/import. Off for `?fixture=` / `?mock=1` (no session): everything stays local. */
  persist?: boolean;
  /** Phase 4 server calls (groups, eras, weights, placement). Defaults to `persist`; dev `?api=1` turns it on in fixture mode. */
  api?: boolean;
  /** Re-fetch the payload (after an import or an era change); `refresh` asks the server to re-solve. */
  onReload?: (opts?: { refresh?: boolean }) => void;
}) {
  const { lang } = useLanguage();
  const c: Copy = COPY[lang === 'ko' ? 'ko' : 'en'];
  const theme = useMapTheme();

  const [mode, setMode] = useState<MapMode>('3d');
  const [selectedKey, setSelectedKey] = useState<NodeKey | null>(null);
  const [hoveredKey, setHoveredKey] = useState<NodeKey | null>(null);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<{ key: NodeKey; nonce: number } | null>(null);

  // ── Working layout (see the file comment) ──
  const work = useMemo(
    () => payload.nodes.map((n) => ({ ...n, pos: [...n.pos] as Vec3, pos2d: [...n.pos2d] as Vec2 })),
    [payload.nodes],
  );
  // The D5 frame, fixed for the session so the 2D view doesn't shift under a drag.
  const basis = useMemo(
    () => planeBasis(Object.fromEntries(payload.nodes.map((n) => [n.key, n.pos]))),
    [payload.nodes],
  );
  const [layoutVersion, setLayoutVersion] = useState(0);
  // `softZ` is only on 2D pins (absent on older payloads and before migration 20261104000000 → full pin).
  const [pins, setPins] = useState<Map<NodeKey, PinState>>(
    () => new Map(payload.nodes.filter((n) => n.pinned).map((n) => [n.key, { softZ: n.softZ === true }])),
  );
  const pinsRef = useRef(pins);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const byKey = useMemo(() => new Map(work.map((n) => [n.key, n])), [work]);

  // Coalesce position changes into one re-render per animation frame.
  const bumpRaf = useRef<number | null>(null);
  const bump = useCallback(() => {
    if (bumpRaf.current != null) return;
    bumpRaf.current = requestAnimationFrame(() => {
      bumpRaf.current = null;
      setLayoutVersion((v) => v + 1);
    });
  }, []);
  useEffect(
    () => () => {
      if (bumpRaf.current != null) cancelAnimationFrame(bumpRaf.current);
    },
    [],
  );

  // ── Groups (Phase 4): memberships live on `work`, see useGroupEdits ──
  const remapHidden = useCallback(
    (map: Record<string, string>) => setHiddenGroups((prev) => new Set([...prev].map((id) => map[id] ?? id))),
    [],
  );
  const edits = useGroupEdits({ initial: payload.groups, nodes: work, api, onChange: bump, onRemap: remapHidden });
  const [editingGroups, setEditingGroups] = useState(false);

  // Groups come from the editor; memberships ride on `work` (a change bumps layoutVersion).
  const live = useMemo<TasteMapPayload>(
    () => ({ ...payload, nodes: work, groups: edits.groups }),
    // A new object per layout change; `work` itself keeps its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, work, layoutVersion, edits.groups],
  );

  const setNode3D = useCallback(
    (n: TasteMapPayloadNode, p: Vec3) => {
      n.pos = p;
      const q = toPlane(p, basis);
      n.pos2d = [q[0], q[1]];
    },
    [basis],
  );
  /** Plane coords → world, keeping the node's own depth along the plane normal. */
  const setNode2D = useCallback(
    (n: TasteMapPayloadNode, xy: Vec2, depth?: number) => {
      const z = depth ?? toPlane(n.pos, basis)[2];
      n.pos2d = xy;
      n.pos = fromPlane([xy[0], xy[1], z], basis);
    },
    [basis],
  );

  const updatePins = useCallback(
    (fn: (prev: Map<NodeKey, PinState>) => Map<NodeKey, PinState>) => {
      const next = fn(pinsRef.current);
      pinsRef.current = next;
      for (const n of work) n.pinned = next.has(n.key);
      setPins(next);
    },
    [work],
  );

  // ── Autosave (debounced PUT pins / layout) ──
  const [save, setSave] = useState<SaveState>(persist ? { kind: 'idle' } : { kind: 'local' });
  const dirty = useRef({ pins: false, layout: false });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  flushRef.current = async () => {
    if (!persist) return;
    if (inFlight.current) {
      // A save is running; go again once it lands.
      saveTimer.current = setTimeout(() => void flushRef.current(), 300);
      return;
    }
    const want = { ...dirty.current };
    if (!want.pins && !want.layout) return;
    dirty.current = { pins: false, layout: false };
    inFlight.current = true;
    if (mounted.current) setSave({ kind: 'saving' });
    try {
      if (want.layout) {
        const positions: Record<NodeKey, Vec3> = {};
        for (const n of work) positions[n.key] = [round6(n.pos[0]), round6(n.pos[1]), round6(n.pos[2])];
        await saveLayout({ positions });
      }
      if (want.pins) {
        const list = [...pinsRef.current.entries()].flatMap(([key, st]) => {
          const n = byKey.get(key);
          if (!n) return [];
          const pos: Vec3 = [round6(n.pos[0]), round6(n.pos[1]), round6(n.pos[2])];
          return [st.softZ ? { key, pos, softZ: true } : { key, pos }];
        });
        await savePins({ pins: list });
      }
      if (mounted.current && !dirty.current.pins && !dirty.current.layout) setSave({ kind: 'saved' });
    } catch (e) {
      // Keep what failed dirty so the next change retries it.
      dirty.current = { pins: dirty.current.pins || want.pins, layout: dirty.current.layout || want.layout };
      if (mounted.current) setSave({ kind: 'error', reason: (e as Error).message || 'error' });
    } finally {
      inFlight.current = false;
    }
  };

  const markDirty = useCallback(
    (what: { pins?: boolean; layout?: boolean }) => {
      if (!persist) return;
      dirty.current = { pins: dirty.current.pins || !!what.pins, layout: dirty.current.layout || !!what.layout };
      setSave({ kind: 'saving' });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    },
    [persist],
  );

  /** Waits out a running save and sends anything pending now (before a call that reads the stored map). */
  const flushNow = useCallback(async () => {
    if (!persist) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    for (let i = 0; i < 60; i++) {
      if (inFlight.current) {
        await sleep(150);
        continue;
      }
      if (!dirty.current.pins && !dirty.current.layout) return;
      await flushRef.current();
      if (!inFlight.current && (dirty.current.pins || dirty.current.layout)) throw new Error('autosave failed');
    }
  }, [persist]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Best effort: don't drop a pending change when the view goes away.
      if (dirty.current.pins || dirty.current.layout) void flushRef.current();
    };
  }, []);

  // A node stays visible while any group it belongs to is shown; group-less nodes always show.
  const visible = useMemo(() => {
    const s = new Set<NodeKey>();
    for (const n of work) {
      const gs = Object.entries(n.groups).filter(([, w]) => w > 0);
      if (gs.length === 0 || gs.some(([g]) => !hiddenGroups.has(g))) s.add(n.key);
    }
    return s;
    // edits.version: memberships on `work` were replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, hiddenGroups, edits.version]);

  // Hiding a group drops a selection that just became invisible.
  useEffect(() => {
    if (selectedKey && !visible.has(selectedKey)) setSelectedKey(null);
    if (hoveredKey && !visible.has(hoveredKey)) setHoveredKey(null);
  }, [visible, selectedKey, hoveredKey]);

  const select = useCallback((key: NodeKey | null) => setSelectedKey(key), []);
  const hover = useCallback((key: NodeKey | null) => setHoveredKey(key), []);
  const selectAndFocus = useCallback((key: NodeKey) => {
    setSelectedKey(key);
    setFocus((f) => ({ key, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);

  // ── Drag → pin ──
  const onDragNode = useCallback<SceneProps['onDragNode']>(
    (key, phase, at) => {
      const n = byKey.get(key);
      if (!n) return;
      if (phase === 'start') {
        setDragging(true);
        setSelectedKey(key);
        return;
      }
      if (at.pos2d) setNode2D(n, at.pos2d);
      else if (at.pos) setNode3D(n, at.pos);
      bump();
      if (phase === 'end') {
        setDragging(false);
        // D5: a 2D drop fixes the plane position only; a 3D drop fixes all three.
        updatePins((prev) => new Map(prev).set(key, { softZ: !!at.pos2d }));
        markDirty({ pins: true, layout: true });
      }
    },
    [byKey, setNode2D, setNode3D, bump, updatePins, markDirty],
  );

  const togglePin = useCallback(
    (key: NodeKey) => {
      updatePins((prev) => {
        const next = new Map(prev);
        if (next.has(key)) next.delete(key);
        else next.set(key, { softZ: mode === '2d' });
        return next;
      });
      markDirty({ pins: true });
    },
    [mode, updatePins, markDirty],
  );

  // ── Re-arrange (D4 force solve, animated) ──
  const simRef = useRef<{ sim: Rearrange; mode: MapMode } | null>(null);
  const pullRaf = useRef<number | null>(null);

  const pullPositions = useCallback(() => {
    const run = simRef.current;
    if (!run) return;
    const p = run.sim.positions();
    for (const n of work) {
      const q = p[n.key];
      if (!q) continue;
      if (run.mode === '3d') setNode3D(n, q);
      else setNode2D(n, [q[0], q[1]], q[2]);
    }
    setLayoutVersion((v) => v + 1);
  }, [work, setNode2D, setNode3D]);

  const finishRearrange = useCallback(() => {
    const run = simRef.current;
    if (!run) return;
    run.sim.on('tick', null).on('end', null).stop();
    if (pullRaf.current != null) cancelAnimationFrame(pullRaf.current);
    pullRaf.current = null;
    pullPositions();
    simRef.current = null;
    setRunning(false);
    markDirty({ layout: true });
  }, [pullPositions, markDirty]);

  const startRearrange = () => {
    if (simRef.current) return;
    const pinNow = pinsRef.current;
    const nodesIn = work.map((n) => {
      const pin = pinNow.get(n.key);
      // 2D: the D5 collision pass over the plane, depth carried through as z.
      const pos: Vec3 = mode === '3d' ? n.pos : [n.pos2d[0], n.pos2d[1], toPlane(n.pos, basis)[2]];
      const pinned: boolean | 'xy' = pin ? (mode === '3d' && pin.softZ ? 'xy' : true) : false;
      return { key: n.key, pos, pinned, size: sizeOf(n.mass) };
    });
    const seen = new Set<string>();
    const links: { a: NodeKey; b: NodeKey; sim: number }[] = [];
    for (const [a, list] of Object.entries(payload.neighbors)) {
      for (const nb of list) {
        const id = a < nb.key ? `${a}|${nb.key}` : `${nb.key}|${a}`;
        if (seen.has(id)) continue;
        seen.add(id);
        links.push({ a, b: nb.key, sim: nb.sim });
      }
    }
    const groups = work.map((n) => ({ key: n.key, weights: n.groups }));
    const sim = createRearrange(nodesIn, links, groups, {
      mode,
      basis: mode === '3d' ? basis : undefined,
      anchorStrength: anchorFor(pinNow.size),
      // 2D: a little air between dots so labels have room (the pass is collision-only).
      collisionPadding: mode === '2d' ? 0.012 : 0.004,
    });
    simRef.current = { sim, mode };
    sim
      .on('tick', () => {
        if (pullRaf.current != null) return;
        pullRaf.current = requestAnimationFrame(() => {
          pullRaf.current = null;
          pullPositions();
        });
      })
      .on('end', finishRearrange);
    setRunning(true);
    sim.start();
  };

  useEffect(
    () => () => {
      simRef.current?.sim.on('tick', null).on('end', null).stop();
      if (pullRaf.current != null) cancelAnimationFrame(pullRaf.current);
    },
    [],
  );

  const switchMode = (m: MapMode) => {
    if (m === mode) return;
    if (simRef.current) finishRearrange();
    setMode(m);
    setHoveredKey(null);
    // The new scene mounts and frames the selection, else an Add-artist ghost, if any.
    const k = selectedKey ?? ghost?.key ?? null;
    setFocus((f) => (k ? { key: k, nonce: (f?.nonce ?? 0) + 1 } : null));
  };

  // ── Export / import ──
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ImportPending | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const buildLocalExport = (): TasteMapExport => {
    const layout: Record<NodeKey, Vec3> = {};
    for (const n of work) layout[n.key] = [round6(n.pos[0]), round6(n.pos[1]), round6(n.pos[2])];
    return {
      kind: 'sillajuku.tasteMap',
      version: 1,
      exportedAt: new Date().toISOString(),
      // payload.ts LENS; not imported here (server module).
      lens: 'sound',
      pins: [...pins.entries()].map(([key, st]) => ({ key, pos: layout[key], ...(st.softZ ? { softZ: true } : {}) })),
      groups: edits.groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        seedWorld: g.seedWorld,
        members: work
          .filter((n) => (n.groups[g.id] ?? 0) > 0)
          .map((n) => ({ key: n.key, weight: n.groups[g.id], manual: false })),
      })),
      eras: [],
      metric: null,
      layout,
    };
  };

  const doExport = async () => {
    setNotice(null);
    try {
      const data = persist ? await exportMap() : buildLocalExport();
      downloadJson(`taste-map-${today()}.json`, data);
    } catch (e) {
      setNotice(`${c.exportFailed}: ${(e as Error).message}`);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    const parsed = parseExportFile(await file.text());
    if (!parsed.ok) {
      setNotice(`${c.importBad}: ${parsed.reason}`);
      return;
    }
    setPendingImport({ file: file.name, data: parsed.data });
  };

  const confirmImport = async () => {
    const pend = pendingImport;
    if (!pend) return;
    if (simRef.current) finishRearrange();
    if (!persist) {
      // Fixture mode: apply what a payload can show (layout + pins), locally.
      const d = pend.data;
      if (d.layout) for (const n of work) if (d.layout[n.key]) setNode3D(n, d.layout[n.key]);
      updatePins(() => new Map(d.pins.filter((p) => byKey.has(p.key)).map((p) => [p.key, { softZ: !!p.softZ }])));
      setLayoutVersion((v) => v + 1);
      setPendingImport(null);
      setNotice(`${c.imported}: ${d.pins.length} ${c.pinsWord}`);
      return;
    }
    setImporting(true);
    try {
      // A pending autosave would race the import; drop it, the import replaces it all.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirty.current = { pins: false, layout: false };
      const res = await importMap(pend.data);
      setPendingImport(null);
      setNotice(`${c.imported}: ${res.counts.pins} ${c.pinsWord}, ${res.counts.groups} ${c.groupsWord}`);
      onReload?.();
    } catch (err) {
      setNotice(`${c.importFailed}: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // ── Phase 4 side panels: eras, map weights, Add-artist ghost ──
  const [panel, setPanel] = useState<Panel | null>(null);
  const isPhone = useIsPhone();
  const [ghost, setGhost] = useState<PlaceResponse | null>(null);
  const closePanel = useCallback(() => {
    setPanel(null);
    setGhost(null);
  }, []);
  const openPanel = (p: Panel) => {
    if (p.kind !== 'add') setGhost(null);
    setPanel(p);
  };
  const onGhost = useCallback((g: PlaceResponse | null) => {
    setGhost(g);
    if (g) setFocus((f) => ({ key: g.key, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);
  const sceneGhost = useMemo<SceneGhost | null>(() => {
    if (!ghost) return null;
    const q = toPlane(ghost.pos, basis);
    return { key: ghost.key, label: ghost.label, tag: c.preview, pos: ghost.pos, pos2d: [q[0], q[1]], anchors: ghost.anchors.map((a) => a.key) };
  }, [ghost, basis, c.preview]);

  const workPositions = (): Record<NodeKey, Vec3> => {
    const positions: Record<NodeKey, Vec3> = {};
    for (const n of work) positions[n.key] = [round6(n.pos[0]), round6(n.pos[1]), round6(n.pos[2])];
    return positions;
  };
  const metricPositions = async () => {
    if (simRef.current) finishRearrange();
    await flushNow();
    return workPositions();
  };
  const afterEraSave = async () => {
    // Node keys change: save pending pins first, then load the re-solved map.
    await flushNow().catch(() => {});
    onReload?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleGroup = (id: string) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inspected = (hoveredKey && byKey.get(hoveredKey)) || (selectedKey && byKey.get(selectedKey)) || null;
  const selectedNode = selectedKey ? byKey.get(selectedKey) ?? null : null;

  const sceneProps: SceneProps | null = theme
    ? {
        payload: live,
        layoutVersion,
        pins,
        editable: !running && !importing,
        busy: running || dragging,
        onDragNode,
        visible,
        hiddenGroups,
        selectedKey,
        hoveredKey,
        focus,
        onHover: hover,
        onSelect: select,
        theme,
        ghost: sceneGhost,
      }
    : null;

  // One indicator for autosave and group edits; an error from either wins.
  const gs = edits.sync;
  const shownSave: SaveState =
    save.kind === 'error'
      ? save
      : gs.kind === 'error'
        ? { kind: 'error', reason: gs.reason }
        : save.kind === 'saving' || gs.kind === 'saving'
          ? { kind: 'saving' }
          : save.kind === 'saved' || gs.kind === 'saved'
            ? { kind: 'saved' }
            : save;
  const saveLabel =
    shownSave.kind === 'local'
      ? c.localOnly
      : shownSave.kind === 'saving'
        ? c.saving
        : shownSave.kind === 'saved'
          ? c.saved
          : shownSave.kind === 'error'
            ? `${c.notSaved}: ${shownSave.reason}`
            : null;
  // No conflicting utilities in one class string (bg-surface vs bg-ink, py-1 vs py-1.5).
  const pillBase = 'inline-flex items-center gap-1.5 rounded-full border px-3 font-semibold transition';
  const pillPlain = `${pillBase} border-divider bg-surface text-ink hover:bg-ink/[0.04] disabled:text-muted/60`;
  const pillSolid = `${pillBase} border-ink bg-ink text-page disabled:opacity-60`;
  const lg = 'py-1.5 text-[12px]';
  const sm = 'py-1 text-[11.5px]';

  const panelBody = !panel ? null : panel.kind === 'eras' ? (
    <EraEditor
      key={panel.artistId}
      artistId={panel.artistId}
      artistName={panel.label}
      enabled={api}
      onClose={closePanel}
      onSaved={afterEraSave}
    />
  ) : panel.kind === 'metric' ? (
    <MetricPanel
      enabled={api}
      onClose={closePanel}
      getPositions={metricPositions}
      onRebuild={onReload ? () => onReload({ refresh: true }) : undefined}
    />
  ) : (
    <AddArtist
      enabled={api}
      byKey={byKey}
      ghost={ghost}
      onGhost={onGhost}
      onOnMap={(key, message) => {
        closePanel();
        setNotice(message);
        selectAndFocus(key);
      }}
      onPickNode={selectAndFocus}
      onClose={closePanel}
    />
  );
  const inspectorProps = {
    payload,
    byKey,
    groups: edits.groups,
    onSetWeight: edits.setWeight,
    onOpenEras: (n: TasteMapPayloadNode) => openPanel({ kind: 'eras', artistId: n.artistId, label: n.label }),
    c,
    onPick: selectAndFocus,
    onTogglePin: togglePin,
  };

  return (
    <div className="w-full min-w-0">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink">{c.title}</h1>
          <p className="text-[11.5px] text-muted">{c.sub}</p>
        </div>
        <div role="group" className="inline-flex rounded-full border border-divider bg-surface p-0.5 text-[12px] font-semibold">
          {(['3d', '2d'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition ${
                mode === m ? 'bg-ink text-page' : 'text-muted hover:text-ink'
              }`}
            >
              {m === '3d' ? <Box size={13} /> : <MapIcon size={13} />}
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {running ? (
          <button type="button" onClick={finishRearrange} className={`${pillSolid} ${lg}`}>
            <Square size={12} />
            {c.stop}
          </button>
        ) : (
          <button
            type="button"
            onClick={startRearrange}
            disabled={importing}
            className={`${pillPlain} ${lg}`}
          >
            <Shuffle size={13} />
            {c.rearrange}
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={doExport} className={`${pillPlain} ${sm}`}>
          <Download size={12} />
          {c.export}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={importing}
          className={`${pillPlain} ${sm}`}
        >
          <Upload size={12} />
          {c.import}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
        <button
          type="button"
          aria-pressed={panel?.kind === 'add'}
          onClick={() => (panel?.kind === 'add' ? closePanel() : openPanel({ kind: 'add' }))}
          className={`${pillPlain} ${sm}`}
        >
          <UserPlus size={12} />
          {c.addArtist}
        </button>
        <button
          type="button"
          aria-pressed={panel?.kind === 'metric'}
          onClick={() => (panel?.kind === 'metric' ? closePanel() : openPanel({ kind: 'metric' }))}
          className={`${pillPlain} ${sm}`}
        >
          <SlidersHorizontal size={12} />
          {c.weights}
        </button>
        {saveLabel && (
          <span
            role="status"
            aria-live="polite"
            className={`ml-auto min-w-0 truncate text-[11px] ${shownSave.kind === 'error' ? 'font-semibold text-ink' : 'text-muted'}`}
            title={saveLabel}
          >
            {saveLabel}
          </span>
        )}
      </div>

      {notice && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-divider bg-surface px-3 py-2 text-[12px] text-ink">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button type="button" aria-label={c.close} onClick={() => setNotice(null)} className="shrink-0 text-muted hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {pendingImport && (
        <div role="alertdialog" aria-label={c.importTitle} className="mt-2 rounded-xl border border-divider bg-surface px-3.5 py-3">
          <p className="text-[13px] font-bold text-ink">{c.importTitle}</p>
          <p className="mt-0.5 break-words text-[11.5px] text-muted">
            {pendingImport.file} · {pendingImport.data.pins.length} {c.pinsWord} · {pendingImport.data.groups.length}{' '}
            {c.groupsWord}
            {pendingImport.data.exportedAt ? ` · ${String(pendingImport.data.exportedAt).slice(0, 10)}` : ''}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{persist ? c.importBody : c.importLocal}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={confirmImport}
              disabled={importing}
              className={`${pillSolid} ${sm}`}
            >
              <Upload size={12} />
              {importing ? c.saving : c.importConfirm}
            </button>
            <button
              type="button"
              onClick={() => setPendingImport(null)}
              disabled={importing}
              className={`${pillPlain} ${sm}`}
            >
              {c.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label={c.groups}>
        {edits.groups.map((g) => {
          const off = hiddenGroups.has(g.id);
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={!off}
              onClick={() => toggleGroup(g.id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition ${
                off ? 'border-divider text-muted/60 line-through' : 'border-divider bg-surface text-ink hover:bg-ink/[0.04]'
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: off ? 'transparent' : g.color, boxShadow: `inset 0 0 0 1.5px ${g.color}` }}
              />
              <span className="truncate">{g.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={editingGroups}
          onClick={() => setEditingGroups((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11.5px] font-semibold transition ${
            editingGroups ? 'border-ink text-ink' : 'border-divider text-muted hover:text-ink'
          }`}
        >
          <Pencil size={11} />
          {c.editGroups}
        </button>
      </div>
      {editingGroups && <GroupEditor edits={edits} onClose={() => setEditingGroups(false)} />}

      {/* ── Stage + inspector ── */}
      <div className="mt-3 flex flex-col gap-3 md:flex-row">
        <div className="relative h-[68vh] max-h-[720px] min-h-[380px] min-w-0 flex-1 overflow-hidden rounded-2xl border border-divider bg-surface">
          {sceneProps && (mode === '3d' ? <Scene3D {...sceneProps} /> : <Map2D {...sceneProps} />)}

          <div className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-surface/80 px-2 py-1 backdrop-blur">
            <span className="text-[10px] tabular-nums text-muted">1</span>
            <span
              className="h-[6px] w-14 rounded-full"
              style={{
                background: `linear-gradient(to right, ${[1, 2, 3, 4, 5].map((s) => spectrumColor(s, 0.62, 1)).join(', ')})`,
              }}
            />
            <span className="text-[10px] tabular-nums text-muted">5</span>
            <span className="text-[10px] text-muted">{c.score}</span>
          </div>

          {/* Phone: the inspector (or an open panel) is a bottom sheet over the stage. */}
          {((isPhone && panelBody) || selectedNode) && (
            <div className="absolute inset-x-0 bottom-0 z-10 max-h-[58%] overflow-y-auto rounded-t-2xl border-t border-divider bg-surface/95 px-4 pb-4 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md md:hidden">
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-divider" />
              {(isPhone && panelBody) || (
                selectedNode && (
                  <>
                    <button
                      type="button"
                      aria-label={c.close}
                      onClick={() => setSelectedKey(null)}
                      className="absolute right-3 top-3 rounded-full p-1 text-muted hover:text-ink"
                    >
                      <X size={16} />
                    </button>
                    <Inspector {...inspectorProps} node={selectedNode} pin={pins.get(selectedNode.key) ?? null} />
                  </>
                )
              )}
            </div>
          )}
        </div>

        <aside className="hidden h-[68vh] max-h-[720px] min-h-[380px] w-[300px] shrink-0 overflow-y-auto rounded-2xl border border-divider/60 bg-page px-4 py-4 md:block">
          {(!isPhone && panelBody) || (inspected ? (
            <Inspector {...inspectorProps} node={inspected} pin={pins.get(inspected.key) ?? null} />
          ) : (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.whyHere}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{c.hint}</p>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.biggest}</p>
              <div className="mt-2 space-y-0.5">
                {[...payload.nodes]
                  .filter((n) => visible.has(n.key))
                  .sort((a, b) => b.mass - a.mass)
                  .slice(0, 8)
                  .map((n) => (
                    <NodeRow key={n.key} node={n} onPick={selectAndFocus} c={c} />
                  ))}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function ScoreChip({ score, c }: { score: number | null; c: Copy }) {
  if (score == null) {
    return <span className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-muted">{c.unrated}</span>;
  }
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums"
      style={{ background: spectrumFill(score), color: spectrumNumber(score) }}
    >
      {formatScore(score)}
    </span>
  );
}

function NodeRow({ node, onPick, c }: { node: TasteMapPayloadNode; onPick: (k: NodeKey) => void; c: Copy }) {
  return (
    <button
      type="button"
      onClick={() => onPick(node.key)}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-ink/[0.04]"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: node.avgScore != null ? spectrumColor(node.avgScore, 0.62, 1) : 'rgb(var(--color-muted))' }}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
        {node.label}
        {node.eraLabel && <span className="ml-1 font-normal text-muted">{node.eraLabel}</span>}
      </span>
      <ScoreChip score={node.avgScore} c={c} />
    </button>
  );
}

/** Neutral steps for the "why" stacked bar — identity rides on the text list beside it. */
const WHY_ALPHAS = [0.72, 0.5, 0.34, 0.22, 0.14, 0.09];

function Inspector({
  node,
  payload,
  byKey,
  groups,
  onSetWeight,
  onOpenEras,
  c,
  onPick,
  pin,
  onTogglePin,
}: {
  node: TasteMapPayloadNode;
  payload: TasteMapPayload;
  byKey: Map<NodeKey, TasteMapPayloadNode>;
  groups: TasteMapPayload['groups'];
  onSetWeight: (key: NodeKey, groupId: string, weight: number) => number;
  onOpenEras: (node: TasteMapPayloadNode) => void;
  c: Copy;
  onPick: (k: NodeKey) => void;
  pin: PinState | null;
  onTogglePin: (k: NodeKey) => void;
}) {
  const neighbors = (payload.neighbors[node.key] ?? []).slice(0, 4);
  const trail = payload.trails.find((t) => t.artistId === node.artistId);
  const otherEras = trail ? trail.keys.filter((k) => k !== node.key) : [];

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.whyHere}</p>
      <div className="mt-1 flex items-start gap-2 pr-7 md:pr-0">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-extrabold leading-tight text-ink">{node.label}</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {node.eraLabel ? `${node.eraLabel} · ` : ''}
            {node.covers.length} {c.albums} · {c.weight} {node.mass.toFixed(1)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <span className="text-[10.5px] text-muted">{c.avg}</span>
          <ScoreChip score={node.avgScore} c={c} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {pin && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink">
            <Pin size={12} className={pin.softZ ? '' : 'fill-current'} />
            {pin.softZ ? c.pinned2d : c.pinned}
          </span>
        )}
        <button
          type="button"
          onClick={() => onTogglePin(node.key)}
          aria-pressed={!!pin}
          className="inline-flex items-center gap-1 rounded-full border border-divider px-2.5 py-0.5 text-[11px] font-semibold text-ink transition hover:bg-ink/[0.04]"
        >
          {pin ? <PinOff size={11} /> : <Pin size={11} />}
          {pin ? c.unpin : c.pin}
        </button>
      </div>

      {node.covers.length > 0 && (
        <div className="mt-3 flex gap-1.5 overflow-hidden">
          {node.covers.slice(0, 5).map((cv) => (
            <div key={cv.id} className="w-11 shrink-0" title={cv.title}>
              <Cover url={cv.coverUrl} alt={cv.title} className="h-11 w-11" rounded="rounded-md" />
            </div>
          ))}
        </div>
      )}

      <MembershipEditor node={node} groups={groups} onSetWeight={onSetWeight} />

      <div className="mt-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.eras}</p>
        <button
          type="button"
          onClick={() => onOpenEras(node)}
          className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-divider px-2.5 py-1 text-[11.5px] font-semibold text-ink transition hover:bg-ink/[0.04]"
        >
          <Scissors size={11} />
          {c.erasEdit}
        </button>
      </div>

      {otherEras.length > 0 && (
        <div className="mt-3.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.otherEras}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {otherEras.map((k) => {
              const n = byKey.get(k);
              if (!n) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPick(k)}
                  className="rounded-full border border-divider px-2.5 py-1 text-[11.5px] font-semibold text-ink transition hover:bg-ink/[0.04]"
                >
                  {n.eraLabel ?? n.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {neighbors.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.nearest}</p>
          <ul className="mt-1.5 space-y-2.5">
            {neighbors.map((nb) => {
              const n = byKey.get(nb.key);
              if (!n) return null;
              const why = nb.why.slice(0, WHY_ALPHAS.length);
              return (
                <li key={nb.key}>
                  <button
                    type="button"
                    onClick={() => onPick(nb.key)}
                    className="flex w-full items-baseline justify-between gap-2 rounded text-left hover:underline"
                  >
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">
                      {n.label}
                      {n.eraLabel && <span className="ml-1 font-normal text-muted">{n.eraLabel}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">{Math.round(nb.sim * 100)}%</span>
                  </button>
                  <div className="mt-1 flex h-[5px] overflow-hidden rounded-full bg-divider/60">
                    {why.map((w, i) => (
                      <span
                        key={w.label}
                        className="h-full"
                        style={{
                          width: `${w.share * 100}%`,
                          background: `rgb(var(--color-ink) / ${WHY_ALPHAS[i]})`,
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted">
                    {why.slice(0, 3).map((w, i) => (
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
        </div>
      )}
    </div>
  );
}

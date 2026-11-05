'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Atom, Box, ChevronUp, Download, Map as MapIcon, Maximize2, Minimize2, MoreHorizontal, Pencil, Pin, PinOff, Redo2, RotateCcw, Scissors, Shuffle, Ruler, SlidersHorizontal, Square, Undo2, Upload, UserPlus, X } from 'lucide-react';
import Cover from '../Cover';
import { FlowerSpinner } from '../Loading';
import { useLanguage } from '../../../lib/i18n';
import { formatScore, spectrumColor, spectrumFill, spectrumNumber } from '../../../lib/sj/display';
import type { PlaceResponse, TasteMapExport } from '../../../lib/tasteMap/apiTypes';
import { downloadJson, exportMap, importMap, parseExportFile, saveLayout, savePins } from '../../../lib/tasteMap/client';
import { createRearrange, type Rearrange } from '../../../lib/tasteMap/forceLayout';
import { distortionRgb, hasGenreLens, hueMap, nodeRgb, oklabToRgb, rgbCss, type MapLens } from '../../../lib/tasteMap/color';
import { HONEST_K, neighborHonesty, type Honesty, type HonestySummary } from '../../../lib/tasteMap/honesty';
import { buildAtlas, type Atlas } from '../../../lib/tasteMap/regions';
import { InfoTip } from './ui';
import { fromPlane, planeBasis, toPlane, type PlaneBasis } from '../../../lib/tasteMap/plane';
import { schematicLayout, type Schematic } from '../../../lib/tasteMap/schematic';
import type { NodeKey, TasteMapPayload, TasteMapPayloadNode, Vec2, Vec3 } from '../../../lib/tasteMap/types';
import AddArtist from './AddArtist';
import EraEditor from './EraEditor';
import GhostTray from './GhostTray';
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
 * bottom sheet over the stage for the selected node, peeking (name + score)
 * until opened so the map stays in view. Its height reaches the scenes as
 * `bottomInset`. Phones also get the legend as a pill and the secondary
 * toolbar actions in a "More" menu.
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
 * Copy is inline en/ko (not in the lib/i18n dictionaries yet).
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
/** 2D only: an exaggerated, readable diagram (lib/tasteMap/schematic.ts) or the true plane, to scale. */
export type MapScale = 'schematic' | 'true';

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
/** One star's place and pin, as the move history keeps it. */
interface MoveSnap {
  key: NodeKey;
  pos: Vec3;
  pos2d: Vec2;
  pin: PinState | null;
}
interface MoveEntry {
  label: string;
  items: MoveSnap[];
}
const snapOf = (n: TasteMapPayloadNode, pins: Map<NodeKey, PinState>): MoveSnap => {
  const pin = pins.get(n.key);
  return { key: n.key, pos: [...n.pos], pos2d: [...n.pos2d], pin: pin ? { ...pin } : null };
};
const sameSnap = (a: MoveSnap, b: MoveSnap) =>
  a.pos.every((x, i) => Math.abs(x - b.pos[i]) < 1e-9) && !a.pin === !b.pin && (a.pin?.softZ ?? false) === (b.pin?.softZ ?? false);

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
  /** What node color means (lib/tasteMap/color.ts). */
  lens: MapLens;
  /** The session's fixed D5 frame: the 2D view reads depth (`toPlane(pos)[2]`) from it. */
  basis: PlaneBasis;
  /** How much of each node's real neighborhood the current view keeps (lib/tasteMap/honesty.ts). */
  honesty: HonestySummary;
  /** Countries, bridges and their links over the visible nodes (lib/tasteMap/regions.ts). */
  atlas: Atlas;
  /** 2D: schematic (exaggerated) or true-to-scale positions. 3D ignores it. */
  scale: MapScale;
  /** The schematic layout of the visible nodes; null in 3D. */
  schematic: Schematic | null;
  /** The schematic's center mark ("you"). */
  nucleusLabel: string;
  /**
   * Phones: px of the stage's bottom edge covered by the shell's bottom sheet
   * (inspector peek / expanded, or an open panel); 0 when none. Scenes keep
   * the picture and their own controls above it.
   */
  bottomInset?: number;
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
    sub: 'Your artists, placed by how alike they are',
    more: 'More actions',
    legend: 'Legend',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
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
    lensGenre: 'Sound',
    lensScore: 'Score',
    lensDistortion: 'Distortion',
    legendGenre: 'vivid = one sound · gray = mixed',
    legendKept: 'kept',
    legendTorn: 'torn',
    legendDistortion: 'of real neighborhoods kept here',
    honestKept: 'nearest kept on this view',
    honestTorn: 'Close in the data, far on this view',
    honestIntruders: 'Drawn close, but not that similar',
    country: 'Country',
    bridgeTo: 'Bridge to',
    legendDepth: 'brighter = nearer (depth)',
    soundMix: 'Sound mix',
    other: 'other',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    scaleSchematic: 'Schematic',
    scaleTrue: 'To scale',
    scaleSchematicTip: 'The same map, exaggerated to read: sounds fan out around you, stars spread evenly, and sounds blend where your artists cross over. Not to scale.',
    scaleTrueTip: 'True distances: the similarity space, flattened.',
    scaleInfo:
      'Schematic exaggerates the map so it reads: sounds fan out around you and stars spread evenly. To scale shows true distances. Stars can only be moved in To scale, because schematic places aren’t real.',
    info: 'About this',
    undoMove: 'Undo move (Ctrl+Z)',
    redoMove: 'Redo (Ctrl+Shift+Z)',
    resetMoves: 'Reset moved stars',
    resetMovesTip: 'Put every star you moved this visit back where it started (undoable)',
    movedToast: 'Moved {name} and pinned it',
    undoneToast: 'Undid: {name}',
    redoneToast: 'Redid: {name}',
    resetToast: 'Reset {n} moved stars',
    undo: 'Undo',
    redo: 'Redo',
    legendSchematic: 'direction = sound · overlap = crossover · not to scale',
    you: 'YOU',
  },
  ko: {
    title: '취향 지도',
    sub: '비슷한 아티스트끼리 가까이 놓인 지도',
    more: '더 보기',
    legend: '범례',
    showDetails: '자세히 보기',
    hideDetails: '접기',
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
    lensGenre: '사운드',
    lensScore: '점수',
    lensDistortion: '왜곡',
    legendGenre: '선명함 = 한 가지 사운드 · 회색 = 섞임',
    legendKept: '유지',
    legendTorn: '찢어짐',
    legendDistortion: '의 실제 이웃 관계가 이 화면에서 유지됨',
    honestKept: '가까운 이웃이 이 화면에서도 가까움',
    honestTorn: '데이터상 가깝지만 이 화면에선 멂',
    honestIntruders: '가깝게 그려졌지만 실제론 덜 비슷함',
    country: '나라',
    bridgeTo: '다리 →',
    legendDepth: '밝을수록 가까움 (깊이)',
    soundMix: '사운드 구성',
    other: '기타',
    fullscreen: '전체 화면',
    exitFullscreen: '전체 화면 종료',
    scaleSchematic: '도식',
    scaleTrue: '실제 거리',
    scaleSchematicTip: '같은 지도를 읽기 쉽게 과장했어요: 사운드가 나를 중심으로 퍼지고, 별들이 고르게 놓이고, 아티스트가 넘나드는 곳에서 사운드가 겹쳐요. 실제 거리는 아니에요.',
    scaleTrueTip: '실제 거리: 유사도 공간을 평면에 펼친 모습이에요.',
    scaleInfo:
      '도식은 읽기 쉽게 지도를 과장해요: 사운드가 나를 중심으로 퍼지고 별들이 고르게 놓여요. 실제 거리는 진짜 거리를 보여줘요. 도식의 위치는 실제가 아니라서, 별은 실제 거리에서만 옮길 수 있어요.',
    info: '설명',
    undoMove: '이동 되돌리기 (Ctrl+Z)',
    redoMove: '다시 하기 (Ctrl+Shift+Z)',
    resetMoves: '옮긴 별 초기화',
    resetMovesTip: '이번에 옮긴 별을 모두 처음 자리로 돌려요 (되돌릴 수 있어요)',
    movedToast: '{name}을(를) 옮기고 고정했어요',
    undoneToast: '되돌림: {name}',
    redoneToast: '다시 함: {name}',
    resetToast: '옮긴 별 {n}개를 초기화했어요',
    undo: '되돌리기',
    redo: '다시 하기',
    legendSchematic: '방향 = 사운드 · 겹침 = 넘나듦 · 실제 거리 아님',
    you: '나',
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

  const [mode, setMode] = useState<MapMode>('2d');
  const [scale, setScale] = useState<MapScale>('schematic');
  const genreOk = hasGenreLens(payload.palette);
  const [lensPick, setLens] = useState<MapLens>('genre');
  // Older cached payloads and fixtures have no palette: score is all they can show.
  const lens: MapLens = genreOk || lensPick !== 'genre' ? lensPick : 'score';
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
  // Move history (drags, and Reset): undo / redo stacks of position + pin snapshots,
  // and each moved star's place when this visit first moved it (what Reset restores).
  const undoStack = useRef<MoveEntry[]>([]);
  const redoStack = useRef<MoveEntry[]>([]);
  const origin = useRef(new Map<NodeKey, MoveSnap>());
  const dragSnap = useRef<MoveSnap | null>(null);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const [moveToast, setMoveToast] = useState<{ text: string; action: 'undo' | 'redo' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Countries and bridges over what's visible (the graph, not positions: no layoutVersion).
  // Ghosts (payload `ghost`) are suggestions, not territory: they stay out of countries and honesty.
  const solidVisible = useMemo(() => new Set(work.filter((n) => visible.has(n.key) && !n.ghost).map((n) => n.key)), [work, visible]);
  const atlas = useMemo(
    () => buildAtlas(work, payload.neighbors, solidVisible, payload.palette, Object.fromEntries(edits.groups.map((g) => [g.id, g.name]))),
    [work, payload.neighbors, solidVisible, payload.palette, edits.groups],
  );

  // 2D schematic: an exaggeration of the true plane over what's visible, so it follows the layout.
  const schematic = useMemo(
    () => (mode === '2d' ? schematicLayout(work.filter((n) => visible.has(n.key)), payload.neighbors) : null),
    // layoutVersion stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [work, visible, payload.neighbors, mode, layoutVersion],
  );
  const schematicOn = mode === '2d' && scale === 'schematic';

  // Honest map: neighborhoods kept by the view on screen (2D plane, schematic or 3D), live under drags.
  const honesty = useMemo(
    () =>
      neighborHonesty(
        new Map(work.filter((n) => !n.ghost).map((n) => [n.key, mode === '3d' ? n.pos : (schematicOn && schematic?.pos.get(n.key)) || n.pos2d])),
        payload.neighbors,
      ),
    // layoutVersion stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [work, payload.neighbors, mode, layoutVersion, schematicOn, schematic],
  );

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
        dragSnap.current = snapOf(n, pinsRef.current);
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
        const before = dragSnap.current;
        dragSnap.current = null;
        if (before && before.key === key) {
          if (!origin.current.has(key)) origin.current.set(key, before);
          pushHistory({ label: n.label, items: [before] });
          showToast(c.movedToast.replace('{name}', n.label), 'undo');
        }
      }
    },
    // pushHistory / showToast only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byKey, setNode2D, setNode3D, bump, updatePins, markDirty, c],
  );

  function showToast(text: string, action: 'undo' | 'redo') {
    setMoveToast({ text, action });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMoveToast(null), 6000);
  }
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  // A scale or mode switch moves on from the last move's toast.
  useEffect(() => setMoveToast(null), [scale, mode]);
  function pushHistory(entry: MoveEntry) {
    undoStack.current.push(entry);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHist({ undo: undoStack.current.length, redo: 0 });
  }
  /** Puts snapshots back (positions and pins) and returns what they replaced, for the other stack. */
  const applySnaps = (items: MoveSnap[]): MoveSnap[] => {
    const replaced: MoveSnap[] = [];
    for (const it of items) {
      const n = byKey.get(it.key);
      if (!n) continue;
      replaced.push(snapOf(n, pinsRef.current));
      n.pos = [...it.pos];
      n.pos2d = [...it.pos2d];
    }
    updatePins((prev) => {
      const next = new Map(prev);
      for (const it of items) {
        if (it.pin) next.set(it.key, it.pin);
        else next.delete(it.key);
      }
      return next;
    });
    setLayoutVersion((v) => v + 1);
    markDirty({ pins: true, layout: true });
    return replaced;
  };
  const undoMove = () => {
    if (running || dragging) return;
    const e = undoStack.current.pop();
    if (!e) return;
    redoStack.current.push({ label: e.label, items: applySnaps(e.items) });
    setHist({ undo: undoStack.current.length, redo: redoStack.current.length });
    showToast(c.undoneToast.replace('{name}', e.label), 'redo');
  };
  const redoMove = () => {
    if (running || dragging) return;
    const e = redoStack.current.pop();
    if (!e) return;
    undoStack.current.push({ label: e.label, items: applySnaps(e.items) });
    setHist({ undo: undoStack.current.length, redo: redoStack.current.length });
    showToast(c.redoneToast.replace('{name}', e.label), 'undo');
  };
  /** Every star moved this visit back to where it was first picked up (one undoable step). */
  const resetMoves = () => {
    if (running || dragging) return;
    const items = [...origin.current.values()].filter((o) => {
      const n = byKey.get(o.key);
      return n && !sameSnap(o, snapOf(n, pinsRef.current));
    });
    if (!items.length) return;
    const label = c.resetToast.replace('{n}', String(items.length));
    const replaced = applySnaps(items);
    undoStack.current.push({ label, items: replaced });
    redoStack.current = [];
    setHist({ undo: undoStack.current.length, redo: 0 });
    showToast(label, 'undo');
  };
  const histKeys = useRef({ undoMove, redoMove });
  histKeys.current = { undoMove, redoMove };
  // Ctrl/Cmd+Z undoes a move; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (!undoStack.current.length) return;
        e.preventDefault();
        histKeys.current.undoMove();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        if (!redoStack.current.length) return;
        e.preventDefault();
        histKeys.current.redoMove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // hist / layoutVersion re-render this when the answer can change.
  const canReset = [...origin.current.values()].some((o) => {
    const n = byKey.get(o.key);
    return n && !sameSnap(o, snapOf(n, pins));
  });

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

  // ── Fullscreen: the browser's Fullscreen API on the stage block where it
  // exists, else (iPhone Safari) a fixed full-viewport layer. Same layout either way.
  const stageBlock = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  fullRef.current = full;
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      setFull(false);
      return;
    }
    if (fullRef.current) {
      setFull(false);
      return;
    }
    const el = stageBlock.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    setFull(true);
  }, []);
  useEffect(() => {
    // Esc in native fullscreen exits without a key event reaching us.
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedKey(null);
        if (!document.fullscreenElement) setFull(false);
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFull]);

  const toggleGroup = (id: string) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inspected = (hoveredKey && byKey.get(hoveredKey)) || (selectedKey && byKey.get(selectedKey)) || null;
  const selectedNode = selectedKey ? byKey.get(selectedKey) ?? null : null;

  // ── Phone chrome: the inspector sheet peeks (a header row) until opened, the
  // legend is a pill until tapped, secondary toolbar actions sit in a menu. ──
  const [sheetOpen, setSheetOpen] = useState(false);
  // A new selection from nothing starts as a peek; picking another node from the open sheet keeps it open.
  useEffect(() => {
    if (!selectedKey) setSheetOpen(false);
  }, [selectedKey]);
  const [sheetPx, setSheetPx] = useState(0);
  const sheetObs = useRef<ResizeObserver | null>(null);
  const sheetRef = useCallback((el: HTMLDivElement | null) => {
    sheetObs.current?.disconnect();
    sheetObs.current = null;
    if (!el) {
      setSheetPx(0);
      return;
    }
    const ro = new ResizeObserver(() => setSheetPx(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    sheetObs.current = ro;
    setSheetPx(Math.round(el.getBoundingClientRect().height));
  }, []);
  useEffect(() => () => sheetObs.current?.disconnect(), []);
  const sheetDrag = useRef<{ y: number; moved: boolean } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);
  const phoneSheet = isPhone && (!!panel || !!selectedNode);
  const bottomInset = phoneSheet ? sheetPx : 0;

  const sceneProps: SceneProps | null = theme
    ? {
        payload: live,
        layoutVersion,
        pins,
        // The schematic is an exaggeration: there is no true position to drop a node at.
        editable: !running && !importing && !schematicOn,
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
        lens,
        basis,
        honesty,
        atlas,
        scale,
        schematic,
        nucleusLabel: c.you,
        bottomInset,
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
    honesty,
    atlas,
  };

  return (
    <div className="w-full min-w-0">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 flex-1 md:flex-none">
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink">{c.title}</h1>
          <p className="truncate text-[11.5px] text-muted">{c.sub}</p>
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
          // Phones: Re-arrange lives in the overflow menu.
          <div className="hidden md:block">
            <button
              type="button"
              onClick={startRearrange}
              disabled={importing}
              className={`${pillPlain} ${lg}`}
            >
              <Shuffle size={13} />
              {c.rearrange}
            </button>
          </div>
        )}
        {/* Phones: secondary actions in one menu. */}
        <div ref={menuRef} className="relative md:hidden">
          <button
            type="button"
            aria-label={c.more}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-divider text-ink transition ${menuOpen ? 'bg-ink/[0.06]' : 'bg-surface'}`}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={c.more}
              className="absolute right-0 top-full z-30 mt-1.5 w-52 overflow-hidden rounded-xl border border-divider bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
            >
              {(
                [
                  [c.rearrange, Shuffle, startRearrange, running || importing],
                  [c.addArtist, UserPlus, () => (panel?.kind === 'add' ? closePanel() : openPanel({ kind: 'add' })), false],
                  [c.weights, SlidersHorizontal, () => (panel?.kind === 'metric' ? closePanel() : openPanel({ kind: 'metric' })), false],
                  [c.export, Download, doExport, false],
                  [c.import, Upload, () => fileInput.current?.click(), importing],
                ] as const
              ).map(([label, Icon, run, off]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  disabled={off}
                  onClick={() => {
                    setMenuOpen(false);
                    void run();
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink transition hover:bg-ink/[0.04] disabled:text-muted/60"
                >
                  <Icon size={14} className="shrink-0 text-muted" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {saveLabel && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-1 truncate text-right text-[11px] md:hidden ${shownSave.kind === 'error' ? 'font-semibold text-ink' : 'text-muted'}`}
          title={saveLabel}
        >
          {saveLabel}
        </p>
      )}

      <div className="mt-2 hidden flex-wrap items-center gap-1.5 md:flex">
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

      {/* Phones: one row that scrolls sideways; wider screens wrap. */}
      <div
        className="-mx-4 mt-2.5 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
        aria-label={c.groups}
      >
        {edits.groups.map((g) => {
          const off = hiddenGroups.has(g.id);
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={!off}
              onClick={() => toggleGroup(g.id)}
              className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition ${
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
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11.5px] font-semibold transition ${
            editingGroups ? 'border-ink text-ink' : 'border-divider text-muted hover:text-ink'
          }`}
        >
          <Pencil size={11} />
          {c.editGroups}
        </button>
      </div>
      {editingGroups && <GroupEditor edits={edits} onClose={() => setEditingGroups(false)} />}
      <GhostTray nodes={work} pins={pins} api={api} canDrag={!schematicOn && !running} onPick={selectAndFocus} onChanged={bump} onReload={onReload} />

      {/* ── Stage + inspector ── */}
      <div
        ref={stageBlock}
        className={
          full
            ? 'fixed inset-0 z-[70] flex flex-col gap-2 bg-page p-2 md:flex-row'
            : 'mt-3 flex flex-col gap-3 md:flex-row'
        }
      >
        <div
          className={`relative min-w-0 overflow-hidden rounded-2xl border border-divider bg-surface ${
            // Phones (column layout): no flex-1, its zero basis would override the height and
            // leave only min-h. Tall enough to fill the screen between the app's header and tab bar.
            full ? 'h-full flex-1' : 'h-[calc(100svh-8.5rem)] max-h-[720px] min-h-[380px] md:h-[68vh] md:flex-1'
          }`}
        >
          {sceneProps && (mode === '3d' ? <Scene3D {...sceneProps} /> : <Map2D {...sceneProps} />)}

          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleFull}
              aria-label={full ? c.exitFullscreen : c.fullscreen}
              title={`${full ? c.exitFullscreen : c.fullscreen} (F)`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-divider bg-surface/85 text-ink backdrop-blur transition hover:bg-surface"
            >
              {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            {full && (
              <div role="group" className="inline-flex rounded-full border border-divider bg-surface/85 p-0.5 text-[11.5px] font-semibold backdrop-blur">
                {(['3d', '2d'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => switchMode(m)}
                    className={`rounded-full px-2.5 py-1 transition ${mode === m ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {mode === '2d' && (
              <div role="group" className="inline-flex rounded-full border border-divider bg-surface/85 p-0.5 text-[11.5px] font-semibold backdrop-blur">
                {(
                  [
                    ['schematic', c.scaleSchematic, c.scaleSchematicTip, Atom],
                    ['true', c.scaleTrue, c.scaleTrueTip, Ruler],
                  ] as const
                ).map(([sc, label, tip, Icon]) => (
                  <button
                    key={sc}
                    type="button"
                    aria-pressed={scale === sc}
                    aria-label={label}
                    title={tip}
                    onClick={() => setScale(sc)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${scale === sc ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}
                  >
                    <Icon size={12} className="my-[1.5px]" />
                    {/* Phones: icons only, so the lens switch at top right keeps its room. */}
                    <span className="hidden md:inline">{label}</span>
                  </button>
                ))}
              </div>
            )}
            {mode === '2d' && (
              <span className="hidden rounded-full border border-divider bg-surface/85 backdrop-blur md:inline-flex">
                <InfoTip label={c.info} text={c.scaleInfo} />
              </span>
            )}
            {(hist.undo > 0 || hist.redo > 0) && (
              <div role="group" className="inline-flex items-center rounded-full border border-divider bg-surface/85 p-0.5 backdrop-blur">
                <button
                  type="button"
                  onClick={undoMove}
                  disabled={!hist.undo || running || dragging}
                  aria-label={c.undoMove}
                  title={c.undoMove}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink transition hover:bg-ink/[0.06] disabled:text-muted/50"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={redoMove}
                  disabled={!hist.redo || running || dragging}
                  aria-label={c.redoMove}
                  title={c.redoMove}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink transition hover:bg-ink/[0.06] disabled:text-muted/50"
                >
                  <Redo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={resetMoves}
                  disabled={!canReset || running || dragging}
                  aria-label={c.resetMoves}
                  title={c.resetMovesTip}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink transition hover:bg-ink/[0.06] disabled:text-muted/50"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            )}
          </div>

          {/* After a move, undo or reset: what just happened, with the way back. */}
          {moveToast && !dragging && (
            <div
              role="status"
              aria-live="polite"
              className="absolute right-2.5 top-[52px] z-[8] inline-flex max-w-[calc(100%-1.25rem)] items-center gap-2 rounded-full border border-divider bg-surface/95 py-1 pl-3 pr-1 text-[11.5px] text-ink shadow-[0_8px_24px_rgba(0,0,0,0.2)] backdrop-blur-md"
            >
              <span className="min-w-0 truncate">{moveToast.text}</span>
              {(moveToast.action === 'undo' ? hist.undo : hist.redo) > 0 && (
                <button
                  type="button"
                  onClick={moveToast.action === 'undo' ? undoMove : redoMove}
                  className="shrink-0 rounded-full bg-ink px-2.5 py-0.5 font-semibold text-page"
                >
                  {moveToast.action === 'undo' ? c.undo : c.redo}
                </button>
              )}
              <button type="button" aria-label={c.close} onClick={() => setMoveToast(null)} className="shrink-0 rounded-full p-1 text-muted hover:text-ink">
                <X size={12} />
              </button>
            </div>
          )}

          <Legend
            c={c}
            lens={lens}
            genreOk={genreOk}
            onLens={setLens}
            palette={payload.palette}
            depth={mode === '2d'}
            schematic={schematicOn}
            honesty={honesty}
            phone={isPhone}
            open={legendOpen}
            onToggle={() => setLegendOpen((v) => !v)}
            bottomInset={bottomInset}
          />


          {/* Phone: an open panel is a bottom sheet over the stage; the inspector is one
              that peeks (a header row) and opens on tap or an upward drag, so a
              refocused map stays in view. The scenes read its height (`bottomInset`). */}
          {isPhone && panelBody ? (
            <div
              ref={sheetRef}
              className="absolute inset-x-0 bottom-0 z-10 max-h-[58%] overflow-y-auto rounded-t-2xl border-t border-divider bg-surface/95 px-4 pb-4 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md md:hidden"
            >
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-divider" />
              {panelBody}
            </div>
          ) : (
            isPhone &&
            selectedNode && (
              <div
                ref={sheetRef}
                className="absolute inset-x-0 bottom-0 z-10 flex max-h-[58%] flex-col rounded-t-2xl border-t border-divider bg-surface/95 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md md:hidden"
              >
                <div
                  className="relative shrink-0 touch-none select-none"
                  onPointerDown={(e) => {
                    sheetDrag.current = { y: e.clientY, moved: false };
                  }}
                  onPointerMove={(e) => {
                    const d = sheetDrag.current;
                    if (d && !d.moved && Math.abs(e.clientY - d.y) > 8) {
                      d.moved = true;
                      // Only a drag captures the pointer: a tap must still reach the buttons.
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }
                  }}
                  onPointerUp={(e) => {
                    const d = sheetDrag.current;
                    if (!d?.moved) return;
                    const dy = e.clientY - d.y;
                    if (dy < -20) setSheetOpen(true);
                    else if (dy > 20) {
                      // Down on an open sheet folds it; down on a peek lets go of the selection.
                      if (sheetOpen) setSheetOpen(false);
                      else setSelectedKey(null);
                    }
                  }}
                  onPointerCancel={() => {
                    sheetDrag.current = null;
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={sheetOpen}
                    aria-label={`${selectedNode.label}: ${sheetOpen ? c.hideDetails : c.showDetails}`}
                    onClick={() => {
                      // A drag already decided; only a tap toggles.
                      if (sheetDrag.current?.moved) {
                        sheetDrag.current = null;
                        return;
                      }
                      sheetDrag.current = null;
                      setSheetOpen((v) => !v);
                    }}
                    className="block w-full pb-2.5 pl-4 pr-12 pt-1.5 text-left"
                  >
                    <span aria-hidden className="mx-auto mb-1.5 block h-1 w-9 rounded-full bg-divider" />
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: dotColor(selectedNode, lens, payload.palette, honesty.byKey.get(selectedNode.key)?.recall) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-extrabold leading-tight text-ink">{selectedNode.label}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {selectedNode.eraLabel ? `${selectedNode.eraLabel} · ` : ''}
                          {selectedNode.covers.length} {c.albums} · {c.weight} {selectedNode.mass.toFixed(1)}
                          {pins.has(selectedNode.key) ? ` · ${c.pinned}` : ''}
                        </span>
                      </span>
                      <ScoreChip score={selectedNode.avgScore} c={c} />
                      <ChevronUp size={16} className={`shrink-0 text-muted transition ${sheetOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={c.close}
                    onClick={() => setSelectedKey(null)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted hover:text-ink"
                  >
                    <X size={16} />
                  </button>
                </div>
                {sheetOpen && (
                  <div className="min-h-0 overflow-y-auto border-t border-divider/60 px-4 pb-4 pt-2.5">
                    <Inspector {...inspectorProps} node={selectedNode} pin={pins.get(selectedNode.key) ?? null} hideHead />
                  </div>
                )}
              </div>
            )
          )}
        </div>

        <aside
          className={`hidden w-[300px] shrink-0 overflow-y-auto rounded-2xl border border-divider/60 bg-page px-4 py-4 md:block ${
            full ? 'h-full' : 'h-[68vh] max-h-[720px] min-h-[380px]'
          }`}
        >
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
                    <NodeRow key={n.key} node={n} onPick={selectAndFocus} c={c} dot={dotColor(n, lens, payload.palette, honesty.byKey.get(n.key)?.recall)} />
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

/** A palette tag's swatch: its hue at full purity. */
function swatch(hue: number, L = 0.7): string {
  const rad = (hue * Math.PI) / 180;
  return rgbCss(oklabToRgb(L, 0.15 * Math.cos(rad), 0.15 * Math.sin(rad)));
}

/** A node's dot in lists: the same color the map gives it (no depth shading). */
function dotColor(n: TasteMapPayloadNode, lens: MapLens, palette: TasteMapPayload['palette'], recall?: number): string {
  if (lens === 'score' && n.avgScore == null) return 'rgb(var(--color-muted))';
  return rgbCss(nodeRgb(n, lens, hueMap(palette), 0.66, recall));
}

/**
 * Lens switch (top right of the stage) + legend (bottom right, clear of the
 * compass at bottom left). Sound: the palette tags as
 * swatches in wheel order (neighbors co-occur) and how to read vivid / gray /
 * bright. Score: the app's score ramp. Distortion: the kept → torn ramp and
 * the share of neighborhoods the current view keeps.
 */
function Legend({
  c,
  lens,
  genreOk,
  onLens,
  palette,
  depth,
  schematic,
  honesty,
  phone,
  open,
  onToggle,
  bottomInset,
}: {
  c: Copy;
  lens: MapLens;
  genreOk: boolean;
  onLens: (l: MapLens) => void;
  palette: TasteMapPayload['palette'];
  depth: boolean;
  schematic: boolean;
  honesty: HonestySummary;
  /** Phones: the legend is a pill that opens on tap (it covered a third of the stage). */
  phone: boolean;
  open: boolean;
  onToggle: () => void;
  /** Px of the stage bottom under the phone sheet: the legend sits above it. */
  bottomInset: number;
}) {
  const lift = phone && bottomInset > 0 ? { bottom: bottomInset + 10 } : undefined;
  // A tall sheet (an open panel or the expanded inspector) leaves no room: the legend steps aside.
  const hidden = phone && bottomInset > 160;
  const body = (
    <>
      {lens === 'genre' && palette?.length ? (
        <>
          <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
            {palette.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-ink">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch(p.hue) }} />
                {p.label}
              </span>
            ))}
          </div>
          <p className="mt-1 text-right text-[10px] leading-snug text-muted">
            {c.legendGenre}
            {depth && <> · {c.legendDepth}</>}
          </p>
        </>
      ) : lens === 'distortion' ? (
        <>
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-[10px] text-muted">{c.legendTorn}</span>
            <span
              className="h-[6px] w-14 rounded-full"
              style={{ background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rgbCss(distortionRgb(t, 0.7))).join(', ')})` }}
            />
            <span className="text-[10px] text-muted">{c.legendKept}</span>
          </div>
          <p className="mt-1 text-right text-[10px] leading-snug text-muted">
            <span className="font-semibold tabular-nums text-ink">{Math.round(honesty.mean * 100)}%</span> {c.legendDistortion} (k={HONEST_K})
          </p>
        </>
      ) : (
        <div className="flex items-center gap-1.5">
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
      )}
      {schematic && <p className="mt-0.5 text-right text-[10px] leading-snug text-muted">{c.legendSchematic}</p>}
    </>
  );
  return (
    <>
      <div role="group" className="absolute right-2.5 top-2.5 inline-flex rounded-full border border-divider bg-surface/85 p-0.5 text-[11.5px] font-semibold backdrop-blur">
        {(
          [
            ['genre', c.lensGenre],
            ['score', c.lensScore],
            ['distortion', c.lensDistortion],
          ] as const
        )
          .filter(([l]) => genreOk || l !== 'genre')
          .map(([l, label]) => (
            <button
              key={l}
              type="button"
              aria-pressed={lens === l}
              onClick={() => onLens(l)}
              className={`rounded-full px-2.5 py-1 transition ${lens === l ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
      </div>
      {hidden ? null : phone && !open ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={onToggle}
          style={lift}
          className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-full border border-divider bg-surface/85 px-2.5 py-1 text-[11.5px] font-semibold text-ink backdrop-blur"
        >
          {lens === 'genre' && palette?.length ? (
            <span aria-hidden className="flex -space-x-0.5">
              {palette.slice(0, 4).map((p) => (
                <span key={p.id} className="h-2 w-2 rounded-full ring-1 ring-surface" style={{ background: swatch(p.hue) }} />
              ))}
            </span>
          ) : lens === 'distortion' ? (
            <span className="tabular-nums text-muted">{Math.round(honesty.mean * 100)}%</span>
          ) : (
            <span
              aria-hidden
              className="h-[6px] w-6 rounded-full"
              style={{ background: `linear-gradient(to right, ${[1, 3, 5].map((s) => spectrumColor(s, 0.62, 1)).join(', ')})` }}
            />
          )}
          {c.legend}
        </button>
      ) : phone ? (
        // Open on a phone: a tap anywhere on the card folds it back into the pill.
        <div
          onClick={onToggle}
          style={lift}
          className="absolute bottom-2.5 right-2.5 max-w-[calc(100%-1.25rem)] rounded-xl border border-divider/60 bg-surface/90 px-2.5 pb-1.5 pt-1 backdrop-blur"
        >
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/70">{c.legend}</span>
            {/* Its click bubbles to the card's toggle. */}
            <button type="button" aria-label={c.close} aria-expanded className="-mr-1 rounded-full p-0.5 text-muted hover:text-ink">
              <X size={13} />
            </button>
          </div>
          {body}
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-2.5 right-2.5 max-w-[min(330px,calc(100%-14rem))] rounded-xl border border-divider/60 bg-surface/85 px-2.5 py-1.5 backdrop-blur">
          {body}
        </div>
      )}
    </>
  );
}

/** The node's palette mix as a stacked bar in the palette's colors, so the map color reads back as words. */
function SoundMix({ node, palette, c }: { node: TasteMapPayloadNode; palette: TasteMapPayload['palette']; c: Copy }) {
  if (!palette?.length || !node.mix) return null;
  const parts = palette
    .map((p) => ({ ...p, w: node.mix?.[p.id] ?? 0 }))
    .filter((p) => p.w > 0)
    .sort((a, b) => b.w - a.w);
  if (!parts.length) return null;
  const rest = Math.max(0, 1 - parts.reduce((s, p) => s + p.w, 0));
  return (
    <div className="mt-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60">{c.soundMix}</p>
      <div className="mt-1.5 flex h-[7px] overflow-hidden rounded-full bg-divider/60">
        {parts.map((p) => (
          <span key={p.id} className="h-full" style={{ width: `${p.w * 100}%`, background: swatch(p.hue, 0.66) }} />
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {parts.slice(0, 4).map((p, i) => (
          <span key={p.id}>
            {i > 0 && ' · '}
            <span className="text-mid">{p.label}</span> {Math.round(p.w * 100)}%
          </span>
        ))}
        {rest >= 0.05 && (
          <>
            {' · '}
            {c.other} {Math.round(rest * 100)}%
          </>
        )}
      </p>
    </div>
  );
}

function NodeRow({ node, onPick, c, dot }: { node: TasteMapPayloadNode; onPick: (k: NodeKey) => void; c: Copy; dot: string }) {
  return (
    <button
      type="button"
      onClick={() => onPick(node.key)}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-ink/[0.04]"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
        {node.label}
        {node.eraLabel && <span className="ml-1 font-normal text-muted">{node.eraLabel}</span>}
      </span>
      <ScoreChip score={node.avgScore} c={c} />
    </button>
  );
}

/** Honest map, per node: how many true neighbors this view keeps nearby, and which ones it tears off or invents. */
function Honest({ h, byKey, c, onPick }: { h: Honesty; byKey: Map<NodeKey, TasteMapPayloadNode>; c: Copy; onPick: (k: NodeKey) => void }) {
  const names = (keys: NodeKey[]) =>
    keys.map((k, i) => {
      const n = byKey.get(k);
      if (!n) return null;
      return (
        <span key={k}>
          {i > 0 && ', '}
          <button type="button" onClick={() => onPick(k)} className="text-mid hover:underline">
            {n.label}
            {n.eraLabel ? ` ${n.eraLabel}` : ''}
          </button>
        </span>
      );
    });
  return (
    <div className="mt-3.5">
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: rgbCss(distortionRgb(h.recall, 0.66)) }} />
        <span className="font-semibold tabular-nums text-ink">
          {h.k - h.torn.length}/{h.k}
        </span>
        {c.honestKept}
      </p>
      {h.torn.length > 0 && (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          {c.honestTorn}: {names(h.torn)}
        </p>
      )}
      {h.intruders.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted">
          {c.honestIntruders}: {names(h.intruders)}
        </p>
      )}
    </div>
  );
}

/** The node's country on the 2D map, and the countries it bridges to (lib/tasteMap/regions.ts). */
function Citizenship({ nodeKey, atlas, c }: { nodeKey: NodeKey; atlas: Atlas; c: Copy }) {
  const home = atlas.countries[atlas.countryOf.get(nodeKey) ?? -1];
  if (!home || home.members.length < 2) return null;
  const bridge = atlas.bridges.get(nodeKey);
  const dot = (hue: number | null) => (
    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hue == null ? 'rgb(var(--color-muted))' : swatch(hue) }} />
  );
  return (
    <div className="mt-3.5 space-y-1 text-[11.5px] text-muted">
      <p className="flex items-center gap-1.5">
        {dot(home.hue)}
        <span>
          {c.country} <span className="font-semibold text-ink">{home.name}</span>
        </span>
      </p>
      {bridge && (
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rotate-45 border border-ink" />
          <span>
            {c.bridgeTo}{' '}
            <span className="font-semibold text-ink">
              {bridge.countries
                .slice(1, 3)
                .map((id) => atlas.countries[id]?.name)
                .filter(Boolean)
                .join(', ')}
            </span>
          </span>
        </p>
      )}
    </div>
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
  honesty,
  atlas,
  hideHead = false,
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
  honesty: HonestySummary;
  atlas: Atlas;
  /** The phone sheet's own header already shows the name and score. */
  hideHead?: boolean;
}) {
  const neighbors = (payload.neighbors[node.key] ?? []).slice(0, 4);
  const honest = honesty.byKey.get(node.key) ?? null;
  const trail = payload.trails.find((t) => t.artistId === node.artistId);
  const otherEras = trail ? trail.keys.filter((k) => k !== node.key) : [];

  return (
    <div>
      {!hideHead && (
        <>
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
        </>
      )}

      <div className={`${hideHead ? '' : 'mt-2 '}flex flex-wrap items-center gap-1.5`}>
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

      <SoundMix node={node} palette={payload.palette} c={c} />
      <Citizenship nodeKey={node.key} atlas={atlas} c={c} />

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

      {honest && <Honest h={honest} byKey={byKey} c={c} onPick={onPick} />}

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

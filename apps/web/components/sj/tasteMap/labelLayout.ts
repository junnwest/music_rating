/**
 * Screen-space label layout for the 3D taste map (pure — no three.js, no DOM).
 *
 * Group labels (far zoom, one per group) are placed greedily in priority
 * order. Each wants to sit at its home point (bottom-center, in screen px);
 * when that collides with a label already placed, it slides along screen y to
 * the nearest free slot — above the obstacle preferred, below it allowed at a
 * higher cost — and Scene3D draws a thin leader back to the home point. A
 * label that finds no slot within `maxUp` / `maxDown` is dropped (it fades
 * out). Labels are also kept inside the viewport horizontally (a small x shift).
 *
 * Stability: the cost of a slot includes its distance from the label's
 * previous slot, so a label keeps its place while the camera orbits until
 * that place actually collides; Scene3D eases the drawn offset and alpha.
 *
 * Boxes are flat [x, y, w, h, x, y, w, h, …] in screen px, (x, y) top-left,
 * y down. Everything works on caller-owned typed arrays — nothing allocates
 * per call — so it is safe to run every frame.
 */

export interface GroupLayoutOptions {
  /** Minimum px between two labels. */
  gap: number;
  /** Furthest (px) a label may slide up before it is dropped instead. */
  maxUp: number;
  /** Furthest (px) a label may slide down — down runs into its own cluster, so keep it short. */
  maxDown: number;
  /** Cost multiplier for sliding down vs up. */
  downCost: number;
  /** Horizontal viewport margin (px). */
  margin: number;
  /** Cost per px of moving away from the previous frame's slot. */
  stickiness: number;
}

export const DEFAULT_GROUP_LAYOUT: GroupLayoutOptions = {
  gap: 3,
  maxUp: 220,
  maxDown: 28,
  downCost: 2.5,
  margin: 6,
  stickiness: 0.6,
};

export function boxesOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad = 0,
): boolean {
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by;
}

/** Whether box (x, y, w, h) overlaps any of the first `count` boxes in `boxes`. */
export function hitsAny(boxes: ArrayLike<number>, count: number, x: number, y: number, w: number, h: number, pad = 0): boolean {
  for (let k = 0; k < count; k += 1) {
    const o = k * 4;
    if (boxesOverlap(x, y, w, h, boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], pad)) return true;
  }
  return false;
}

export interface GroupLayoutScratch {
  /** Placed boxes (obstacles first, then labels as they are placed). */
  boxes: Float32Array;
  cand: Float32Array;
}

export function createGroupLayoutScratch(labels: number, obstacles: number): GroupLayoutScratch {
  const cap = labels + obstacles;
  return { boxes: new Float32Array(cap * 4), cand: new Float32Array(2 + cap * 2) };
}

/**
 * Lay out group labels.
 *
 * @param hx/hy/w/h  per label: home point (bottom-center px) and size (px)
 * @param active     per label: 1 to place, 0 to skip (hidden / off-screen)
 * @param prev       per label: previous shift (px), NaN when it had none
 * @param order      label indices, highest priority first
 * @param obstacles  fixed boxes labels must avoid (e.g. pinned node labels)
 * @param viewW      viewport width (px); labels are nudged in x to stay inside it
 * @param out        per label: shift along screen y (px, negative = up), NaN = dropped/inactive
 * @param outX       per label: shift along screen x (px) from the viewport clamp
 * @returns how many labels were placed; their boxes are scratch.boxes[obstacleCount..]
 */
export function layoutGroupLabels(
  hx: ArrayLike<number>,
  hy: ArrayLike<number>,
  w: ArrayLike<number>,
  h: ArrayLike<number>,
  active: ArrayLike<number>,
  prev: ArrayLike<number>,
  order: ArrayLike<number>,
  obstacles: ArrayLike<number>,
  obstacleCount: number,
  viewW: number,
  out: Float32Array,
  outX: Float32Array,
  scratch: GroupLayoutScratch,
  opts: GroupLayoutOptions = DEFAULT_GROUP_LAYOUT,
): number {
  const { boxes, cand } = scratch;
  const { gap, maxUp, maxDown, downCost, stickiness, margin } = opts;
  let placed = 0;
  for (let k = 0; k < obstacleCount; k += 1) {
    const o = k * 4;
    boxes[o] = obstacles[o];
    boxes[o + 1] = obstacles[o + 1];
    boxes[o + 2] = obstacles[o + 2];
    boxes[o + 3] = obstacles[o + 3];
    placed += 1;
  }
  out.fill(Number.NaN);
  outX.fill(0);

  for (let r = 0; r < order.length; r += 1) {
    const i = order[r];
    if (!active[i]) continue;
    const bw = w[i];
    const bh = h[i];
    const x0 = hx[i] - bw / 2;
    const x = bw + 2 * margin >= viewW ? x0 : Math.min(Math.max(x0, margin), viewW - margin - bw);
    const y0 = hy[i] - bh; // top of the box at shift 0
    const p = prev[i];
    const hasPrev = Number.isFinite(p);

    // Candidate shifts: home, last slot, and flush above / below every box
    // that shares this label's column.
    let nc = 0;
    cand[nc++] = 0;
    if (hasPrev) cand[nc++] = p;
    for (let k = 0; k < placed; k += 1) {
      const o = k * 4;
      if (!(x < boxes[o] + boxes[o + 2] + gap && x + bw + gap > boxes[o])) continue;
      cand[nc++] = boxes[o + 1] - gap - bh - y0; // flush above
      cand[nc++] = boxes[o + 1] + boxes[o + 3] + gap - y0; // flush below
    }

    let best = Number.NaN;
    let bestCost = Infinity;
    for (let c = 0; c < nc; c += 1) {
      const s = cand[c];
      if (s < -maxUp || s > maxDown) continue;
      const cost = (s < 0 ? -s : s * downCost) + (hasPrev ? stickiness * Math.abs(s - p) : 0);
      if (cost >= bestCost) continue;
      if (hitsAny(boxes, placed, x, y0 + s, bw, bh, gap - 0.01)) continue;
      best = s;
      bestCost = cost;
    }
    if (!Number.isFinite(best)) continue;
    out[i] = best;
    outX[i] = x - x0;
    const o = placed * 4;
    boxes[o] = x;
    boxes[o + 1] = y0 + best;
    boxes[o + 2] = bw;
    boxes[o + 3] = bh;
    placed += 1;
  }
  return placed - obstacleCount;
}

/**
 * Per-scene board the two label layers share: group labels publish the boxes
 * they occupy (node labels yield to them), node labels publish the boxes of
 * their pinned labels — selection, hover, neighbors — which group labels
 * avoid. Keyed by any per-scene object (the three.js Scene), so the two
 * components need no shared React state.
 */
export interface LabelBoard {
  groupBoxes: Float32Array;
  groupCount: number;
  pinnedBoxes: Float32Array;
  pinnedCount: number;
}

const boards = new WeakMap<object, LabelBoard>();

export function labelBoard(key: object): LabelBoard {
  let b = boards.get(key);
  if (!b) {
    b = { groupBoxes: new Float32Array(0), groupCount: 0, pinnedBoxes: new Float32Array(0), pinnedCount: 0 };
    boards.set(key, b);
  }
  return b;
}

/** Make sure `arr` holds at least `n` boxes, growing (and copying) if needed. */
export function ensureBoxes(arr: Float32Array, n: number): Float32Array {
  if (arr.length >= n * 4) return arr;
  const next = new Float32Array(Math.max(n, 8) * 4 * 2);
  next.set(arr);
  return next;
}

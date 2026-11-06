/**
 * Flexible territory names (the 2D map's country and province lettering).
 * Pure. A name is fitted into its territory instead of drawn at one size:
 *
 * - labelRoom: how much room a name centered on a territory has, the distance
 *   to the border along the name's axis and across it.
 * - fitName: the largest size, up to a cap set by the territory's area, at which
 *   the name fits that room. It loosens in order: tracking first (wide letter
 *   spacing is the look, so it goes last), then a second line (balanced break
 *   at a space or " · "), then the size, down to a floor.
 */

/**
 * The room for a name centered at (x, y) along `axis`: twice the distance to
 * the nearer border point near the axis line (len), and across it (thick).
 * `edge` is the border's points, in the same units. A side with no border point
 * within `band` of the line falls back to the territory's extent on that side.
 */
export function labelRoom(edge: [number, number][], x: number, y: number, axis: number, band: number): { len: number; thick: number } {
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  let posA = Infinity;
  let negA = Infinity;
  let posB = Infinity;
  let negB = Infinity;
  let spanA = 0;
  let spanB = 0;
  for (const [px, py] of edge) {
    const a = (px - x) * ux + (py - y) * uy;
    const b = -(px - x) * uy + (py - y) * ux;
    spanA = Math.max(spanA, Math.abs(a));
    spanB = Math.max(spanB, Math.abs(b));
    if (Math.abs(b) < band) {
      if (a >= 0) posA = Math.min(posA, a);
      else negA = Math.min(negA, -a);
    }
    if (Math.abs(a) < band) {
      if (b >= 0) posB = Math.min(posB, b);
      else negB = Math.min(negB, -b);
    }
  }
  const half = (p: number, n: number, span: number) => Math.min(Number.isFinite(p) ? p : span, Number.isFinite(n) ? n : span);
  return { len: 2 * half(posA, negA, spanA), thick: 2 * half(posB, negB, spanB) };
}

/** Tracking steps, as a share of the font size, widest first. */
export const TRACKING = [0.32, 0.2, 0.1] as const;
/** Line height, as a share of the font size. */
export const LINE_HEIGHT = 1.15;

export interface NameFit {
  lines: string[];
  size: number;
  /** Letter spacing in px. */
  spacing: number;
}

/**
 * Fit `text` into a box `w` × `h` px. `width(line, tracking)` is the line's
 * width at font size 1 (letter spacing = tracking × size), so widths scale
 * linearly with size. Sizes stay within [min, max]; at the floor the name may
 * overflow (a small territory still gets its name).
 */
export function fitName(
  text: string,
  w: number,
  h: number,
  max: number,
  min: number,
  width: (line: string, tracking: number) => number,
): NameFit {
  const options: string[][] = [[text]];
  const breaks = [...text.matchAll(/ · | /g)];
  if (breaks.length) {
    // The break that makes the two lines most even.
    let best: string[] | null = null;
    let worst = Infinity;
    for (const b of breaks) {
      const l1 = text.slice(0, b.index!);
      const l2 = text.slice(b.index! + b[0].length);
      const longest = Math.max(l1.length, l2.length);
      if (longest < worst) {
        worst = longest;
        best = [l1, l2];
      }
    }
    if (best) options.push(best);
  }
  // Per layout: the widest tracking that reaches the cap, else the tightest.
  const best = (lines: string[]) => {
    let fit: NameFit | null = null;
    for (const t of TRACKING) {
      const wide = Math.max(...lines.map((l) => width(l, t)));
      fit = { lines, size: Math.min(max, w / Math.max(wide, 1e-9), h / (LINE_HEIGHT * lines.length)), spacing: t };
      if (fit.size >= max) break;
    }
    return fit!;
  };
  // One line unless two are clearly bigger.
  let pick = best(options[0]);
  if (options[1] && pick.size < max) {
    const two = best(options[1]);
    if (two.size > pick.size * 1.12) pick = two;
  }
  const size = Math.max(min, Math.min(max, pick.size));
  return { lines: pick.lines, size, spacing: pick.spacing * size };
}

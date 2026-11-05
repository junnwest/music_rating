/**
 * The 3D star chart's look: the same fixed night sky as Map2D (whatever the app
 * theme), the star / nebula / line shaders, and small math helpers.
 */

/** The sky. Kept in step with Map2D's SKY so both views read as one product. */
export const SKY = {
  bg0: 'rgb(18, 21, 31)',
  bg1: 'rgb(7, 8, 13)',
  ink: 'rgb(234, 237, 245)',
  label: 'rgb(205, 211, 226)',
  muted: 'rgb(140, 148, 168)',
  halo: 'rgba(8, 9, 14, 0.85)',
  /** Prefix: append `alpha)`. */
  line: 'rgba(205, 218, 255, ',
  lineRgb: [205 / 255, 218 / 255, 255 / 255] as [number, number, number],
};

/** The stage background: Map2D's radial sky. */
export const SKY_CSS = `radial-gradient(ellipse at 50% 45%, ${SKY.bg0} 0%, ${SKY.bg1} 100%)`;

export const MATH_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

/** Star core radius in scene units, by mass (rated albums). */
export const starRadius = (mass: number) => 0.1 + 0.065 * Math.sqrt(Math.max(mass, 0));

/** On-screen core radius clamp, CSS px — shared by the shader and the overlays. */
export const MIN_PX = 2.4;
export const MAX_PX = 11.5;
/** Point sprite half-size in core radii (the glow reaches this far). */
export const HALO = 4.2;

/** Star radius on screen, px, for a world radius at `ppu` px per scene unit, grown by cursor proximity. */
export const starPx = (radius: number, ppu: number, prox: number) =>
  Math.min(MAX_PX, Math.max(MIN_PX, Math.pow(radius * ppu, 0.82) * 1.1)) * (1 + 0.28 * prox);

/** Far stars fade: 1 near the focus, down to 0.4 well behind it. */
export const depthFade = (depth: number, focus: number) => {
  const t = Math.min(1, Math.max(0, (depth - focus * 0.75) / (focus * 1.4)));
  return 1 - 0.6 * t * t * (3 - 2 * t);
};

/** 3b1b's `smooth`: an ease with zero slope at both ends. */
export const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent approach factor for rate `k` per second. */
export const approach = (dt: number, k: number) => 1 - Math.exp(-Math.min(dt, 0.1) * k);

// ── Shaders ──────────────────────────────────────────────────────────────────

const SIZE_GLSL = /* glsl */ `
  uniform float uViewH;
  uniform float uTanHalf;
  uniform float uDpr;
  uniform float uFocus;
  float depthFade(float d) {
    float t = clamp((d - uFocus * 0.75) / (uFocus * 1.4), 0.0, 1.0);
    return 1.0 - 0.6 * t * t * (3.0 - 2.0 * t);
  }
`;

export const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aRadius;
  attribute float aProx;
  attribute float aHollow;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPx;
  varying float vProx;
  varying float vHollow;
  ${SIZE_GLSL}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-mv.z, 0.001);
    float ppu = uViewH / (2.0 * depth * uTanHalf);
    // Sublinear in perspective: stars grow as you approach, but never into plates.
    float px = clamp(pow(aRadius * ppu, 0.82) * 1.1, ${MIN_PX.toFixed(2)}, ${MAX_PX.toFixed(2)}) * (1.0 + 0.28 * aProx);
    vPx = px;
    vColor = aColor;
    vProx = aProx;
    vHollow = aHollow;
    vAlpha = aAlpha * mix(depthFade(depth), 1.0, aProx);
    gl_PointSize = px * ${HALO.toFixed(2)} * 2.0 * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

export const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPx;
  varying float vProx;
  varying float vHollow;
  void main() {
    // r in core radii from the star's center.
    float r = length(gl_PointCoord - 0.5) * 2.0 * ${HALO.toFixed(2)};
    float aa = 1.2 / vPx;
    float glow = exp(-r * r / 2.0) * 0.3 + exp(-r * 1.15) * 0.1;
    glow *= (1.0 + 1.1 * vProx) * (1.0 - 0.75 * vHollow);
    float core = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    if (vHollow > 0.5) {
      // A ghost: a thin ring, no fill.
      float inner = smoothstep(0.62 - aa, 0.62 + aa, r);
      core *= inner * 0.85;
    }
    float hot = (1.0 - smoothstep(0.0, 0.42, r)) * (1.0 - vHollow);
    // A lit orb: white-hot center, the color in the body, a darker limb.
    float limb = mix(1.0, 0.62, smoothstep(0.45, 1.0, r));
    vec3 c = mix(vColor * limb * (0.85 + 0.25 * vProx), vec3(1.0), hot * (0.5 + 0.3 * vProx));
    float a = max(core, glow * (1.0 - core));
    vec3 col = mix(vColor * glow, c, core);
    if (a * vAlpha < 0.004) discard;
    // Pure light: added to the color, nothing to coverage (the canvas is
    // transparent over the sky canvas, so this composites as glow).
    gl_FragColor = vec4(col * vAlpha, 0.0);
  }
`;

export const NEBULA_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  varying vec3 vColor;
  varying float vAlpha;
  ${SIZE_GLSL}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-mv.z, 0.001);
    float ppu = uViewH / (2.0 * depth * uTanHalf);
    float px = aSize * ppu;
    // Thin out as the camera dives into a cloud, so it never fogs the stars.
    float near = clamp(1.6 - px / (uViewH * 0.55), 0.15, 1.0);
    vColor = aColor;
    vAlpha = aAlpha * near * depthFade(depth);
    gl_PointSize = min(px * 2.0, 2048.0) * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

export const NEBULA_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float k = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
    if (k * vAlpha < 0.002) discard;
    gl_FragColor = vec4(vColor * k * vAlpha, 0.0);
  }
`;

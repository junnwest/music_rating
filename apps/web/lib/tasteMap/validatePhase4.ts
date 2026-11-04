/**
 * Phase 4 additions to lib/tasteMap/validate.ts (owned separately): parsed name
 * and color values for group create/patch, and a size-capped JSON body reader.
 * The building blocks (isUuid, isNodeKey, isVec3, …) come from validate.ts and
 * are re-exported so the Phase 4 modules import from one place.
 */
import { isGroupName, isHexColor, MAX_NAME_LENGTH, type Validated } from './validate';

export { isHexColor, isNodeKey, isPlainObject, isUuid, isVec3, validatePositions } from './validate';
export type Parsed<T> = Validated<T>;

/** Request bodies above this are rejected before parsing (2000 positions ≈ 150 KB). */
export const MAX_BODY_BYTES = 1_000_000;

/** A group name: trimmed, 1–60 characters. */
export function parseName(v: unknown): Parsed<string> {
  return isGroupName(v) ? { ok: true, value: v.trim() } : { ok: false, error: `name must be 1–${MAX_NAME_LENGTH} characters` };
}

export function parseColor(v: unknown): Parsed<string> {
  return isHexColor(v) ? { ok: true, value: v } : { ok: false, error: 'color must be #RRGGBB' };
}

/** The JSON body; an empty body reads as {}. Fails when too large or not JSON. */
export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Parsed<unknown>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) return { ok: false, error: 'body too large' };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, error: 'could not read body' };
  }
  if (text.length > maxBytes) return { ok: false, error: 'body too large' };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

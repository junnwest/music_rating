import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Loads Plus Jakarta Sans (the site's only typeface, apps/web/app/layout.tsx)
// for next/og's ImageResponse. next/font's normal CSS injection doesn't
// apply here -- Satori (the renderer behind ImageResponse) needs the raw
// font bytes passed explicitly via the `fonts` option instead, or OG/share
// cards silently fall back to a system font and read as a different product
// from the rest of the site.
//
// Read via node:fs rather than `fetch(new URL(..., import.meta.url))` --
// the fetch-URL pattern is Vercel's own documented approach for *edge*
// routes, but fails locally under `next dev` (fetch to the resolved
// file:// URL throws) with no way to verify from here whether it actually
// works against a real Vercel deployment either. Callers must run on the
// Node.js runtime (the default -- don't add `export const runtime = 'edge'`)
// for `node:fs` to be available.
const WEIGHTS: { weight: 500 | 600 | 700 | 800; file: string }[] = [
  { weight: 500, file: 'PlusJakartaSans-Medium.ttf' },
  { weight: 600, file: 'PlusJakartaSans-SemiBold.ttf' },
  { weight: 700, file: 'PlusJakartaSans-Bold.ttf' },
  { weight: 800, file: 'PlusJakartaSans-ExtraBold.ttf' },
];

export async function loadJakartaFonts() {
  return Promise.all(
    WEIGHTS.map(async ({ weight, file }) => ({
      name: 'Plus Jakarta Sans',
      data: await readFile(path.join(process.cwd(), 'assets/fonts', file)),
      weight,
      style: 'normal' as const,
    }))
  );
}

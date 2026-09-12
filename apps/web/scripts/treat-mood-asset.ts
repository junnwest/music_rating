/**
 * Applies the shared mood-asset treatment (crop-fill + brand-color tint) to
 * a single hand-picked raw photo, producing a poster-ready asset.
 *
 * Run this after reviewing candidates from fetch-mood-assets-stock.ts or
 * generate-mood-assets-ai.ts and picking the best one by hand — this script
 * does no picking of its own, on purpose.
 *
 * Run:
 *   npx tsx scripts/treat-mood-asset.ts \
 *     --in=scripts/output/mood-assets/raw/vinyl-record-close-up-abc123.jpg \
 *     --out=scripts/output/mood-assets/treated/vinyl-record-rust.jpg \
 *     --field-color=#402015 \
 *     --ratio=4:5
 */

import path from 'path';
import { applyMoodTreatment } from './mood-asset-treatment';

function arg(name: string): string | undefined {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  return flag?.slice(name.length + 3);
}

const inPath = arg('in');
const outPath = arg('out');
const fieldColor = arg('field-color');
const ratioArg = arg('ratio') ?? '4:5';
const tintArg = arg('tint');

if (!inPath || !outPath || !fieldColor) {
  console.error(
    'Usage: tsx scripts/treat-mood-asset.ts --in=<path> --out=<path> --field-color=<hex> [--ratio=4:5] [--tint=0.35]',
  );
  process.exit(1);
}

const [rw, rh] = ratioArg.split(':').map(Number);
if (!rw || !rh) {
  console.error(`Invalid --ratio "${ratioArg}", expected e.g. "4:5"`);
  process.exit(1);
}

const outExt = path.extname(outPath).slice(1);
if (!outExt) {
  console.error('--out must include a file extension, e.g. .jpg');
  process.exit(1);
}

applyMoodTreatment(inPath, outPath as `${string}.${string}`, {
  fieldColorHex: fieldColor,
  cropRatio: rw / rh,
  tintAmount: tintArg ? Number(tintArg) : undefined,
})
  .then(() => console.log(`Wrote ${outPath}`))
  .catch((err) => {
    console.error('Treatment failed:', err);
    process.exit(1);
  });

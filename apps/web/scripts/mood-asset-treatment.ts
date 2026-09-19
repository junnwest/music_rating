/**
 * Shared post-processing for mood/object photography (stock or AI-sourced)
 * before it enters the poster system — crops to the poster's art-slot ratio
 * and tints toward a target field color, so images from different sources
 * still read as one visual system. Grain/texture is applied in the poster
 * template at render time, not baked in here.
 *
 * Used by treat-mood-asset.ts. Not runnable directly.
 */

import { Jimp } from 'jimp';

export interface TreatmentOptions {
  /** Target field color to tint toward, e.g. '#2979B7'. */
  fieldColorHex: string;
  /** Crop ratio as width/height, e.g. 4/5 for the 1080x1350 poster art slot. */
  cropRatio: number;
  /** 0 = no tint, 1 = fully replaced by fieldColor. Default 0.35. */
  tintAmount?: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const int = parseInt(clean, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export async function applyMoodTreatment(
  inputPath: string,
  outputPath: `${string}.${string}`,
  opts: TreatmentOptions,
): Promise<void> {
  const { fieldColorHex, cropRatio, tintAmount = 0.35 } = opts;
  const image = await Jimp.read(inputPath);

  // Crop-fill to the poster's art-slot aspect ratio (no letterboxing).
  const targetW = 1200;
  const targetH = Math.round(targetW / cropRatio);
  image.cover({ w: targetW, h: targetH });

  // Tint toward the poster's field color so stock/AI images from different
  // sources still read as one palette instead of a scrapbook of borrowed photos.
  image.color([{ apply: 'mix', params: [hexToRgb(fieldColorHex), Math.round(tintAmount * 100)] }]);

  await image.write(outputPath);
}

import type { ImageAdjust } from '@/types/document';

/**
 * Apply brightness / contrast / gamma / threshold / invert to a grey value.
 * This is shared by the GCode rasteriser and the Adjust Image preview so both
 * stay pixel-identical.
 */
export function applyImageAdjust(gray: number, adjust?: ImageAdjust): number {
  if (!adjust) return gray;
  let v = gray;
  v += (adjust.brightness / 100) * 255;

  const c = Math.max(-100, Math.min(100, adjust.contrast)) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  v = factor * (v - 128) + 128;

  const gamma = Math.max(0.05, adjust.gamma || 1);
  v = 255 * Math.pow(Math.max(0, Math.min(1, v / 255)), 1 / gamma);

  if (adjust.invert) v = 255 - v;
  if (adjust.threshold >= 0) v = v < adjust.threshold ? 0 : 255;
  return Math.max(0, Math.min(255, v));
}

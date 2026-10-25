import type { CurvePoint, ImageAdjust } from '@/types/document';

const clamp255 = (value: number): number => Math.max(0, Math.min(255, value));

/** Cache the 256-entry LUT per control-point array (stable while editing). */
const LUT_CACHE = new WeakMap<readonly CurvePoint[], Uint8ClampedArray>();

function sortedPoints(points: readonly CurvePoint[]): CurvePoint[] {
  const clean = points
    .map((p) => ({
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y)),
    }))
    .sort((a, b) => a.x - b.x);

  const unique: CurvePoint[] = [];
  for (const point of clean) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-4) last.y = point.y;
    else unique.push(point);
  }
  return unique;
}

/** Monotone-ish cubic Hermite interpolation through the curve points. */
function evaluateCurve(x: number, pts: CurvePoint[]): number {
  if (pts.length === 0) return x;
  if (pts.length === 1) return pts[0].y;
  if (x <= pts[0].x) return pts[0].y;
  const last = pts[pts.length - 1];
  if (x >= last.x) return last.y;

  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1].x) i += 1;

  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  const h = Math.max(p2.x - p1.x, 1e-6);
  const t = (x - p1.x) / h;
  const m1 = (p2.y - p0.y) / Math.max(p2.x - p0.x, 1e-6);
  const m2 = (p3.y - p1.y) / Math.max(p3.x - p1.x, 1e-6);
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    (2 * t3 - 3 * t2 + 1) * p1.y +
    (t3 - 2 * t2 + t) * h * m1 +
    (-2 * t3 + 3 * t2) * p2.y +
    (t3 - t2) * h * m2
  );
}

/** Build (and cache) a 256-entry lookup table for a tone curve. */
export function buildCurveLUT(points: readonly CurvePoint[]): Uint8ClampedArray {
  const cached = LUT_CACHE.get(points);
  if (cached) return cached;

  const pts = sortedPoints(points);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    const y = evaluateCurve(i / 255, pts);
    lut[i] = Math.round(Math.max(0, Math.min(1, y)) * 255);
  }
  LUT_CACHE.set(points, lut);
  return lut;
}

/** True when the curve is missing or effectively the identity line. */
export function isIdentityCurve(points?: readonly CurvePoint[] | null): boolean {
  if (!points || points.length < 2) return true;
  const sorted = sortedPoints(points);
  return sorted.every((p) => Math.abs(p.x - p.y) < 0.002);
}

/**
 * Apply brightness / contrast / gamma / levels / curve / threshold / invert to
 * a grey value. Shared by the GCode rasteriser and the Adjust Image preview so
 * both stay pixel-identical.
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

  const levels = adjust.levels;
  if (levels) {
    const black = Math.max(0, Math.min(255, levels.black));
    const white = Math.max(0, Math.min(255, levels.white));
    if (white - black >= 1) {
      v = ((clamp255(v) - black) / (white - black)) * 255;
    }
  }

  if (adjust.curve && adjust.curve.length >= 2) {
    const lut = buildCurveLUT(adjust.curve);
    v = lut[Math.round(clamp255(v))];
  }

  if (adjust.invert) v = 255 - v;
  if (adjust.threshold >= 0) v = v < adjust.threshold ? 0 : 255;
  return Math.max(0, Math.min(255, v));
}

import type { JobPlan, Pt } from '@/gcode/types';

/**
 * Index of the raster (engraved image) rows of a plan, precomputed once so the
 * Preview can reveal the image incrementally instead of rescanning every
 * segment on every animation frame.
 *
 * Rows are stored in playback order with the cumulative weight at which each
 * one starts. The screen-space bounding box is also cached: it only changes
 * when the view (pan/zoom) changes, not on every frame.
 */
export interface RasterRow {
  /** Cumulative weight before this row starts. */
  start: number;
  /** Weight this row contributes. */
  weight: number;
  /** Segment index in `plan.segments`. */
  segment: number;
  /** Whether the row is engraved from the last point to the first one. */
  fromRight: boolean;
}

export interface RasterIndex {
  rows: RasterRow[];
  /** Total weight of the whole plan (falls back to 1 so ratios stay finite). */
  total: number;
}

/** Screen-space rectangle, already padded for anti-aliasing. */
export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ToScreen = (p: Pt) => { x: number; y: number };

/**
 * Build the row index for every raster segment of the plan.
 *
 * `weights` is parallel to `plan.segments` (see `PreviewDialog`): it is the
 * same time-based value the playhead uses, so accumulated `start` values can
 * be compared directly against `progress * total`.
 */
export function buildRasterIndex(plan: JobPlan, weights: number[]): RasterIndex {
  const rows: RasterRow[] = [];
  let elapsed = 0;
  for (let i = 0; i < plan.segments.length; i += 1) {
    const seg = plan.segments[i];
    const w = weights[i] ?? 0;
    if (seg.kind === 'cut' && seg.powers && seg.points.length >= 2) {
      const points = seg.points;
      rows.push({
        start: elapsed,
        weight: w,
        segment: i,
        fromRight: points[points.length - 1].x >= points[0].x,
      });
    }
    elapsed += w;
  }
  return { rows, total: elapsed || 1 };
}

/**
 * How many rows are fully engraved at `progress` (0..1), plus the fraction of
 * the next row that is already engraved. Binary search keeps it O(log n).
 */
export function revealCount(index: RasterIndex, progress: number): { done: number; frac: number } {
  const { rows, total } = index;
  if (rows.length === 0) return { done: 0, frac: 0 };
  const target = Math.max(0, Math.min(1, progress)) * total;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (row.start + row.weight <= target + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= rows.length) return { done: rows.length, frac: 0 };
  const next = rows[lo];
  const frac = next.weight > 0 ? Math.max(0, Math.min(1, (target - next.start) / next.weight)) : 0;
  return { done: lo, frac };
}

/** Bounding box of a scan line in screen space, padded by one pixel. */
export function rasterLineBox(points: Pt[], toScreen: ToScreen): ScreenBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const s = toScreen(p);
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  const pad = 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Cache the bounding box of every indexed row. Called once per view change;
 * `revealRasterInto` then never has to walk a scan line again.
 */
export function rasterBoxes(plan: JobPlan, index: RasterIndex, toScreen: ToScreen): ScreenBox[] {
  return index.rows.map((row) => rasterLineBox(plan.segments[row.segment].points, toScreen));
}

/**
 * Blend one engraved dot into an RGBA buffer ("source over").
 *
 * Pixels go through an `ImageData` buffer instead of a `fillRect` per point:
 * a large image used to need two rasterised rectangles per engraved point,
 * which dominated both opening and panning the Preview.
 *
 * `width`/`height` are the buffer size in pixels; out-of-range dots (and dots
 * with zero power) are skipped so a plan slightly outside the bed is safe.
 */
export function blendDot(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: { r: number; g: number; b: number; a: number },
): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const a = color.a;
  if (a <= 0 || xi < 0 || yi < 0 || xi >= width || yi >= height) return;
  const o = (yi * width + xi) * 4;
  const dst = data[o + 3] / 255;
  const outA = a + dst * (1 - a);
  if (outA <= 0) return;
  const keep = dst * (1 - a);
  data[o] = (color.r * a + data[o] * keep) / outA;
  data[o + 1] = (color.g * a + data[o + 1] * keep) / outA;
  data[o + 2] = (color.b * a + data[o + 2] * keep) / outA;
  data[o + 3] = outA * 255;
}

/**
 * Copy the rows between `from` (exclusive) and `to` (inclusive) from the
 * pre-rendered `layer` into `out`. The `to` row is copied sideways up to
 * `frac` of its width, which is how a partially engraved scan line looks.
 *
 * Nothing is redrawn: each row is one `drawImage` over its cached box, so the
 * cost of a frame depends on how many rows are new, not on the plan size.
 */
export function copyRevealedRows(
  out: CanvasRenderingContext2D,
  layer: CanvasImageSource,
  boxes: ScreenBox[],
  rows: RasterRow[],
  from: number,
  to: number,
  frac: number,
): void {
  const last = Math.min(to, boxes.length - 1);
  for (let i = Math.max(0, from); i <= last; i += 1) {
    const box = boxes[i];
    if (box.w <= 0 || box.h <= 0) continue;
    if (i < to) {
      out.drawImage(layer, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    } else {
      const visible = box.w * Math.max(0, Math.min(1, frac));
      if (visible <= 0) continue;
      const sx = rows[i].fromRight ? box.x + box.w - visible : box.x;
      out.drawImage(layer, sx, box.y, visible, box.h, sx, box.y, visible, box.h);
    }
  }
}

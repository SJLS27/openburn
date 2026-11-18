import type { JobPlan, PlanSegment, Pt } from '@/gcode/types';
import { rasterRuns } from '@/gcode/rasterPreview';
import type { RasterGrid } from '@/gcode/rasterTexture';

/**
 * Geometry builder for the vector Preview.
 *
 * Everything here works in **world units** (mm, Y down). The preview SVG uses a
 * `viewBox` over the bed, so zoom and pan never rebuild these strings — that is
 * what makes an unlimited zoom stay crisp.
 */

/** Segments per path. Long `d` strings defeat the compositor's caching. */
export const CHUNK_SIZE = 5000;

export interface LodLevel {
  /** Douglas-Peucker tolerance in mm; 0 keeps the geometry untouched. */
  tolerance: number;
  /** Minimum on-screen length (mm at the current zoom) worth keeping. */
  minLength: number;
}

export type LodTier = 'far' | 'mid' | 'near';

/**
 * Pick the detail tier for a zoom level. `zoom` is the screen scale in
 * px-per-mm relative to the fitted view (1 = whole bed visible).
 */
export function lodFor(zoom: number): LodTier {
  if (zoom < 0.5) return 'far';
  if (zoom < 2) return 'mid';
  return 'near';
}

export const LOD_LEVELS: Record<LodTier, LodLevel> = {
  // At a glance only the shape matters: heavy simplification.
  far: { tolerance: 0.4, minLength: 0.6 },
  mid: { tolerance: 0.15, minLength: 0.2 },
  near: { tolerance: 0, minLength: 0 },
};

/** Number formatting: 3 decimals is ~1 µm at mm scale, invisible when zoomed. */
export function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

/**
 * Colour and alpha for an engraved pixel at `power` (0-100 %). Low power is a
 * dim orange, full power burns white-hot — the same ramp the bitmap preview
 * used, now expressed as an SVG stroke colour.
 */
export function rasterPowerColor(power: number): { r: number; g: number; b: number; a: number } {
  const p = Math.max(0, Math.min(100, Number.isFinite(power) ? power : 0)) / 100;
  const r = Math.round(190 + 65 * p);
  const g = Math.round(110 + 145 * p);
  const b = Math.round(60 + 195 * p);
  const a = 0.18 + 0.82 * Math.pow(p, 0.7);
  return { r, g, b, a };
}

/** `rgba()` string for a laser power, ready for an SVG `stroke`. */
export function rasterPowerCss(power: number): string {
  const { r, g, b, a } = rasterPowerColor(power);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Rasterised image texture for the preview, grounded in the same per-point
 * power the machine burns. `bbox` is the world (mm) rectangle the texture maps
 * onto inside the SVG `viewBox`; `pixels` is straight (non-premultiplied) RGBA
 * ready for `ImageData`. Cells with no power are transparent.
 */
export interface RasterTexture {
  width: number;
  height: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  pixels: Uint8ClampedArray;
}

/**
 * Convert a `RasterGrid` into an RGBA buffer, toned by the same warm power ramp
 * as the vector raster dashes. Higher power burns hotter and more opaque;
 * unburned cells stay fully transparent so the bed and toolpaths underneath
 * remain visible.
 */
export function gridToTexture(grid: RasterGrid): RasterTexture {
  const { width, height, power, bbox } = grid;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let p = 0;
  for (let i = 0; i < power.length; i += 1, p += 4) {
    const v = power[i];
    if (!(v > 0)) continue; // NaN and 0 stay transparent
    const { r, g, b, a } = rasterPowerColor(v);
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = Math.round(a * 255);
  }
  return { width, height, bbox, pixels };
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Douglas-Peucker simplification with an iterative stack, so a 50k-point
 * raster row cannot blow the call stack.
 */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (tolerance <= 0 || points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distToSegment(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Drop points closer than `minLength` to the previous kept one. */
export function thin(points: Pt[], minLength: number): Pt[] {
  if (minLength <= 0 || points.length <= 2) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minLength) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Apply the LOD level for a zoom to one polyline. */
export function simplifyFor(points: Pt[], zoom: number): Pt[] {
  const level = LOD_LEVELS[lodFor(zoom)];
  if (level.tolerance <= 0 && level.minLength <= 0) return points;
  return thin(simplify(points, level.tolerance), level.minLength);
}

/** SVG `d` for a polyline, in world units. */
export function polylinePath(points: Pt[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  const parts = [`M${fmt(first.x)} ${fmt(first.y)}`];
  for (let i = 1; i < points.length; i += 1) {
    parts.push(`L${fmt(points[i].x)} ${fmt(points[i].y)}`);
  }
  return parts.join('');
}

/** Split `d` strings into chunks of at most `size` subpaths. */
export function chunkPaths(paths: string[], size = CHUNK_SIZE): string[] {
  if (size <= 0) return paths.length ? [paths.join('')] : [];
  const out: string[] = [];
  for (let i = 0; i < paths.length; i += size) {
    out.push(paths.slice(i, i + size).join(''));
  }
  return out;
}

export interface LayerPaths {
  layerId: string;
  color: string;
  /** One string per chunk; each chunk is one `<path>`. */
  chunks: string[];
}

export interface PreviewGeometry {
  /** Dim toolpaths per layer (brightness applied by CSS). */
  toolpaths: LayerPaths[];
  /** Travel moves between cuts. */
  travel: string[];
  /** Bed rectangle, for the outline. */
  bed: { width: number; height: number };
}

export interface BuildGeometryOptions {
  zoom: number;
  colorByLayer: Map<string, string>;
  defaultColor: string;
  /** Skip rapid segments shorter than this (mm) — invisible anyway. */
  minRapidLength?: number;
}

/**
 * Build the static geometry once per (plan, zoom tier). The result feeds the
 * `<path>` elements of the Preview SVG.
 */
export function buildPreviewGeometry(
  plan: JobPlan,
  bed: { width: number; height: number },
  opts: BuildGeometryOptions,
): PreviewGeometry {
  const minRapid = opts.minRapidLength ?? 0.5;
  const byLayer = new Map<string, string[]>();
  const travel: string[] = [];

  let position: Pt | null = null;
  for (const seg of plan.segments) {
    if (seg.points.length === 0) continue;

    if (seg.kind === 'rapid') {
      const target = seg.points[0];
      if (position) {
        const dx = target.x - position.x;
        const dy = target.y - position.y;
        if (dx * dx + dy * dy > minRapid * minRapid) {
          travel.push(`M${fmt(position.x)} ${fmt(position.y)}L${fmt(target.x)} ${fmt(target.y)}`);
        }
      }
      position = target;
      continue;
    }

    position = seg.points[seg.points.length - 1];
    const layerId = seg.layerId ?? '';
    const points = simplifyFor(seg.points, opts.zoom);
    if (points.length < 2) continue;

    // Raster segments engrave individual pixels: the scan line would paint a
    // solid block, so only the lit runs are drawn.
    const runs = seg.powers ? rasterRuns(seg).map((r) => r.points) : [points];
    let bucket = byLayer.get(layerId);
    if (!bucket) {
      bucket = [];
      byLayer.set(layerId, bucket);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      bucket.push(polylinePath(run));
    }
  }

  const toolpaths: LayerPaths[] = [];
  for (const [layerId, paths] of byLayer) {
    toolpaths.push({
      layerId,
      color: opts.colorByLayer.get(layerId) ?? opts.defaultColor,
      chunks: chunkPaths(paths),
    });
  }

  return { toolpaths, travel: chunkPaths(travel), bed };
}

/**
 * Geometry of the already-engraved segments up to `count`. The Preview animates
 * by rebuilding only this slice when the playhead crosses a chunk boundary.
 */
export function completedPaths(
  plan: JobPlan,
  upTo: number,
  opts: BuildGeometryOptions,
): LayerPaths[] {
  const byLayer = new Map<string, string[]>();
  const end = Math.min(upTo, plan.segments.length);
  for (let i = 0; i < end; i += 1) {
    const seg: PlanSegment | undefined = plan.segments[i];
    if (!seg || seg.kind !== 'cut' || seg.points.length < 2) continue;
    const layerId = seg.layerId ?? '';
    const points = simplifyFor(seg.points, opts.zoom);
    const runs = seg.powers ? rasterRuns(seg).map((r) => r.points) : [points];
    let bucket = byLayer.get(layerId);
    if (!bucket) {
      bucket = [];
      byLayer.set(layerId, bucket);
    }
    for (const run of runs) {
      if (run.length >= 2) bucket.push(polylinePath(run));
    }
  }
  const out: LayerPaths[] = [];
  for (const [layerId, paths] of byLayer) {
    out.push({
      layerId,
      color: opts.colorByLayer.get(layerId) ?? opts.defaultColor,
      chunks: chunkPaths(paths),
    });
  }
  return out;
}

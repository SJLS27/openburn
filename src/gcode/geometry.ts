import paper from 'paper';
import { FabricImage, type FabricObject } from 'fabric';
import { ensurePaper } from '@/geometry/paperSetup';
import {
  objectToSceneCompoundPathData,
  objectToScenePathData,
  objectToScenePathItems,
} from '@/geometry/paperOps';
import { offsetPathData } from '@/geometry/offset';
import type { DitherMode, ImageAdjust } from '@/types/document';
import { applyImageAdjust } from '@/image/adjust';
import type { Pt } from './types';

export interface Contour {
  points: Pt[];
  closed: boolean;
}

export interface RasterRow {
  points: Pt[];
  powers: number[];
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) out.push(p);
  }
  return out;
}

function flattenItem(item: paper.PathItem, tolerance = 0.15): Contour[] {
  const paths: paper.Path[] = [];
  if (item instanceof paper.Path) {
    paths.push(item);
  } else if (item instanceof paper.CompoundPath) {
    for (const child of item.children ?? []) {
      if (child instanceof paper.Path) paths.push(child);
    }
  }

  const out: Contour[] = [];
  for (const path of paths) {
    const closed = (path as paper.Path).closed;
    try {
      (path as paper.Path).flatten(tolerance);
    } catch {
      /* flatten is best-effort */
    }
    const points = dedupe(
      (path as paper.Path).segments.map((s) => ({ x: s.point.x, y: s.point.y })),
    );
    if (points.length >= 2) out.push({ points, closed });
  }
  return out;
}

/**
 * A single compound path for the whole object. All sub-paths are kept together
 * so the even-odd rule turns nested sub-paths into holes (letter counters, a
 * rectangle with vectors inside, etc.).
 */
function sceneCompoundItem(obj: FabricObject): paper.CompoundPath | null {
  try {
    const data = objectToSceneCompoundPathData(obj);
    if (!data) return null;
    ensurePaper();
    const item = new paper.CompoundPath(data);
    item.fillRule = 'evenodd';
    item.fillColor = new paper.Color('black');
    item.strokeColor = null;
    return item;
  } catch {
    return null;
  }
}

export function objectContours(obj: FabricObject): Contour[] {
  try {
    const items = objectToScenePathItems(obj);
    if (items.length === 0) return [];
    const contours: Contour[] = [];
    for (const item of items) {
      contours.push(...flattenItem(item));
      item.remove();
    }
    return contours;
  } catch {
    return [];
  }
}

/** Scanline fill clipped to the object's filled silhouette (even-odd holes). */
export function hatchContours(
  obj: FabricObject,
  interval: number,
  overscan: number,
  angle = 0,
  crossHatch = false,
  scanOffset = 0,
): Contour[] {
  try {
    // One compound path for the whole object: nested sub-paths act as holes.
    const item = sceneCompoundItem(obj);
    if (!item) return [];
    const step = Math.max(0.02, interval);
    const angles = crossHatch ? [angle, angle + 90] : [angle];
    const out: Contour[] = [];
    for (const a of angles) {
      out.push(...hatchAtAngle(item, step, overscan, a, scanOffset));
    }
    item.remove();
    return out;
  } catch {
    return [];
  }
}

function hatchAtAngle(
  item: paper.PathItem,
  step: number,
  overscan: number,
  angle: number,
  scanOffset: number,
): Contour[] {
  const bounds = item.bounds;
  const theta = (angle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const nx = -uy;
  const ny = ux;
  const cx = bounds.left + bounds.width / 2;
  const cy = bounds.top + bounds.height / 2;
  const diagonal = Math.hypot(bounds.width, bounds.height) + overscan * 2 + step * 2;
  const count = Math.ceil(diagonal / step);
  const out: Contour[] = [];

  for (let k = -count / 2; k <= count / 2; k += 1) {
    const offset = k * step;
    const mx = cx + nx * offset;
    const my = cy + ny * offset;
    const half = diagonal / 2;
    const line = new paper.Path.Line(
      new paper.Point(mx - ux * half, my - uy * half),
      new paper.Point(mx + ux * half, my + uy * half),
    );
    const hits = item
      .getIntersections(line)
      .map((loc) => ({
        x: loc.point.x,
        y: loc.point.y,
        t: (loc.point.x - mx) * ux + (loc.point.y - my) * uy,
      }))
      .sort((a, b) => a.t - b.t);
    line.remove();

    for (let i = 0; i + 1 < hits.length; i += 2) {
      const a = hits[i];
      const b = hits[i + 1];
      if (b.t - a.t < 0.01) continue;
      let ax = a.x;
      let ay = a.y;
      let bx = b.x;
      let by = b.y;
      if (i === 0) {
        ax -= ux * overscan;
        ay -= uy * overscan;
      }
      if (i + 2 >= hits.length) {
        bx += ux * overscan;
        by += uy * overscan;
      }
      out.push({
        points: [
          { x: ax + ux * scanOffset, y: ay + uy * scanOffset },
          { x: bx + ux * scanOffset, y: by + uy * scanOffset },
        ],
        closed: false,
      });
    }
  }
  return out;
}

/** Flatten scene-space path data into cut contours (used for traced text). */
export function contoursFromPathData(pathData: string): Contour[] {
  try {
    ensurePaper();
    const item = new paper.CompoundPath(pathData);
    item.fillRule = 'evenodd';
    item.fillColor = new paper.Color('black');
    item.strokeColor = null;
    const contours = flattenItem(item);
    item.remove();
    return contours;
  } catch {
    return [];
  }
}

/** Scanline fill of scene-space path data (traced text in Fill mode). */
export function hatchPathData(
  pathData: string,
  interval: number,
  overscan: number,
  angle = 0,
  crossHatch = false,
  scanOffset = 0,
): Contour[] {
  try {
    ensurePaper();
    const item = new paper.CompoundPath(pathData);
    item.fillRule = 'evenodd';
    item.fillColor = new paper.Color('black');
    item.strokeColor = null;
    const out: Contour[] = [];
    const angles = crossHatch ? [angle, angle + 90] : [angle];
    for (const a of angles) {
      out.push(...hatchAtAngle(item, Math.max(0.02, interval), overscan, a, scanOffset));
    }
    item.remove();
    return out;
  } catch {
    return [];
  }
}

/** Concentric inward offsets, used for Offset Fill mode. */
export function offsetContours(
  obj: FabricObject,
  distance: number,
  baseContours: Contour[],
  pathData?: string,
): Contour[] {
  try {
    ensurePaper();
    const step = Math.max(0.05, distance);
    const out: Contour[] = [];
    let current = pathData ?? objectToScenePathData(obj);
    if (!current) return out;

  const box = obj.getBoundingRect();
  const maxSteps = Math.max(1, Math.floor(Math.min(box.width, box.height) / (2 * step)) + 1);

  for (let i = 0; i < Math.min(200, maxSteps); i += 1) {
    const next = offsetPathData(current, -step);
    if (!next) break;
    const item = new paper.CompoundPath(next);
    item.fillColor = new paper.Color('black');
    const contours = flattenItem(item, 0.3);
    item.remove();
    if (contours.length === 0) break;
    let maxSpan = 0;
    let totalArea = 0;
    for (const c of contours) {
      const xs = c.points.map((p) => p.x);
      const ys = c.points.map((p) => p.y);
      maxSpan = Math.max(maxSpan, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      totalArea += Math.abs(polygonArea(c.points));
    }
    // A collapsed or self-intersecting inset means we have reached the centre.
    if (totalArea < step * step * 0.5) break;
    out.push(...contours);
    current = next;
    if (maxSpan < step * 2) break;
  }

    return [...baseContours, ...out];
  } catch {
    return baseContours;
  }
}

function polygonArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Convert an image into continuous horizontal rows with per-point power.
 * Resolution is clamped so the generated GCode stays manageable.
 */
export function rasterRows(
  obj: FabricObject,
  interval: number,
  power: number,
  dither: DitherMode,
): RasterRow[] {
  if (!(obj instanceof FabricImage)) return [];
  const element = obj.getElement() as HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
  if (!element) return [];

  const naturalW =
    (element as HTMLImageElement).naturalWidth || (element as HTMLCanvasElement).width;
  const naturalH =
    (element as HTMLImageElement).naturalHeight || (element as HTMLCanvasElement).height;
  if (!naturalW || !naturalH) return [];

  const bbox = obj.getBoundingRect();
  if (bbox.width <= 0 || bbox.height <= 0) return [];

  const maxSamples = 360;
  const stepX = Math.max(interval, bbox.width / maxSamples);
  const stepY = Math.max(interval, bbox.height / maxSamples);

  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(element as CanvasImageSource, 0, 0, naturalW, naturalH);
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, naturalW, naturalH).data;
  } catch {
    return [];
  }

  const rows = Math.max(1, Math.floor(bbox.height / stepY));
  const cols = Math.max(1, Math.floor(bbox.width / stepX));
  const out: RasterRow[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const y = bbox.top + row * stepY;
    const py = Math.min(naturalH - 1, Math.floor((row * stepY * naturalH) / bbox.height));
    const reverse = row % 2 === 1;
    const points: Pt[] = [];
    const powers: number[] = [];
    let lit = false;

    for (let i = 0; i <= cols; i += 1) {
      const col = reverse ? cols - i : i;
      const px = Math.min(naturalW - 1, Math.floor((col * stepX * naturalW) / bbox.width));
      const idx = (py * naturalW + px) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const alpha = pixels[idx + 3] / 255;
      const rawGray = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
      const adjust = (obj as FabricObject & { imageAdjust?: ImageAdjust }).imageAdjust;
      const gray = applyImageAdjust(rawGray, adjust);

      let tone = 0;
      if (dither === 'none') {
        tone = Math.max(0, (255 - gray) / 255) * power;
        if (tone < power * 0.04) tone = 0;
      } else {
        const threshold = ((BAYER[row % 4][col % 4] + 0.5) / 16) * 255;
        tone = gray < threshold ? power : 0;
      }
      if (tone > 0) lit = true;
      points.push({ x: bbox.left + col * stepX, y });
      powers.push(Math.round(tone));
    }

    if (lit) out.push({ points, powers });
  }

  return out;
}

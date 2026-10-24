import paper from 'paper';
import { FabricImage, type FabricObject } from 'fabric';
import { ensurePaper } from '@/geometry/paperSetup';
import { objectToScenePathData } from '@/geometry/paperOps';
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

function sceneItem(obj: FabricObject): paper.CompoundPath | null {
  try {
    const data = objectToScenePathData(obj);
    if (!data) return null;
    ensurePaper();
    const item = new paper.CompoundPath(data);
    item.fillColor = new paper.Color('black');
    item.strokeColor = null;
    return item;
  } catch {
    return null;
  }
}

export function objectContours(obj: FabricObject): Contour[] {
  try {
    ensurePaper();
    const item = sceneItem(obj);
    if (!item) return [];
    const contours = flattenItem(item);
    item.remove();
    return contours.map((c) => ({ ...c, closed: true }));
  } catch {
    return [];
  }
}

/** Horizontal scanline fill clipped to the object's filled silhouette. */
export function hatchContours(
  obj: FabricObject,
  interval: number,
  overscan: number,
): Contour[] {
  try {
    const step = Math.max(0.02, interval);
    const item = sceneItem(obj);
    if (!item) return [];
    const bounds = item.bounds;
    const out: Contour[] = [];

  for (let y = bounds.top + step / 2; y <= bounds.bottom; y += step) {
    const line = new paper.Path.Line(
      new paper.Point(bounds.left - overscan - 1, y),
      new paper.Point(bounds.right + overscan + 1, y),
    );
    const crossings = item
      .getIntersections(line)
      .map((loc) => loc.point.x)
      .sort((a, b) => a - b);
    line.remove();

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      let x0 = crossings[i];
      let x1 = crossings[i + 1];
      if (x1 - x0 < 0.01) continue;
      if (i === 0) x0 -= overscan;
      if (i + 2 >= crossings.length) x1 += overscan;
      out.push({ points: [{ x: x0, y }, { x: x1, y }], closed: false });
    }
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
): Contour[] {
  try {
    ensurePaper();
    const step = Math.max(0.05, distance);
    const out: Contour[] = [];
    let current = objectToScenePathData(obj);
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

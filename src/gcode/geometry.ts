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
  bidirectional = true,
): Contour[] {
  try {
    // One compound path for the whole object: nested sub-paths act as holes.
    const item = sceneCompoundItem(obj);
    if (!item) return [];
    const step = Math.max(0.02, interval);
    const angles = crossHatch ? [angle, angle + 90] : [angle];
    const out: Contour[] = [];
    for (const a of angles) {
      out.push(...hatchAtAngle(item, step, overscan, a, scanOffset, bidirectional));
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
  bidirectional = true,
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
  let lineIndex = 0;

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
      const p1 = { x: ax + ux * scanOffset, y: ay + uy * scanOffset };
      const p2 = { x: bx + ux * scanOffset, y: by + uy * scanOffset };
      // Serpentine fill: alternate scan direction so consecutive lines can be
      // joined without a long travel move (LightBurn "Bi-directional Fill").
      const reverse = bidirectional && lineIndex % 2 === 1;
      lineIndex += 1;
      out.push({ points: reverse ? [p2, p1] : [p1, p2], closed: false });
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
  bidirectional = true,
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
      out.push(...hatchAtAngle(item, Math.max(0.02, interval), overscan, a, scanOffset, bidirectional));
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

export interface RasterOptions {
  interval: number;
  /** Max power (0-100). */
  power: number;
  /** Min power (0-100), used by Grayscale mode and ramp ends. */
  minPower: number;
  dither: DitherMode;
  bidirectional: boolean;
  negative: boolean;
  /** Shorten scan lines by this amount (mm) at both ends. */
  dotWidthCorrection: number;
  /** Engrave pre-processed images using their native pixel size. */
  passThrough: boolean;
  /** Power ramp length in mm at the ends of each scan line. */
  rampLength: number;
  rampOuter: boolean;
  cellsPerInch: number;
  halftoneAngle: number;
}

type Kernel = { dx: number; dy: number; weight: number }[];

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER8 = (() => {
  const out: number[][] = [];
  for (let y = 0; y < 8; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < 8; x += 1) {
      let v = 0;
      let xx = x;
      let yy = y;
      for (let bit = 0; bit < 3; bit += 1) {
        v = v * 4 + ((xx & 1) ^ (yy & 1)) * 2 + (((xx >> 1) & 1) ^ ((yy >> 1) & 1));
        xx >>= 1;
        yy >>= 1;
      }
      row.push(v);
    }
    out.push(row);
  }
  return out;
})();

const DIFFUSION_KERNELS: Record<string, { kernel: Kernel; divisor: number }> = {
  dither: {
    divisor: 16,
    kernel: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: -1, dy: 1, weight: 3 },
      { dx: 0, dy: 1, weight: 5 },
      { dx: 1, dy: 1, weight: 1 },
    ],
  },
  atkinson: {
    divisor: 8,
    kernel: [
      { dx: 1, dy: 0, weight: 1 },
      { dx: 2, dy: 0, weight: 1 },
      { dx: -1, dy: 1, weight: 1 },
      { dx: 0, dy: 1, weight: 1 },
      { dx: 1, dy: 1, weight: 1 },
      { dx: 0, dy: 2, weight: 1 },
    ],
  },
  stucki: {
    divisor: 42,
    kernel: [
      { dx: 1, dy: 0, weight: 8 },
      { dx: 2, dy: 0, weight: 4 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 8 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 2 },
      { dx: 0, dy: 2, weight: 4 },
      { dx: 1, dy: 2, weight: 2 },
      { dx: 2, dy: 2, weight: 1 },
    ],
  },
  jarvis: {
    divisor: 48,
    kernel: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: 2, dy: 0, weight: 5 },
      { dx: -2, dy: 1, weight: 3 },
      { dx: -1, dy: 1, weight: 5 },
      { dx: 0, dy: 1, weight: 7 },
      { dx: 1, dy: 1, weight: 5 },
      { dx: 2, dy: 1, weight: 3 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 3 },
      { dx: 0, dy: 2, weight: 5 },
      { dx: 1, dy: 2, weight: 3 },
      { dx: 2, dy: 2, weight: 1 },
    ],
  },
};

/** Error-diffusion dithering over the grayscale matrix (in place). */
function diffuse(gray: Float32Array, w: number, h: number, mode: string): Uint8Array {
  const spec = DIFFUSION_KERNELS[mode];
  const work = Float32Array.from(gray);
  const fire = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x;
      const old = work[index];
      const next = old < 128 ? 0 : 255;
      fire[index] = next === 0 ? 1 : 0;
      const error = old - next;
      if (error === 0) continue;
      for (const k of spec.kernel) {
        const nx = x + k.dx;
        const ny = y + k.dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        work[ny * w + nx] += (error * k.weight) / spec.divisor;
      }
    }
  }
  return fire;
}

/**
 * Convert an image into continuous horizontal rows with per-point power.
 * Supports LightBurn's image modes (threshold, ordered, Atkinson, dither,
 * Stucki, Jarvis, newsprint, halftone, sketch and grayscale). Resolution is
 * clamped so the generated GCode stays manageable.
 */
export function rasterRows(obj: FabricObject, opts: RasterOptions): RasterRow[] {
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

  const interval = Math.max(0.01, opts.interval);
  const maxSamples = 720;
  let stepX = Math.max(interval, bbox.width / maxSamples);
  let stepY = Math.max(interval, bbox.height / maxSamples);

  const MAX_RASTER_SIDE = 1600;
  const TILE_HEIGHT = 256;
  const rasterScale = Math.min(1, MAX_RASTER_SIDE / Math.max(naturalW, naturalH));
  const rasterW = Math.max(1, Math.round(naturalW * rasterScale));
  const rasterH = Math.max(1, Math.round(naturalH * rasterScale));

  // Pass-through keeps the image's native pixel pitch.
  if (opts.passThrough) {
    stepX = bbox.width / rasterW;
    stepY = bbox.height / rasterH;
  }

  const tileHeight = Math.min(TILE_HEIGHT, rasterH);
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = rasterW;
  tileCanvas.height = tileHeight;
  const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
  if (!tileCtx) return [];

  let tileTop = -1;
  let tilePixels: Uint8ClampedArray | null = null;
  const sample = (px: number, py: number): number | null => {
    const top = Math.floor(py / tileHeight) * tileHeight;
    if (top !== tileTop) {
      const srcY = top / rasterScale;
      const rows = Math.min(tileHeight, rasterH - top);
      const srcH = Math.min(naturalH - srcY, rows / rasterScale);
      tileCtx.clearRect(0, 0, rasterW, tileHeight);
      try {
        tileCtx.drawImage(
          element as CanvasImageSource,
          0,
          srcY,
          naturalW,
          srcH,
          0,
          0,
          rasterW,
          rows,
        );
        tilePixels = tileCtx.getImageData(0, 0, rasterW, rows).data;
      } catch {
        return null;
      }
      tileTop = top;
    }
    if (!tilePixels) return null;
    const offset = ((py - top) * rasterW + px) * 4;
    const alpha = tilePixels[offset + 3] / 255;
    const luma =
      0.299 * tilePixels[offset] + 0.587 * tilePixels[offset + 1] + 0.114 * tilePixels[offset + 2];
    return luma * alpha + 255 * (1 - alpha);
  };

  const rows = Math.max(1, Math.floor(bbox.height / stepY));
  const cols = Math.max(1, Math.floor(bbox.width / stepX));
  const adjust = (obj as FabricObject & { imageAdjust?: ImageAdjust }).imageAdjust;
  const gw = cols + 1;
  const gh = rows + 1;
  const gray = new Float32Array(gw * gh);

  for (let row = 0; row < gh; row += 1) {
    const py = Math.min(rasterH - 1, Math.floor((row * stepY * rasterH) / bbox.height));
    for (let col = 0; col < gw; col += 1) {
      const px = Math.min(rasterW - 1, Math.floor((col * stepX * rasterW) / bbox.width));
      const raw = sample(px, py);
      if (raw === null) return [];
      let value = applyImageAdjust(raw, adjust);
      if (opts.negative) value = 255 - value;
      gray[row * gw + col] = value;
    }
  }

  const mode = opts.dither;
  const power = opts.power;
  const minPower = Math.min(opts.minPower, power);

  // Build the tone matrix (0..power per sample).
  const tones = new Float32Array(gw * gh);

  if (mode === 'none') {
    for (let i = 0; i < tones.length; i += 1) {
      let tone = ((255 - gray[i]) / 255) * power;
      if (tone < power * 0.04) tone = 0;
      tones[i] = tone;
    }
  } else if (mode === 'grayscale') {
    for (let i = 0; i < tones.length; i += 1) {
      tones[i] = minPower + (power - minPower) * (1 - gray[i] / 255);
    }
  } else if (mode === 'threshold') {
    for (let i = 0; i < tones.length; i += 1) tones[i] = gray[i] < 128 ? power : 0;
  } else if (mode === 'ordered' || mode === 'newsprint') {
    const matrix = mode === 'newsprint' ? BAYER8 : BAYER4;
    const size = matrix.length;
    const levels = size * size;
    for (let row = 0; row < gh; row += 1) {
      for (let col = 0; col < gw; col += 1) {
        const threshold = ((matrix[row % size][col % size] + 0.5) / levels) * 255;
        tones[row * gw + col] = gray[row * gw + col] < threshold ? power : 0;
      }
    }
  } else if (mode === 'halftone') {
    const mmPerPixelX = bbox.width / cols;
    const mmPerPixelY = bbox.height / rows;
    const cellMm = 25.4 / Math.max(1, opts.cellsPerInch);
    const angle = (opts.halftoneAngle * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let row = 0; row < gh; row += 1) {
      for (let col = 0; col < gw; col += 1) {
        const xmm = col * mmPerPixelX;
        const ymm = row * mmPerPixelY;
        const rx = xmm * cos + ymm * sin;
        const ry = -xmm * sin + ymm * cos;
        const cx = Math.floor(rx / cellMm) + 0.5;
        const cy = Math.floor(ry / cellMm) + 0.5;
        const dist = Math.hypot(rx / cellMm - cx, ry / cellMm - cy) * 2;
        const coverage = 1 - gray[row * gw + col] / 255;
        tones[row * gw + col] = dist < Math.sqrt(coverage / Math.PI) * 1.25 ? power : 0;
      }
    }
  } else if (mode === 'sketch') {
    for (let row = 0; row < gh; row += 1) {
      for (let col = 0; col < gw; col += 1) {
        const i = row * gw + col;
        const right = gray[row * gw + Math.min(gw - 1, col + 1)];
        const down = gray[Math.min(gh - 1, row + 1) * gw + col];
        const grad = Math.abs(gray[i] - right) + Math.abs(gray[i] - down);
        tones[i] = grad > 28 ? power * Math.min(1, grad / 90) : 0;
      }
    }
  } else {
    // Error diffusion modes.
    const fire = diffuse(gray, gw, gh, mode in DIFFUSION_KERNELS ? mode : 'dither');
    for (let i = 0; i < tones.length; i += 1) tones[i] = fire[i] ? power : 0;
  }

  const out: RasterRow[] = [];

  for (let row = 0; row < gh; row += 1) {
    // Unidirectional scanning: every row is engraved left-to-right, with the
    // return to the next row's start being a laser-off rapid.
    const y = bbox.top + row * stepY;
    const reverse = opts.bidirectional && row % 2 === 1;
    const points: Pt[] = [];
    const powers: number[] = [];
    let lit = false;

    for (let i = 0; i < gw; i += 1) {
      const col = reverse ? gw - 1 - i : i;
      const tone = Math.round(tones[row * gw + col]);
      const x = bbox.left + col * stepX;
      points.push({ x, y });
      powers.push(Math.max(0, Math.min(power, tone)));
      if (tone > 0) lit = true;
    }

    if (!lit) continue;

    // Dot width correction: trim the engraved line at both ends.
    if (opts.dotWidthCorrection > 0 && points.length > 2) {
      const correction = Math.min(opts.dotWidthCorrection, stepX * (points.length - 2));
      if (correction > 0) {
        const dir = points[points.length - 1].x >= points[0].x ? 1 : -1;
        points[0] = { x: points[0].x + correction * dir, y: points[0].y };
        const last = points[points.length - 1];
        points[points.length - 1] = { x: last.x - correction * dir, y: last.y };
      }
    }

    // Ramp the power at the ends of each scan line (rubber stamp mode).
    if (opts.rampLength > 0 && points.length > 1) {
      applyPowerRamp(points, powers, power, minPower, opts.rampLength);
    }

    out.push({ points, powers });
  }

  return out;
}

/** Linearly ramp power from `minPower` up to `power` over `rampLength` mm. */
export function applyPowerRamp(
  points: Pt[],
  powers: number[],
  power: number,
  minPower: number,
  rampLength: number,
): void {
  if (points.length < 2 || rampLength <= 0) return;
  const total = points.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)),
    0,
  );
  const ramp = Math.min(rampLength, total / 2);
  if (ramp <= 0) return;
  let walked = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) walked += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const fromStart = Math.min(1, walked / ramp);
    const fromEnd = Math.min(1, (total - walked) / ramp);
    const factor = Math.min(fromStart, fromEnd);
    powers[i] = Math.round(minPower + (power - minPower) * factor);
  }
}

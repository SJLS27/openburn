import type { JobPlan, PlanSegment, Pt } from './types';
import { powerForMove } from './rasterPreview';

/**
 * Reconstructs the engraved raster image as a power grid, so the toolpath
 * preview can show an image the way the laser actually burns it instead of a
 * stack of 1 px hairlines.
 *
 * The preview consumes the *same* `JobPlan` the machine runs: each raster
 * segment carries `points` (one per scan column) and `powers` (the laser power
 * applied for the move *into* that point, following `powerForMove`). Rebuilding
 * a grid from those segments means the pixels here can never disagree with the
 * emitted G-code.
 */

/** Maximum number of cells along the longest side of the reconstructed grid. */
export const MAX_GRID_SIDE = 1024;

/**
 * A reconstructed raster image. `power[i]` is the effective laser power
 * (0..100) at column `i % width`, row `floor(i / width)`, in world units.
 * Cells the laser never touched are 0 (nothing burned).
 */
export interface RasterGrid {
  width: number;
  height: number;
  /** Effective power per cell, 0..100. */
  power: Float32Array;
  /** World (mm) extent of the grid, aligned to the plan bounds. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Build a power grid from the raster (image-mode) segments of a plan.
 *
 * Non-raster segments (plain cuts and rapids) are ignored: they are drawn
 * separately as vector toolpaths. When `upTo` is given, only raster segments
 * strictly before that segment index are stamped, so the preview can reveal the
 * engraving progressively as the playhead advances.
 *
 * Returns `null` when there is nothing to rasterise or the extent is empty.
 */
export function buildRasterGrid(plan: JobPlan, upTo?: number): RasterGrid | null {
  const limit = upTo === undefined ? plan.segments.length : Math.min(upTo, plan.segments.length);
  const raster: PlanSegment[] = [];
  for (let idx = 0; idx < limit; idx += 1) {
    const seg = plan.segments[idx];
    if (seg.kind === 'cut' && seg.powers && seg.powers.length > 0 && seg.points.length > 1) {
      raster.push(seg);
    }
  }
  if (raster.length === 0) return null;

  // Size the grid from the raster image's own extent (not the whole plan, which
  // may include vector objects elsewhere on the bed).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of raster) {
    for (const p of seg.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;

  const rawW = maxX - minX;
  const rawH = maxY - minY;

  // Widen zero-width/height axes to at least one cell.
  const cell = resolveCellFor(raster, { width: rawW, height: rawH });
  const bbox = {
    minX,
    minY,
    maxX: rawW < cell ? minX + cell : maxX,
    maxY: rawH < cell ? minY + cell : maxY,
  };

  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;

  // `ceil` so the grid covers the full span even when it is not an exact
  // multiple of the cell size (a point at the max edge clamps into the last
  // cell rather than being dropped).
  const gridW = Math.max(1, Math.ceil(width / cell));
  const gridH = Math.max(1, Math.ceil(height / cell));

  const grid: RasterGrid = {
    width: gridW,
    height: gridH,
    power: new Float32Array(gridW * gridH),
    bbox,
  };

  // Stamp each lit move onto the cells it crosses so intermediate columns are
  // covered even when the scan step is larger than one cell.
  for (const seg of raster) {
    for (let i = 1; i < seg.points.length; i += 1) {
      const power = powerForMove(seg.powers, i);
      if (power <= 0) continue;
      stampMove(grid, seg.points[i - 1], seg.points[i], power);
    }
  }

  return grid;
}

function resolveCellFor(
  raster: PlanSegment[],
  bbox: { width: number; height: number },
): number {
  let minStepX = Infinity;
  let minStepY = Infinity;
  for (const seg of raster) {
    for (let i = 1; i < seg.points.length; i += 1) {
      const dx = Math.abs(seg.points[i].x - seg.points[i - 1].x);
      const dy = Math.abs(seg.points[i].y - seg.points[i - 1].y);
      if (dx > 1e-9) minStepX = Math.min(minStepX, dx);
      if (dy > 1e-9) minStepY = Math.min(minStepY, dy);
    }
  }
  if (!Number.isFinite(minStepX)) minStepX = bbox.width || 1;
  if (!Number.isFinite(minStepY)) minStepY = bbox.height || 1;

  const finest = Math.min(minStepX, minStepY);
  const neededX = bbox.width / finest;
  const neededY = bbox.height / finest;
  const limit = Math.max(neededX, neededY);
  if (limit <= MAX_GRID_SIDE) return finest;
  return Math.max(finest, bbox.width / MAX_GRID_SIDE, bbox.height / MAX_GRID_SIDE);
}

function stampMove(grid: RasterGrid, from: Pt, to: Pt, power: number): void {
  const { width, height, bbox } = grid;
  const cellW = (bbox.maxX - bbox.minX) / width;
  const cellH = (bbox.maxY - bbox.minY) / height;

  const x0 = (from.x - bbox.minX) / cellW;
  const y0 = (from.y - bbox.minY) / cellH;
  const x1 = (to.x - bbox.minX) / cellW;
  const y1 = (to.y - bbox.minY) / cellH;

  const span = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  // One sample per cell crossed, centred on the cells themselves. Sampling the
  // centre (not the endpoints) keeps a move that ends on a cell boundary from
  // lighting the neighbour cell it never actually reached.
  const steps = Math.max(1, Math.ceil(span));
  for (let s = 0; s < steps; s += 1) {
    const t = (s + 0.5) / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t);
    const cy = Math.floor(y0 + (y1 - y0) * t);
    const ccx = cx < 0 ? 0 : cx >= width ? width - 1 : cx;
    const ccy = cy < 0 ? 0 : cy >= height ? height - 1 : cy;
    const idx = ccy * width + ccx;
    grid.power[idx] = Math.max(grid.power[idx], power);
  }
}

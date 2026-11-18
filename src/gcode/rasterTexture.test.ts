import { describe, expect, it } from 'vitest';
import { buildRasterGrid, MAX_GRID_SIDE, type RasterGrid } from './rasterTexture';
import type { JobPlan, PlanSegment } from './types';

// @vitest-environment node

function cut(points: PlanSegment['points'], powers: number[], extra?: Partial<PlanSegment>): PlanSegment {
  return { kind: 'cut', points, powers, power: 100, feed: 1200, ...extra };
}

function plan(segments: PlanSegment[], bounds?: JobPlan['bounds']): JobPlan {
  const xs = segments.flatMap((s) => s.points.map((p) => p.x));
  const ys = segments.flatMap((s) => s.points.map((p) => p.y));
  const b =
    bounds ??
    ({
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    } as JobPlan['bounds']);
  return {
    segments,
    bounds: b,
    gcode: [],
    timeSeconds: 1,
    cutDistance: 1,
    rapidDistance: 0,
    layerStats: [],
    lineCount: 0,
    warnings: [],
  };
}

/** World (x, y) → grid cell index, mirroring `stampMove`'s mapping. */
function cellAt(g: RasterGrid, x: number, y: number): number {
  const cellW = (g.bbox.maxX - g.bbox.minX) / g.width;
  const cellH = (g.bbox.maxY - g.bbox.minY) / g.height;
  const cx = Math.floor((x - g.bbox.minX) / cellW);
  const cy = Math.floor((y - g.bbox.minY) / cellH);
  const ccx = Math.max(0, Math.min(g.width - 1, cx));
  const ccy = Math.max(0, Math.min(g.height - 1, cy));
  return ccy * g.width + ccx;
}

describe('rasterTexture buildRasterGrid', () => {
  it('returns null when there is no raster segment', () => {
    const p = plan([{ kind: 'cut', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    expect(buildRasterGrid(p)).toBeNull();
  });

  it('ignores plain vector cuts and rapids', () => {
    const p = plan([
      { kind: 'rapid', points: [{ x: 0, y: 0 }] },
      cut([{ x: 0, y: 0 }, { x: 10, y: 0 }], [100, 100]),
    ]);
    expect(buildRasterGrid(p)).not.toBeNull();
  });

  it('lights the centre of a scan and leaves the off lead-in dark', () => {
    // Move into point 1 uses powers[0] (0 → off), into point 2 uses powers[1]
    // (100 → lit). The lit run therefore starts at point 1.
    const p = plan([
      cut(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
        ],
        [0, 100, 100, 100],
      ),
    ]);
    const g = buildRasterGrid(p) as RasterGrid;
    expect(g).not.toBeNull();

    // The lead-in column (x≈0) is dark; the middle and far-end columns lit.
    expect(g.power[cellAt(g, 0.5, 0.5)]).toBeLessThanOrEqual(0);
    expect(g.power[cellAt(g, 15, 0.5)]).toBeGreaterThan(50);
    expect(g.power[cellAt(g, 29, 0.5)]).toBeGreaterThan(50);
  });

  it('keeps separated lit runs apart (dither-like)', () => {
    const p = plan([
      cut(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
          { x: 5, y: 0 },
        ],
        [100, 0, 100, 100, 0, 100],
      ),
    ]);
    const g = buildRasterGrid(p) as RasterGrid;
    expect(g.power[cellAt(g, 0.3, 0.5)]).toBeGreaterThan(50);
    expect(g.power[cellAt(g, 1.5, 0.5)]).toBeLessThanOrEqual(0);
    expect(g.power[cellAt(g, 3.0, 0.5)]).toBeGreaterThan(50);
    expect(g.power[cellAt(g, 4.5, 0.5)]).toBeLessThanOrEqual(0);
  });

  it('does not mix rows (bidirectional)', () => {
    const p = plan([
      cut(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        [50, 50, 50],
      ),
      cut(
        [
          { x: 2, y: 2 },
          { x: 1, y: 2 },
          { x: 0, y: 2 },
        ],
        [80, 80, 80],
      ),
    ]);
    const g = buildRasterGrid(p) as RasterGrid;
    expect(g.power[cellAt(g, 1, 0.5)]).toBeCloseTo(50, 5);
    expect(g.power[cellAt(g, 1, 1.5)]).toBeCloseTo(80, 5);
  });

  it('caps the grid size at MAX_GRID_SIDE', () => {
    // A very long, fine scan line (points 0.001 mm apart) forces the grid to
    // cap. Height is non-zero so the bounds are not degenerate.
    const N = 50000;
    const pts: PlanSegment['points'] = [];
    for (let i = 0; i < N; i += 1) pts.push({ x: i * 0.001, y: i % 2 });
    const powers = new Array<number>(N).fill(100);
    const p = plan([cut(pts, powers)]);
    const g = buildRasterGrid(p) as RasterGrid;
    expect(g).not.toBeNull();
    expect(g.width).toBeLessThanOrEqual(MAX_GRID_SIDE);
    expect(g.height).toBeLessThanOrEqual(MAX_GRID_SIDE);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { JobPlan } from '@/gcode/types';
import {
  blendDot,
  buildRasterIndex,
  copyRevealedRows,
  rasterBoxes,
  rasterLineBox,
  revealCount,
  type ScreenBox,
} from './previewRaster';

function plan(): JobPlan {
  return {
    segments: [
      { kind: 'rapid', points: [{ x: 0, y: 0 }] },
      {
        kind: 'cut',
        layerId: 'image',
        feed: 1200,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        powers: [0, 100],
      },
      { kind: 'rapid', points: [{ x: 20, y: 11 }] },
      {
        kind: 'cut',
        layerId: 'image',
        feed: 1200,
        points: [
          { x: 20, y: 11 },
          { x: 10, y: 11 },
        ],
        powers: [100, 100],
      },
      {
        kind: 'cut',
        layerId: 'vector',
        feed: 1200,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
      },
    ],
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 11 },
    gcode: [],
    timeSeconds: 10,
    cutDistance: 20,
    rapidDistance: 0,
    layerStats: [],
    lineCount: 0,
    warnings: [],
  };
}

// One unit of weight per non-empty segment keeps the maths readable.
const weights = [1, 1, 1, 1, 1];

describe('buildRasterIndex', () => {
  it('indexes only raster cuts, in playback order, with cumulative starts', () => {
    const index = buildRasterIndex(plan(), weights);
    expect(index.rows).toHaveLength(2);
    expect(index.rows[0]).toMatchObject({ segment: 1, start: 1, weight: 1, fromRight: true });
    expect(index.rows[1]).toMatchObject({ segment: 3, start: 3, weight: 1, fromRight: false });
    expect(index.total).toBe(5);
  });

  it('falls back to a total of 1 for empty plans', () => {
    const empty: JobPlan = { ...plan(), segments: [] };
    expect(buildRasterIndex(empty, []).total).toBe(1);
    expect(revealCount({ rows: [], total: 1 }, 0.5)).toEqual({ done: 0, frac: 0 });
  });
});

describe('revealCount', () => {
  const index = buildRasterIndex(plan(), weights);

  it('is empty before the first row starts', () => {
    expect(revealCount(index, 0)).toEqual({ done: 0, frac: 0 });
    expect(revealCount(index, 0.2)).toEqual({ done: 0, frac: 0 });
  });

  it('reports the partially revealed row while it is being engraved', () => {
    // target = 1.5 -> row 0 half done.
    expect(revealCount(index, 0.3)).toEqual({ done: 0, frac: 0.5 });
    // target = 3.25 -> row 1 a quarter of the way (rows 0 complete).
    expect(revealCount(index, 0.65)).toEqual({ done: 1, frac: 0.25 });
  });

  it('reports every row once the playhead is past them', () => {
    expect(revealCount(index, 1)).toEqual({ done: 2, frac: 0 });
    expect(revealCount(index, 0.85)).toEqual({ done: 2, frac: 0 });
  });

  it('is monotonic, so the reveal cache only ever grows while playing', () => {
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const { done } = revealCount(index, Math.min(1, p));
      expect(done).toBeGreaterThanOrEqual(previous);
      previous = done;
    }
  });
});

describe('rasterBoxes', () => {
  it('caches the padded screen box of every row', () => {
    const index = buildRasterIndex(plan(), weights);
    const boxes = rasterBoxes(plan(), index, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    expect(boxes).toHaveLength(2);
    // Row 0 spans x 20..40 at y 20, padded by one pixel.
    expect(boxes[0]).toEqual({ x: 19, y: 19, w: 22, h: 2 });
    expect(boxes[1]).toEqual({ x: 19, y: 21, w: 22, h: 2 });
  });

  it('pads a single point into a non-degenerate box', () => {
    expect(rasterLineBox([{ x: 5, y: 5 }], (p) => p)).toEqual({ x: 4, y: 4, w: 2, h: 2 });
  });
});

describe('blendDot', () => {
  const color = { r: 255, g: 128, b: 64, a: 0.5 };

  it('writes the colour with the given alpha', () => {
    const data = new Uint8ClampedArray(4);
    blendDot(data, 1, 1, 0, 0, color);
    expect([...data]).toEqual([255, 128, 64, 128]);
  });

  it('accumulates overlapping dots instead of replacing them', () => {
    const data = new Uint8ClampedArray(4);
    blendDot(data, 1, 1, 0, 0, color);
    blendDot(data, 1, 1, 0, 0, color);
    // 0.5 + 0.5 * 0.5 = 0.75 alpha, colour unchanged.
    expect(data[3] / 255).toBeCloseTo(0.75, 1);
    expect(data[0]).toBe(255);
  });

  it('skips dots outside the buffer and dots with no power', () => {
    const data = new Uint8ClampedArray(4);
    blendDot(data, 1, 1, -1, 0, color);
    blendDot(data, 1, 1, 0, 5, color);
    blendDot(data, 1, 1, 0, 0, { ...color, a: 0 });
    expect([...data]).toEqual([0, 0, 0, 0]);
  });

  it('maps coordinates by floor, so dots land on whole texels', () => {
    const data = new Uint8ClampedArray(4 * 2 * 2);
    blendDot(data, 2, 2, 1.9, 0.2, color);
    expect(data[3]).toBe(0);
    // Second texel of the first row.
    expect(data[7]).toBe(128);
  });
});

describe('copyRevealedRows', () => {  const boxes: ScreenBox[] = [
    { x: 0, y: 0, w: 10, h: 1 },
    { x: 0, y: 1, w: 10, h: 1 },
    { x: 0, y: 2, w: 10, h: 1 },
  ];
  const rows = [
    { start: 0, weight: 1, segment: 0, fromRight: false },
    { start: 1, weight: 1, segment: 1, fromRight: false },
    { start: 2, weight: 1, segment: 2, fromRight: true },
  ];

  function calls(from: number, to: number, frac: number) {
    const out: number[][] = [];
    const ctx = {
      drawImage: (...args: number[]) => out.push(args),
    } as unknown as CanvasRenderingContext2D;
    copyRevealedRows(ctx, {} as CanvasImageSource, boxes, rows, from, to, frac);
    return out;
  }

  it('does nothing when the playhead is still before the first row', () => {
    // `from` is exclusive: rows up to `to` are (re)copied, none past it.
    expect(calls(3, 2, 0.3)).toHaveLength(0);
  });

  it('copies completed rows and clips the active one from the start', () => {
    const out = calls(0, 1, 0.5);
    expect(out).toHaveLength(2);
    // Full copy of row 0.
    expect(out[0]).toEqual([{}, 0, 0, 10, 1, 0, 0, 10, 1]);
    // Half of row 1, anchored on the left (row runs left to right).
    expect(out[1]).toEqual([{}, 0, 1, 5, 1, 0, 1, 5, 1]);
  });

  it('clips right-to-left rows from the right edge', () => {
    const out = calls(2, 2, 0.4);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([{}, 6, 2, 4, 1, 6, 2, 4, 1]);
  });

  it('stops at the last row without going out of bounds', () => {
    expect(calls(0, 99, 0)).toHaveLength(3);
  });
});

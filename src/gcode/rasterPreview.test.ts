import { describe, expect, it } from 'vitest';
import { powerForMove, rasterRuns } from './rasterPreview';

const points = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
];

describe('raster preview runs', () => {
  it('uses the previous point power for each move', () => {
    // The move into point i uses powers[i - 1]: point 0 never lights up.
    expect(powerForMove([10, 20, 30, 40], 0)).toBe(0);
    expect(powerForMove([10, 20, 30, 40], 1)).toBe(10);
    expect(powerForMove([10, 20, 30, 40], 3)).toBe(30);
    expect(powerForMove(undefined, 2)).toBe(0);
  });

  it('clamps out-of-range powers', () => {
    expect(powerForMove([-5, 250], 1)).toBe(0);
    expect(powerForMove([-5, 250], 2)).toBe(100);
    expect(powerForMove([Number.NaN, 50], 2)).toBe(50);
  });

  it('splits a scan line into lit runs', () => {
    const runs = rasterRuns({ points, powers: [0, 40, 40, 0] });
    // Moves: 1 -> 0 (off), 2 -> 40 (lit), 3 -> 40 (lit).
    expect(runs).toHaveLength(1);
    expect(runs[0].points).toHaveLength(3);
    expect(runs[0].points[0]).toEqual(points[1]);
    expect(runs[0].points[2]).toEqual(points[3]);
    expect(runs[0].power).toBeCloseTo(40, 6);
  });

  it('produces no runs for an invisible line', () => {
    expect(rasterRuns({ points, powers: [0, 0, 0, 0] })).toEqual([]);
  });

  it('keeps separated lit runs apart', () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];
    const runs = rasterRuns({ points: wide, powers: [100, 0, 100, 100, 0] });
    // Moves: 1 -> 100, 2 -> 0, 3 -> 100, 4 -> 100.
    expect(runs).toHaveLength(2);
    expect(runs[0].points).toHaveLength(2);
    expect(runs[0].points[0]).toEqual(wide[0]);
    expect(runs[0].power).toBeCloseTo(100, 6);
    expect(runs[1].points).toHaveLength(3);
    expect(runs[1].points[0]).toEqual(wide[2]);
    expect(runs[1].points[2]).toEqual(wide[4]);
  });

  it('averages the power of a run', () => {
    const runs = rasterRuns({ points, powers: [50, 100, 50, 0] });
    // Moves: 1 -> 50, 2 -> 100, 3 -> 50 (all lit).
    expect(runs).toHaveLength(1);
    expect(runs[0].power).toBeCloseTo((50 + 100 + 50) / 3, 6);
  });

  it('ignores plain vector segments', () => {
    expect(rasterRuns({ points })).toEqual([]);
  });
});

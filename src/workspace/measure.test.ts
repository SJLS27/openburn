import { describe, expect, it } from 'vitest';
import { liveMeasure, polylineLength, segmentAngle } from './measure';

describe('workspace/measure', () => {
  it('reports the current size and the movement since the start', () => {
    const m = liveMeasure(
      { left: 10, top: 20, width: 100, height: 50 },
      { left: 30, top: 5, width: 140, height: 70 },
      15,
    );
    expect(m).toMatchObject({ width: 140, height: 70, dx: 20, dy: -15, angle: 15 });
    expect(m.length).toBeUndefined();
  });

  it('includes the length of a line when given', () => {
    const m = liveMeasure(
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 3, height: 4 },
      0,
      5,
    );
    expect(m.length).toBe(5);
  });

  it('measures polylines', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 14 },
      ]),
    ).toBeCloseTo(15, 9);
    expect(polylineLength([])).toBe(0);
  });

  it('computes the segment angle', () => {
    expect(segmentAngle([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBeCloseTo(-45, 9);
    expect(segmentAngle([{ x: 0, y: 0 }, { x: 0, y: 10 }])).toBeCloseTo(-90, 9);
    expect(segmentAngle([{ x: 0, y: 0 }, { x: -10, y: 0 }])).toBeCloseTo(180, 9);
  });
});

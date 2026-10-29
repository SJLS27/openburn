import { describe, expect, it } from 'vitest';
import {
  emptyBounds,
  formatDuration,
  includePoint,
  type JobBounds,
} from '@/gcode/types';

describe('gcode/types', () => {
  it('starts bounds empty so the first point defines them', () => {
    const bounds = emptyBounds();
    expect(bounds.minX).toBe(Infinity);
    expect(bounds.maxY).toBe(-Infinity);

    includePoint(bounds, { x: 5, y: -2 });
    expect(bounds).toEqual({ minX: 5, minY: -2, maxX: 5, maxY: -2 });

    includePoint(bounds, { x: -3, y: 7 });
    expect(bounds).toEqual({ minX: -3, minY: -2, maxX: 5, maxY: 7 });
  });

  it('keeps existing bounds when a point is inside them', () => {
    const bounds: JobBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    includePoint(bounds, { x: 4, y: 6 });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('formats durations at every scale', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59.4)).toBe('59s');
    expect(formatDuration(59.6)).toBe('1m 0s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3725)).toBe('1h 2m 5s');
  });

  it('renders an em dash for invalid durations', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Infinity)).toBe('—');
  });
});

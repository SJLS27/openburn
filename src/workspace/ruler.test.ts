import { describe, expect, it } from 'vitest';
import { formatTick, rulerCursor, rulerTicks } from './ruler';

describe('workspace/ruler', () => {
  it('labels ticks at a readable spacing', () => {
    const ticks = rulerTicks(800, 0, 2, 'mm');
    const majors = ticks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(3);
    // Major spacing must be at least the requested minimum.
    const gaps = majors.slice(1).map((t, i) => t.screen - majors[i].screen);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(56 - 1e-6);
    expect(majors[0].value === 0).toBe(true);
    expect(majors[0].label).toBe('0');
  });

  it('follows the pan offset, including negative coordinates', () => {
    const ticks = rulerTicks(400, 100, 2, 'mm');
    // The origin sits 100px from the start.
    const origin = ticks.find((t) => t.value === 0);
    expect(origin?.screen).toBeCloseTo(100, 6);
    // Values to the left of the origin are negative.
    expect(ticks[0].value).toBeLessThan(0);
  });

  it('adapts to inches', () => {
    const ticks = rulerTicks(600, 0, 200, 'in');
    expect(ticks.some((t) => t.major && t.label === '1')).toBe(true);
    expect(ticks.filter((t) => t.major).length).toBeGreaterThan(1);
  });

  it('returns nothing for degenerate inputs', () => {
    expect(rulerTicks(0, 0, 2, 'mm')).toEqual([]);
    expect(rulerTicks(500, 0, 0, 'mm')).toEqual([]);
    expect(rulerTicks(500, 0, 1e-9, 'mm').length).toBeLessThan(20000);
  });

  it('formats clean labels', () => {
    expect(formatTick(-0, 0)).toBe('0');
    expect(formatTick(10.0, 0)).toBe('10');
    expect(formatTick(2.5, 1)).toBe('2.5');
  });

  it('only reports a cursor inside the ruler', () => {
    expect(rulerCursor(500, 20, 2, 10)).toBe(40);
    expect(rulerCursor(500, 20, 2, -100)).toBeNull();
    expect(rulerCursor(500, 20, 2, 1000)).toBeNull();
  });
});

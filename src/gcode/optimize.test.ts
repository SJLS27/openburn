import { describe, expect, it } from 'vitest';
import { optimizeSegments, segmentsLength } from '@/gcode/optimize';
import { DEFAULT_OPTIMIZATION, type PlanSegment } from '@/gcode/types';

function cut(x0: number, x1: number, layerId = 'L1'): PlanSegment {
  return {
    kind: 'cut',
    layerId,
    points: [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
    ],
  };
}

describe('gcode/optimize', () => {
  it('sums only cut segments, ignoring rapids', () => {
    const segments: PlanSegment[] = [
      { kind: 'rapid', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      cut(0, 10),
      { kind: 'rapid', points: [{ x: 10, y: 0 }, { x: 50, y: 0 }] },
      cut(50, 60),
    ];
    expect(segmentsLength(segments)).toBe(20);
  });

  it('keeps every cut segment and recomputes rapids', () => {
    const out = optimizeSegments([cut(0, 10), cut(50, 60)], {
      ...DEFAULT_OPTIMIZATION,
    });

    const cuts = out.filter((s) => s.kind === 'cut');
    expect(cuts).toHaveLength(2);
    expect(segmentsLength(out)).toBe(20);
    // The planner always starts from the origin, so the nearest shape comes
    // first regardless of the input order.
    expect(out[0].kind).toBe('rapid');
    expect(Math.min(...cuts[0].points.map((p) => p.x))).toBeLessThan(20);
  });

  it('visits the closest shape first to reduce travel', () => {
    const far = cut(200, 210);
    const near = cut(0, 10);
    const out = optimizeSegments([far, near], {
      ...DEFAULT_OPTIMIZATION,
      reduceTravel: true,
    });

    const firstCut = out.find((s) => s.kind === 'cut');
    expect(firstCut).toBeDefined();
    expect(Math.min(...firstCut!.points.map((p) => p.x))).toBeLessThan(20);
  });

  it('preserves creation order when planning is disabled', () => {
    const out = optimizeSegments([cut(200, 210), cut(0, 10)], {
      ...DEFAULT_OPTIMIZATION,
      enabled: false,
    });

    const cuts = out.filter((s) => s.kind === 'cut');
    expect(cuts[0].points[0].x).toBe(200);
  });

  it('returns an empty plan for empty input', () => {
    expect(optimizeSegments([], DEFAULT_OPTIMIZATION)).toEqual([]);
  });
});

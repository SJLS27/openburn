import { describe, expect, it } from 'vitest';
import type { SnapOptions, SnapShape, SnapTarget } from './snap';
import {
  boxXs,
  boxYs,
  intersectionTargets,
  segmentIntersection,
  snapDragDelta,
  snapPoint,
  snapRadiusScene,
  targetsForShape,
} from './snap';

const baseOptions = (patch: Partial<SnapOptions> = {}): SnapOptions => ({
  enabled: true,
  grid: false,
  objects: true,
  intersections: true,
  radiusPx: 8,
  zoom: 1,
  ...patch,
});

const target = (x: number, y: number, kind: SnapTarget['kind'] = 'vertex', source?: string): SnapTarget => ({
  position: { x, y },
  kind,
  ...(source ? { source } : {}),
});

describe('workspace/snap — point snapping', () => {
  it('does nothing when snapping is disabled', () => {
    expect(snapPoint({ x: 1, y: 1 }, [target(0, 0)], baseOptions({ enabled: false }))).toBeNull();
  });

  it('snaps to a vertex inside the radius', () => {
    const hit = snapPoint({ x: 2, y: 2 }, [target(0, 0)], baseOptions());
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual({ x: 0, y: 0 });
    expect(hit!.kind).toBe('vertex');
  });

  it('ignores targets outside the radius', () => {
    expect(snapPoint({ x: 20, y: 20 }, [target(0, 0)], baseOptions())).toBeNull();
  });

  it('keeps the radius constant in device pixels across zoom levels', () => {
    // `zoom` is scene units per device pixel: at 0.1 zoom one pixel covers 10
    // units, so 8 px are 80 units. At 40 zoom the same 3 units are invisible.
    const zoomedOut = baseOptions({ zoom: 10 });
    expect(snapRadiusScene(zoomedOut)).toBe(80);
    expect(snapPoint({ x: 70, y: 0 }, [target(0, 0)], zoomedOut)).not.toBeNull();
    expect(snapPoint({ x: 1.5, y: 0 }, [target(0, 0)], baseOptions({ zoom: 0.125 }))).toBeNull();
  });

  it('prefers vertices over midpoints and centres', () => {
    const targets = [target(0.5, 0.5, 'center'), target(0.4, 0.4, 'midpoint'), target(0.3, 0.3, 'vertex')];
    const hit = snapPoint({ x: 0.4, y: 0.4 }, targets, baseOptions());
    expect(hit!.kind).toBe('vertex');
  });

  it('prefers the closest target of the same kind', () => {
    const targets = [target(0, 0), target(3, 0)];
    expect(snapPoint({ x: 2.5, y: 0 }, targets, baseOptions())!.point).toEqual({ x: 3, y: 0 });
  });

  it('skips intersections when they are disabled', () => {
    const targets = [target(0, 0, 'intersection')];
    expect(snapPoint({ x: 1, y: 1 }, targets, baseOptions({ intersections: false }))).toBeNull();
  });

  it('never snaps an object to itself', () => {
    const targets = [target(0, 0, 'vertex', 'a'), target(50, 50, 'vertex', 'b')];
    const hit = snapPoint({ x: 1, y: 1 }, targets, baseOptions({ exclude: new Set(['a']) }));
    expect(hit).toBeNull();
  });

  it('falls back to the grid when no object target is near', () => {
    const hit = snapPoint({ x: 19, y: 1 }, [target(200, 200)], baseOptions({ grid: true, gridSize: 10 }));
    expect(hit).toEqual({ point: { x: 20, y: 0 }, kind: 'grid', target: { position: { x: 20, y: 0 }, kind: 'grid' } });
  });

  it('prefers an object target over the grid inside the radius', () => {
    const hit = snapPoint({ x: 19, y: 0.5 }, [target(18, 0)], baseOptions({ grid: true, gridSize: 10 }));
    expect(hit!.kind).toBe('vertex');
    expect(hit!.point).toEqual({ x: 18, y: 0 });
  });

  it('does not snap to the grid when it is disabled', () => {
    expect(snapPoint({ x: 19, y: 1 }, [], baseOptions({ grid: false, gridSize: 10 }))).toBeNull();
  });

  it('keeps guide targets in the type (reserved for the next update)', () => {
    const guides = [target(5, 5, 'guide')];
    // Guides are not consumed by the point snapper yet, so they are ignored.
    expect(snapPoint({ x: 5, y: 5 }, guides, baseOptions())).toBeNull();
  });
});

describe('workspace/snap — drag snapping', () => {
  const box = { left: 100, top: 100, width: 20, height: 10 };

  it('reports the candidate anchors of a box', () => {
    expect(boxXs(box).map((v) => v.x)).toEqual([100, 110, 120]);
    expect(boxYs(box).map((v) => v.y)).toEqual([100, 105, 110]);
  });

  it('snaps the right edge to a vertical guideline', () => {
    // The box spans 100..120, so its right edge lands on 123.
    const snap = snapDragDelta(box, [target(123, 500)], baseOptions());
    expect(snap.dx).toBe(3);
    expect(snap.guideX).toBe(123);
    expect(snap.dy).toBe(0);
    expect(snap.guideY).toBeNull();
  });

  it('snaps centres on both axes independently', () => {
    const snap = snapDragDelta(box, [target(111, 104)], baseOptions());
    expect(snap.dx).toBe(1);
    expect(snap.dy).toBe(-1);
    expect(snap.guideX).toBe(111);
    expect(snap.guideY).toBe(104);
  });

  it('chooses the closest candidate edge', () => {
    // Right edge (120) is 2 away from 122, left edge is 22 away.
    const snap = snapDragDelta(box, [target(122, 0)], baseOptions());
    expect(snap.dx).toBe(2);
  });

  it('does nothing outside the radius', () => {
    const snap = snapDragDelta(box, [target(500, 500)], baseOptions());
    expect(snap).toEqual({ dx: 0, dy: 0, guideX: null, guideY: null });
  });

  it('respects the zoom when measuring the radius', () => {
    const far = snapDragDelta(box, [target(123, 200)], baseOptions({ zoom: 10 }));
    // At 10 units per pixel the radius is 80 units, so a 3 unit gap snaps.
    expect(far.dx).toBe(3);
    expect(snapDragDelta(box, [target(123, 200)], baseOptions({ zoom: 0.125 })).dx).toBe(0);
  });

  it('ignores the dragged objects themselves', () => {
    const snap = snapDragDelta(box, [target(103, 200, 'vertex', 'me')], baseOptions({ exclude: new Set(['me']) }));
    expect(snap.dx).toBe(0);
  });

  it('is disabled when object snapping is off', () => {
    expect(snapDragDelta(box, [target(100, 100)], baseOptions({ objects: false })).dx).toBe(0);
    expect(snapDragDelta(box, [target(100, 100)], baseOptions({ enabled: false })).dx).toBe(0);
  });
});

describe('workspace/snap — target collection', () => {
  const square: SnapShape = {
    id: 'sq',
    corners: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  };

  it('derives vertices, centre and midpoints from a shape', () => {
    const targets = targetsForShape(square);
    expect(targets.filter((t) => t.kind === 'vertex')).toHaveLength(4);
    expect(targets.filter((t) => t.kind === 'midpoint')).toHaveLength(4);
    const center = targets.find((t) => t.kind === 'center')!;
    expect(center.position).toEqual({ x: 5, y: 5 });
    expect(targets.every((t) => t.source === 'sq')).toBe(true);
  });

  it('handles single-point shapes', () => {
    const targets = targetsForShape({ id: 't', corners: [{ x: 1, y: 2 }] });
    expect(targets).toEqual([{ position: { x: 1, y: 2 }, kind: 'vertex', source: 't' }]);
    expect(targetsForShape({ id: 'e', corners: [] })).toEqual([]);
  });

  it('finds segment intersections', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
  });

  it('rejects parallel and non-crossing segments', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('crosses shapes only with each other', () => {
    const a: SnapShape = { id: 'a', corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const b: SnapShape = { id: 'b', corners: [{ x: 5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 5 }, { x: 5, y: 5 }] };
    const hits = intersectionTargets([a, b]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.position.x === 5 && h.position.y === 0)).toBe(true);
    expect(hits.some((h) => h.position.x === 10 && h.position.y === 5)).toBe(true);
    expect(intersectionTargets([a])).toEqual([]);
  });
});

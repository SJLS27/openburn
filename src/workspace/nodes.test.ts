import { describe, expect, it } from 'vitest';
import type { Command } from './nodes';
import {
  arcToCubics,
  buildPath,
  closeSubpath,
  insertNode,
  isCurvedSegment,
  makeCurve,
  makeLine,
  moveAnchor,
  moveHandle,
  nearestOnSubpath,
  normaliseCommands,
  openSubpath,
  parsePath,
  quadToCubic,
  removeNode,
  removeNodes,
  segmentCount,
  setNodeType,
  splitCubic,
  toggleSegmentType,
} from './nodes';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('workspace/nodes — parse and build', () => {
  it('reads a simple open polyline as corner nodes', () => {
    const subs = parsePath([['M', 0, 0], ['L', 10, 0], ['L', 10, 10]]);
    expect(subs).toHaveLength(1);
    expect(subs[0].closed).toBe(false);
    expect(subs[0].nodes.map((n) => n.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(subs[0].nodes.every((n) => n.handleIn === null && n.handleOut === null)).toBe(true);
  });

  it('round-trips a rectangle exactly', () => {
    const commands: Command[] = [['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['L', 0, 10], ['Z']];
    expect(buildPath(parsePath(commands))).toEqual(commands);
  });

  it('collapses an explicit closing line into Z', () => {
    const explicit = parsePath([['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['L', 0, 10], ['L', 0, 0], ['Z']]);
    expect(buildPath(explicit)).toEqual([['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['L', 0, 10], ['Z']]);
  });

  it('round-trips a cubic curve', () => {
    const commands: Command[] = [['M', 0, 0], ['C', 10, 0, 20, 10, 20, 20]];
    expect(buildPath(parsePath(commands))).toEqual(commands);
  });

  it('drops the duplicated anchor of a closed curve and keeps its handle', () => {
    const commands: Command[] = [
      ['M', 0, 0],
      ['C', 5, -5, 15, -5, 20, 0],
      ['C', 15, 5, 5, 5, 0, 0],
      ['Z'],
    ];
    const [sub] = parsePath(commands);
    expect(sub.closed).toBe(true);
    expect(sub.nodes).toHaveLength(2);
    expect(sub.nodes[0].handleOut).toEqual({ x: 5, y: -5 });
    expect(sub.closingCurve).toEqual({ c1: { x: 15, y: 5 }, c2: { x: 5, y: 5 } });
    expect(buildPath([sub])).toEqual(commands);
  });

  it('normalises quadratics, shorthands and H/V to cubics', () => {
    const subs = normaliseCommands([
      ['M', 0, 0],
      ['Q', 10, 10, 20, 0],
      ['T', 40, 0],
      ['H', 50],
      ['V', 10],
    ]);
    expect(subs[0].segments.every((s) => !s.line)).toBe(false);
    expect(subs[0].segments[0].line).toBe(false);
    expect(subs[0].segments[1].line).toBe(false);
    expect(subs[0].segments[2].line).toBe(true);
    expect(subs[0].segments[3].line).toBe(true);
    // The quadratic's cubic equivalent keeps the midpoint on the curve.
    const [q] = parsePath([['M', 0, 0], ['Q', 10, 10, 20, 0]]);
    const c1 = q.nodes[0].handleOut!;
    const c2 = q.nodes[1].handleIn!;
    expect(near(c1.x, 20 / 3)).toBe(true);
    expect(near(c2.x, 40 / 3)).toBe(true);
  });

  it('approximates SVG arcs with cubic segments that start and end on the arc', () => {
    const cubics = arcToCubics({ x: 0, y: 0 }, 10, 10, 0, false, true, { x: 20, y: 0 });
    expect(cubics.length).toBeGreaterThanOrEqual(2);
    expect(cubics[0].c1.x).toBeCloseTo(0, 6);
    const last = cubics[cubics.length - 1];
    expect(last.to.x).toBeCloseTo(20, 6);
    expect(last.to.y).toBeCloseTo(0, 6);
    // Half a circle stays within the radius of the expected circle.
    const mid = cubics[0].to;
    expect(Math.hypot(mid.x - 10, mid.y) - 10).toBeLessThan(0.05);
  });

  it('collapses a degenerate arc into a line', () => {
    const segs = arcToCubics({ x: 0, y: 0 }, 0, 0, 0, false, false, { x: 5, y: 5 });
    expect(segs[0].c1).toEqual({ x: 0, y: 0 });
    expect(segs[0].to).toEqual({ x: 5, y: 5 });
  });

  it('converts a quadratic to the equivalent cubic', () => {
    const [c1, c2] = quadToCubic({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 });
    expect(c1.x).toBeCloseTo(20 / 3, 12);
    expect(c1.y).toBeCloseTo(20 / 3, 12);
    expect(c2.x).toBeCloseTo(40 / 3, 12);
    expect(c2.y).toBeCloseTo(20 / 3, 12);
  });
});

describe('workspace/nodes — editing', () => {
  const line: Command[] = [['M', 0, 0], ['L', 10, 0], ['L', 10, 10]];

  it('moves an anchor together with its handles', () => {
    const subs = parsePath([['M', 0, 0], ['C', 2, 2, 8, -2, 10, 0]]);
    const moved = moveAnchor(subs, 0, 1, { x: 10, y: 5 });
    expect(moved[0].nodes[1].anchor).toEqual({ x: 10, y: 5 });
    expect(moved[0].nodes[1].handleIn).toEqual({ x: 8, y: 3 });
    // The source subpaths are untouched.
    expect(subs[0].nodes[1].anchor).toEqual({ x: 10, y: 0 });
  });

  it('keeps handles symmetric when the node is symmetric', () => {
    const commands: Command[] = [['M', 0, 0], ['C', 3, 4, 7, -4, 10, 0]];
    let subs = parsePath(commands);
    expect(subs[0].nodes[0].type).toBe('corner');
    subs[0].nodes[0].handleIn = { x: -3, y: 0 };
    subs[0].nodes[0].handleOut = { x: 3, y: 0 };
    subs[0].nodes[0].type = 'symmetric';
    const moved = moveHandle(subs, 0, 0, 'out', { x: 0, y: 4 });
    const node = moved[0].nodes[0];
    expect(node.handleOut).toEqual({ x: 0, y: 4 });
    expect(node.handleIn).toEqual({ x: 0, y: -4 });
  });

  it('keeps handles collinear but independent for smooth nodes', () => {
    let subs = parsePath([['M', 0, 0], ['L', 10, 0]]);
    subs = setNodeType(subs, 0, 0, 'smooth');
    subs[0].nodes[0].handleIn = { x: -1, y: 0 };
    subs[0].nodes[0].handleOut = { x: 6, y: 0 };
    const moved = moveHandle(subs, 0, 0, 'out', { x: 0, y: 9 });
    const node = moved[0].nodes[0];
    expect(node.handleOut).toEqual({ x: 0, y: 9 });
    // Collinear and pointing the other way, length preserved (1).
    expect(node.handleIn!.x).toBeCloseTo(0, 6);
    expect(node.handleIn!.y).toBeCloseTo(-1, 6);
  });

  it('leaves corner handles independent', () => {
    const subs = parsePath([['M', 0, 0], ['C', 2, 2, 8, -2, 10, 0]]);
    const moved = moveHandle(subs, 0, 0, 'out', { x: 0, y: 7 });
    expect(moved[0].nodes[0].handleOut).toEqual({ x: 0, y: 7 });
    expect(moved[0].nodes[0].handleIn).toBeNull();
  });

  it('inserts a node on a line without changing the shape', () => {
    const subs = parsePath(line);
    const { subpaths, insertedIndex } = insertNode(subs, 0, 0, 0.5);
    expect(insertedIndex).toBe(1);
    expect(subpaths[0].nodes[1].anchor).toEqual({ x: 5, y: 0 });
    expect(buildPath(subpaths)).toEqual([['M', 0, 0], ['L', 5, 0], ['L', 10, 0], ['L', 10, 10]]);
  });

  it('splits a curve with De Casteljau, preserving the visible shape', () => {
    const subs = parsePath([['M', 0, 0], ['C', 0, 10, 10, 10, 10, 0]]);
    const { subpaths } = insertNode(subs, 0, 0, 0.5);
    expect(subpaths[0].nodes).toHaveLength(3);
    const rebuilt = parsePath(buildPath(subpaths));
    // The new node lands on the original curve at t = 0.5.
    const { point } = splitCubic({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, 0.5);
    expect(subpaths[0].nodes[1].anchor.x).toBeCloseTo(point.x, 6);
    expect(subpaths[0].nodes[1].anchor.y).toBeCloseTo(point.y, 6);
    expect(rebuilt[0].nodes[1].type).toBe('symmetric');
  });

  it('removes a node and reports the next selection', () => {
    const subs = parsePath(line);
    const { subpaths, nextIndex } = removeNode(subs, 0, 1);
    expect(subpaths[0].nodes.map((n) => n.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(nextIndex).toBe(1);
  });

  it('removes several nodes by their original indices', () => {
    const subs = parsePath([['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['L', 0, 10], ['Z']]);
    // Removing 3, 2 and 1 together must not shift the indices under the loop.
    const out = removeNodes(subs, [
      { subIndex: 0, nodeIndex: 3 },
      { subIndex: 0, nodeIndex: 2 },
      { subIndex: 0, nodeIndex: 1 },
    ]);
    expect(out).toHaveLength(0);
  });

  it('keeps untouched subpaths when removing nodes from another one', () => {
    const subs = parsePath([
      ['M', 0, 0], ['L', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z'],
      ['M', 5, 5], ['L', 15, 5], ['L', 15, 15], ['L', 5, 15], ['Z'],
    ]);
    const out = removeNodes(subs, [{ subIndex: 0, nodeIndex: 3 }]);
    expect(out).toHaveLength(2);
    expect(out[0].nodes).toHaveLength(3);
    expect(out[1].nodes).toHaveLength(4);
  });

  it('drops only the emptied subpath when removing all of its nodes', () => {
    const subs = parsePath([
      ['M', 0, 0], ['L', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z'],
      ['M', 5, 5], ['L', 15, 5], ['L', 15, 15], ['L', 5, 15], ['Z'],
    ]);
    const out = removeNodes(subs, [
      { subIndex: 0, nodeIndex: 0 },
      { subIndex: 0, nodeIndex: 1 },
      { subIndex: 0, nodeIndex: 2 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].nodes).toHaveLength(4);
  });

  it('ignores nodes that do not exist', () => {
    const subs = parsePath(line);
    expect(removeNodes(subs, [{ subIndex: 9, nodeIndex: 0 }])).toHaveLength(1);
    expect(removeNodes(subs, [])).toBe(subs);
  });

  it('drops a subpath that only had two nodes when one is removed', () => {
    const subs = parsePath([['M', 0, 0], ['L', 5, 5]]);
    const { subpaths, nextIndex } = removeNode(subs, 0, 0);
    expect(subpaths).toHaveLength(0);
    expect(nextIndex).toBe(-1);
  });

  it('converts a segment between straight and curved', () => {
    const subs = parsePath(line);
    const curved = makeCurve(subs, 0, 0);
    expect(isCurvedSegment(curved[0], 0)).toBe(true);
    const straight = toggleSegmentType(curved, 0, 0);
    expect(isCurvedSegment(straight[0], 0)).toBe(false);
    expect(straight[0].nodes[0].handleOut).toBeNull();
    expect(straight[0].nodes[1].handleIn).toBeNull();
  });

  it('does not rebuild an already curved segment', () => {
    const subs = makeCurve(parsePath(line), 0, 0);
    expect(makeCurve(subs, 0, 0)).toEqual(subs);
  });

  it('makes a corner smooth by pulling both handles out', () => {
    const subs = setNodeType(parsePath(line), 0, 1, 'smooth');
    const node = subs[0].nodes[1];
    expect(node.type).toBe('smooth');
    expect(node.handleIn).not.toBeNull();
    expect(node.handleOut).not.toBeNull();
  });

  it('closes and opens a subpath', () => {
    const open = parsePath(line);
    expect(open[0].closed).toBe(false);
    const closed = closeSubpath(open, 0);
    expect(closed[0].closed).toBe(true);
    expect(segmentCount(closed[0])).toBe(3);
    expect(buildPath(closed).at(-1)).toEqual(['Z']);
    expect(openSubpath(closed, 0)[0].closed).toBe(false);
  });

  it('handles paths with holes (multiple subpaths) independently', () => {
    const commands: Command[] = [
      ['M', 0, 0], ['L', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z'],
      ['M', 5, 5], ['L', 15, 5], ['L', 15, 15], ['L', 5, 15], ['Z'],
    ];
    const subs = parsePath(commands);
    expect(subs).toHaveLength(2);
    const edited = insertNode(subs, 1, 0, 0.5).subpaths;
    expect(edited[0].nodes).toHaveLength(4);
    expect(edited[1].nodes).toHaveLength(5);
  });

  it('clamps an out-of-range segment index instead of throwing', () => {
    const subs = parsePath(line);
    expect(insertNode(subs, 0, 9).insertedIndex).toBe(-1);
    expect(makeLine(subs, 0, 9)).toEqual(subs);
    expect(removeNode(subs, 5, 0).subpaths).toEqual(subs);
  });
});

describe('workspace/nodes — queries', () => {
  it('finds the closest point on a line', () => {
    const [sub] = parsePath([['M', 0, 0], ['L', 10, 0]]);
    const hit = nearestOnSubpath(sub, { x: 4, y: 3 })!;
    expect(hit.nodeIndex).toBe(0);
    expect(hit.t).toBeCloseTo(0.4, 6);
    expect(hit.point).toEqual({ x: 4, y: 0 });
    expect(hit.distance).toBe(3);
  });

  it('finds the closest point on a curve', () => {
    const [sub] = parsePath([['M', 0, 0], ['C', 0, 10, 10, 10, 10, 0]]);
    const hit = nearestOnSubpath(sub, { x: 5, y: 7.5 })!;
    expect(hit.nodeIndex).toBe(0);
    expect(hit.point.x).toBeCloseTo(5, 1);
  });

  it('returns null for a single-node subpath', () => {
    const [sub] = parsePath([['M', 1, 1]]);
    expect(nearestOnSubpath(sub, { x: 0, y: 0 })).toBeNull();
  });
});

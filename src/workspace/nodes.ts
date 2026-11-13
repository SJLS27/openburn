/**
 * Canonical node model for path editing.
 *
 * This module owns the single representation that every consumer of a path
 * shares: the node editor, the snapper, the document serializer and the future
 * "text on path" tool. Keep it free of Fabric so it can run in plain unit tests.
 *
 * Two rules make the model stable (see TODO.md — nodes & snapping):
 *
 * 1. **Only `M/L/C/Z` are canonical.** Quadratics, arcs, shorthand curves and
 *    horizontal/vertical lines are normalised to cubics when a path is edited,
 *    so handles always mean the same thing. A path that is *not* edited keeps
 *    its original commands, so imported arcs are never re-approximated.
 * 2. **Nodes never have optional fields.** `handleIn` and `handleOut` are always
 *    present and may be `null`, so adding features (tangents, guides, text on
 *    path) never changes the shape of a node.
 */

export interface Pt {
  x: number;
  y: number;
}

export type NodeType = 'corner' | 'smooth' | 'symmetric';

export interface PathNode {
  /** On-curve point in path-local coordinates (before `pathOffset`). */
  anchor: Pt;
  /**
   * Control point that shapes the segment arriving at this node, or `null`
   * when the incoming segment is a straight line.
   */
  handleIn: Pt | null;
  /** Control point that shapes the segment leaving this node. */
  handleOut: Pt | null;
  type: NodeType;
}

export interface Subpath {
  nodes: PathNode[];
  closed: boolean;
  /**
   * Handles of the closing segment (into node 0) when it is curved. `Z` alone
   * only draws a straight closing line, so curved closures are stored here and
   * written as an explicit cubic before `Z`.
   */
  closingCurve?: { c1: Pt | null; c2: Pt | null } | null;
}

/** A path as consumed by Fabric: one command per entry (`[type, ...coords]`). */
export type Command = (string | number)[];

export const EPSILON = 1e-9;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function cubicPoint(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

// ---------------------------------------------------------------------------
// Command normalisation
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

interface Cursor {
  current: Pt;
  subpathStart: Pt;
  prevCubicControl: Pt | null;
  prevQuadControl: Pt | null;
  prevType: string;
}

/**
 * Convert a quadratic Bezier (or its reflected `T` shorthand) to the exact
 * equivalent cubic.
 */
export function quadToCubic(p0: Pt, q: Pt, p1: Pt): [Pt, Pt] {
  return [
    { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
  ];
}

/**
 * Sample an SVG elliptical arc (`A rx ry rotation large-arc sweep x y`) as
 * cubic segments following the SVG implementation notes. Arcs are only
 * converted on demand, when the user edits that specific path.
 */
export function arcToCubics(
  from: Pt,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Pt,
): CubicSegment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < EPSILON || ry < EPSILON) {
    return [{ c1: from, c2: to, to }];
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num0 = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const factor = Math.sqrt(Math.max(0, num0 / (den || EPSILON))) * (largeArc === sweep ? -1 : 1);
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || EPSILON))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };

  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const pointAt = (t: number): Pt => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return {
      x: cx + cos * x - sin * y,
      y: cy + sin * x + cos * y,
    };
  };
  const derivativeAt = (t: number): Pt => {
    const x = -rx * Math.sin(t);
    const y = ry * Math.cos(t);
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const out: CubicSegment[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t0 = startAngle + i * step;
    const t1 = t0 + step;
    const p0 = i === 0 ? from : pointAt(t0);
    const p1 = pointAt(t1);
    const d0 = derivativeAt(t0);
    const d1 = derivativeAt(t1);
    out.push({
      c1: { x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y },
      c2: { x: p1.x - alpha * d1.x, y: p1.y - alpha * d1.y },
      to: p1,
    });
  }
  return out;
}

export interface CubicSegment {
  c1: Pt;
  c2: Pt;
  to: Pt;
}

interface RawSegment {
  /** Straight line: no handles. */
  line: boolean;
  c1?: Pt;
  c2?: Pt;
  to: Pt;
}

interface RawSubpath {
  /** Absolute start point of the subpath. */
  start: Pt;
  segments: RawSegment[];
  closed: boolean;
}

function tokenize(commands: Command[]): unknown[][] {
  const out: unknown[][] = [];
  for (const cmd of commands) {
    if (!Array.isArray(cmd) || cmd.length === 0) continue;
    const type = String(cmd[0]).toUpperCase();
    // Upper-case commands are absolute; Fabric and our writer only emit those.
    out.push([type, ...cmd.slice(1)]);
  }
  return out;
}

/** Split raw commands into absolute subpaths, normalising everything to cubics. */
export function normaliseCommands(commands: Command[]): RawSubpath[] {
  const subs: RawSubpath[] = [];
  let sub: RawSubpath | null = null;
  const cursor: Cursor = {
    current: { x: 0, y: 0 },
    subpathStart: { x: 0, y: 0 },
    prevCubicControl: null,
    prevQuadControl: null,
    prevType: '',
  };

  const ensure = (): RawSubpath => {
    if (!sub) {
      sub = { start: { ...cursor.current }, segments: [], closed: false };
      subs.push(sub);
    }
    return sub;
  };

  const pushLine = (to: Pt): void => {
    ensure().segments.push({ line: true, to });
  };

  const pushCubic = (c1: Pt, c2: Pt, to: Pt): void => {
    ensure().segments.push({ line: false, c1, c2, to });
  };

  for (const raw of tokenize(commands)) {
    const type = raw[0] as string;
    const n = (i: number): number => num(raw[i]) ?? 0;
    switch (type) {
      case 'M': {
        const to = { x: n(1), y: n(2) };
        cursor.current = to;
        cursor.subpathStart = { ...to };
        sub = { start: { ...to }, segments: [], closed: false };
        subs.push(sub);
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        break;
      }
      case 'L': {
        const to = { x: n(1), y: n(2) };
        pushLine(to);
        cursor.current = { ...to };
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        break;
      }
      case 'H': {
        const to = { x: n(1), y: cursor.current.y };
        pushLine(to);
        cursor.current = { ...to };
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        break;
      }
      case 'V': {
        const to = { x: cursor.current.x, y: n(1) };
        pushLine(to);
        cursor.current = { ...to };
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        break;
      }
      case 'C': {
        const c1 = { x: n(1), y: n(2) };
        const c2 = { x: n(3), y: n(4) };
        const to = { x: n(5), y: n(6) };
        pushCubic(c1, c2, to);
        cursor.prevCubicControl = c2;
        cursor.prevQuadControl = null;
        cursor.current = { ...to };
        break;
      }
      case 'S': {
        const prev = cursor.prevType === 'C' || cursor.prevType === 'S' ? cursor.prevCubicControl : null;
        const c1 = prev
          ? { x: 2 * cursor.current.x - prev.x, y: 2 * cursor.current.y - prev.y }
          : { ...cursor.current };
        const c2 = { x: n(1), y: n(2) };
        const to = { x: n(3), y: n(4) };
        pushCubic(c1, c2, to);
        cursor.prevCubicControl = c2;
        cursor.prevQuadControl = null;
        cursor.current = { ...to };
        break;
      }
      case 'Q': {
        const q = { x: n(1), y: n(2) };
        const to = { x: n(3), y: n(4) };
        const [c1, c2] = quadToCubic(cursor.current, q, to);
        pushCubic(c1, c2, to);
        cursor.prevQuadControl = q;
        cursor.prevCubicControl = null;
        cursor.current = { ...to };
        break;
      }
      case 'T': {
        const prev = cursor.prevType === 'Q' || cursor.prevType === 'T' ? cursor.prevQuadControl : null;
        const q = prev
          ? { x: 2 * cursor.current.x - prev.x, y: 2 * cursor.current.y - prev.y }
          : { ...cursor.current };
        const to = { x: n(1), y: n(2) };
        const [c1, c2] = quadToCubic(cursor.current, q, to);
        pushCubic(c1, c2, to);
        cursor.prevQuadControl = q;
        cursor.prevCubicControl = null;
        cursor.current = { ...to };
        break;
      }
      case 'A': {
        const to = { x: n(6), y: n(7) };
        const cubics = arcToCubics(
          cursor.current,
          n(1),
          n(2),
          n(3),
          n(4) !== 0,
          n(5) !== 0,
          to,
        );
        for (const seg of cubics) pushCubic(seg.c1, seg.c2, seg.to);
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        cursor.current = { ...to };
        break;
      }
      case 'Z': {
        const current = ensure();
        current.closed = true;
        cursor.current = { ...current.start };
        cursor.prevCubicControl = null;
        cursor.prevQuadControl = null;
        sub = null;
        break;
      }
      default:
        break;
    }
    if (type !== 'Z') cursor.prevType = type;
  }
  return subs;
}

// ---------------------------------------------------------------------------
// Public model
// ---------------------------------------------------------------------------

/**
 * Parse Fabric `path.path` commands into editable subpaths.
 *
 * Returns `[]` for an empty path. Every command is normalised to `M/L/C/Z`,
 * which is the canonical representation stored in `PathNode`s.
 */
export function parsePath(commands: Command[]): Subpath[] {
  const raw = normaliseCommands(commands);
  return raw.map((sub) => {
    const nodes: PathNode[] = [{ anchor: { ...sub.start }, handleIn: null, handleOut: null, type: 'corner' }];
    for (const seg of sub.segments) {
      const prev = nodes[nodes.length - 1];
      if (seg.line) {
        nodes.push({ anchor: { ...seg.to }, handleIn: null, handleOut: null, type: 'corner' });
      } else {
        prev.handleOut = { ...seg.c1! };
        nodes.push({
          anchor: { ...seg.to },
          handleIn: { ...seg.c2! },
          handleOut: null,
          type: 'corner',
        });
      }
    }
    // A closed subpath never keeps a duplicate anchor for the start point: the
    // closing segment is the one arriving at node 0.
    let closingCurve: { c1: Pt | null; c2: Pt | null } | null = null;
    if (sub.closed && nodes.length > 1) {
      const last = nodes[nodes.length - 1];
      if (dist(last.anchor, nodes[0].anchor) < 1e-6) {
        // A curved segment arriving at the start point cannot be written with
        // `Z`; keep it as an explicit closure before dropping the duplicate.
        if (last.handleIn || last.handleOut) {
          closingCurve = { c1: last.handleOut ?? nodes[1].handleOut, c2: last.handleIn };
        }
        nodes.pop();
      }
      nodes[0] = { ...nodes[0], handleIn: null };
      nodes[0].type = nodes[0].handleIn && nodes[0].handleOut ? 'smooth' : nodes[0].type;
    }
    const parsed: Subpath = { nodes: inferTypes(nodes), closed: sub.closed };
    if (closingCurve) parsed.closingCurve = closingCurve;
    return parsed;
  });
}

/** Give collinear handles the `smooth`/`symmetric` type they visually have. */
function inferTypes(nodes: PathNode[]): PathNode[] {
  return nodes.map((node, i) => {
    if (node.type !== 'corner') return node;
    if (!node.handleIn || !node.handleOut) return node;
    const a = { x: node.anchor.x - node.handleIn.x, y: node.anchor.y - node.handleIn.y };
    const b = { x: node.handleOut.x - node.anchor.x, y: node.handleOut.y - node.anchor.y };
    const cross = a.x * b.y - a.y * b.x;
    const lenA = Math.hypot(a.x, a.y);
    const lenB = Math.hypot(b.x, b.y);
    if (lenA < EPSILON || lenB < EPSILON) return node;
    if (Math.abs(cross) / (lenA * lenB) > 1e-4) return node;
    const dot = a.x * b.x + a.y * b.y;
    if (dot <= 0) return node;
    return { ...node, type: Math.abs(lenA - lenB) < 1e-4 ? 'symmetric' : 'smooth' };
  });
}

/** Serialise subpaths back to Fabric commands (`M/L/C/Z`, absolute). */
export function buildPath(subpaths: Subpath[]): Command[] {
  const out: Command[] = [];
  for (const sub of subpaths) {
    const nodes = sub.nodes;
    if (nodes.length === 0) continue;
    const r = (v: number): number => Math.round(v * 1e6) / 1e6;
    out.push(['M', r(nodes[0].anchor.x), r(nodes[0].anchor.y)]);
    // In a closed subpath the last segment ends at node 0: a straight one is
    // exactly what Z draws, so it is only emitted when it is curved.
    const count = sub.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < count; i += 1) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const closing = sub.closed && i === count - 1;
      const c1 = closing ? sub.closingCurve?.c1 ?? a.handleOut : a.handleOut;
      const c2 = closing ? sub.closingCurve?.c2 ?? b.handleIn : b.handleIn;
      if (!c1 && !c2) {
        if (closing) continue;
        out.push(['L', r(b.anchor.x), r(b.anchor.y)]);
      } else {
        const p0 = a.anchor;
        out.push([
          'C',
          r(c1 ? c1.x : p0.x),
          r(c1 ? c1.y : p0.y),
          r(c2 ? c2.x : b.anchor.x),
          r(c2 ? c2.y : b.anchor.y),
          r(b.anchor.x),
          r(b.anchor.y),
        ]);
      }
    }
    if (sub.closed) out.push(['Z']);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

function cloneSubpath(sub: Subpath): Subpath {
  const out: Subpath = {
    closed: sub.closed,
    nodes: sub.nodes.map((n) => ({
      anchor: { ...n.anchor },
      handleIn: n.handleIn ? { ...n.handleIn } : null,
      handleOut: n.handleOut ? { ...n.handleOut } : null,
      type: n.type,
    })),
  };
  if (sub.closingCurve) {
    out.closingCurve = {
      c1: sub.closingCurve.c1 ? { ...sub.closingCurve.c1 } : null,
      c2: sub.closingCurve.c2 ? { ...sub.closingCurve.c2 } : null,
    };
  }
  return out;
}

export function cloneSubpaths(subpaths: Subpath[]): Subpath[] {
  return subpaths.map(cloneSubpath);
}

/**
 * Apply a node handle constraint: `smooth` keeps both handles collinear,
 * `symmetric` keeps them collinear and equally long.
 */
function constrainHandles(node: PathNode, moved: 'in' | 'out'): PathNode {
  if (node.type === 'corner') return node;
  const from = moved === 'in' ? node.handleIn : node.handleOut;
  const other = moved === 'in' ? node.handleOut : node.handleIn;
  if (!from || !other) return node;
  const dx = from.x - node.anchor.x;
  const dy = from.y - node.anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < EPSILON) return node;
  const ux = dx / len;
  const uy = dy / len;
  const otherLen = node.type === 'symmetric' ? len : Math.hypot(other.x - node.anchor.x, other.y - node.anchor.y);
  const mirrored = { x: node.anchor.x - ux * otherLen, y: node.anchor.y - uy * otherLen };
  return moved === 'in'
    ? { ...node, handleOut: mirrored }
    : { ...node, handleIn: mirrored };
}

export function moveAnchor(subpaths: Subpath[], subIndex: number, nodeIndex: number, to: Pt): Subpath[] {
  const out = cloneSubpaths(subpaths);
  const node = out[subIndex]?.nodes[nodeIndex];
  if (!node) return subpaths;
  const dx = to.x - node.anchor.x;
  const dy = to.y - node.anchor.y;
  node.anchor = { ...to };
  if (node.handleIn) node.handleIn = { x: node.handleIn.x + dx, y: node.handleIn.y + dy };
  if (node.handleOut) node.handleOut = { x: node.handleOut.x + dx, y: node.handleOut.y + dy };
  return out;
}

/**
 * Move one handle. Moving a handle out of a straight segment converts the
 * segment into a curve, which is what LightBurn does when you drag the handle
 * of a line node.
 */
export function moveHandle(
  subpaths: Subpath[],
  subIndex: number,
  nodeIndex: number,
  side: 'in' | 'out',
  to: Pt,
): Subpath[] {
  const out = cloneSubpaths(subpaths);
  const node = out[subIndex]?.nodes[nodeIndex];
  if (!node) return subpaths;
  if (side === 'in') node.handleIn = { ...to };
  else node.handleOut = { ...to };
  const constrained = constrainHandles(node, side);
  out[subIndex].nodes[nodeIndex] = constrained;
  return out;
}

export function setNodeType(
  subpaths: Subpath[],
  subIndex: number,
  nodeIndex: number,
  type: NodeType,
): Subpath[] {
  const out = cloneSubpaths(subpaths);
  const node = out[subIndex]?.nodes[nodeIndex];
  if (!node) return subpaths;
  if (type === 'corner') {
    node.type = 'corner';
    return out;
  }
  // Make sure both handles exist, then align them along the node tangent.
  const tangent = nodeTangent(node);
  const len = 12;
  if (!node.handleIn) node.handleIn = { x: node.anchor.x - tangent.x * len, y: node.anchor.y - tangent.y * len };
  if (!node.handleOut) node.handleOut = { x: node.anchor.x + tangent.x * len, y: node.anchor.y + tangent.y * len };
  node.type = type;
  const moved = constrainHandles(node, 'in');
  out[subIndex].nodes[nodeIndex] = moved;
  return out;
}

/** Unit tangent through a node, used when a corner becomes smooth. */
export function nodeTangent(node: PathNode): Pt {
  const a = node.handleIn ?? (node.handleOut ? { x: 2 * node.anchor.x - node.handleOut.x, y: 2 * node.anchor.y - node.handleOut.y } : null);
  const b = node.handleOut ?? (node.handleIn ? { x: 2 * node.anchor.x - node.handleIn.x, y: 2 * node.anchor.y - node.handleIn.y } : null);
  if (a && b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > EPSILON) return { x: dx / len, y: dy / len };
  }
  return { x: 1, y: 0 };
}

/** De Casteljau split of a cubic at `t`, preserving the shape exactly. */
export function splitCubic(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p1: Pt,
  t: number,
): { left: [Pt, Pt]; right: [Pt, Pt]; point: Pt } {
  const a = lerp(p0, c1, t);
  const b = lerp(c1, c2, t);
  const c = lerp(c2, p1, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const point = lerp(d, e, t);
  return { left: [a, d], right: [e, c], point };
}

export interface SegmentRef {
  subIndex: number;
  /** Index of the node that starts the segment. */
  nodeIndex: number;
}

/** How many segments a subpath has (closed subpaths include the closing one). */
export function segmentCount(sub: Subpath): number {
  if (sub.nodes.length < 2) return 0;
  return sub.closed ? sub.nodes.length : sub.nodes.length - 1;
}

/**
 * Insert a node on the segment starting at `nodeIndex`, at parameter `t`.
 * Curves are split with De Casteljau so the visible shape does not change.
 */
export function insertNode(
  subpaths: Subpath[],
  subIndex: number,
  nodeIndex: number,
  t = 0.5,
): { subpaths: Subpath[]; insertedIndex: number } {
  const out = cloneSubpaths(subpaths);
  const sub = out[subIndex];
  if (!sub) return { subpaths, insertedIndex: -1 };
  const count = segmentCount(sub);
  if (count === 0 || nodeIndex < 0 || nodeIndex >= count) return { subpaths, insertedIndex: -1 };
  const clampT = Math.min(0.999, Math.max(0.001, t));
  const a = sub.nodes[nodeIndex];
  const bIndex = (nodeIndex + 1) % sub.nodes.length;
  const b = sub.nodes[bIndex];

  let node: PathNode;
  if (!a.handleOut && !b.handleIn) {
    node = {
      anchor: lerp(a.anchor, b.anchor, clampT),
      handleIn: null,
      handleOut: null,
      type: 'corner',
    };
  } else {
    const p0 = a.anchor;
    const c1 = a.handleOut ?? p0;
    const p1 = b.anchor;
    const c2 = b.handleIn ?? p1;
    const { left, right, point } = splitCubic(p0, c1, c2, p1, clampT);
    a.handleOut = left[0];
    node = { anchor: point, handleIn: left[1], handleOut: right[0], type: 'smooth' };
    b.handleIn = right[1];
  }
  sub.nodes.splice(nodeIndex + 1, 0, node);
  return { subpaths: out, insertedIndex: nodeIndex + 1 };
}

export interface RemoveResult {
  subpaths: Subpath[];
  /** Index of the node that is selected after the removal, or -1. */
  nextIndex: number;
}

/**
 * Remove a node. Curved neighbours keep their handles so the remaining shape
 * stays smooth; straight neighbours simply join.
 */
export function removeNode(subpaths: Subpath[], subIndex: number, nodeIndex: number): RemoveResult {
  const out = cloneSubpaths(subpaths);
  const sub = out[subIndex];
  if (!sub || nodeIndex < 0 || nodeIndex >= sub.nodes.length) {
    return { subpaths, nextIndex: -1 };
  }
  if (sub.nodes.length <= 2) {
    out.splice(subIndex, 1);
    return { subpaths: out, nextIndex: -1 };
  }
  sub.nodes.splice(nodeIndex, 1);
  const next = Math.min(nodeIndex, sub.nodes.length - 1);
  return { subpaths: out, nextIndex: next };
}

/**
 * Remove several nodes at once. Indices are grouped per subpath and removed
 * from the highest to the lowest so none of them shifts under the others;
 * a subpath left with fewer than two nodes disappears entirely.
 */
export function removeNodes(
  subpaths: Subpath[],
  targets: readonly { subIndex: number; nodeIndex: number }[],
): Subpath[] {
  if (targets.length === 0) return subpaths;
  const bySubpath = new Map<number, Set<number>>();
  for (const { subIndex, nodeIndex } of targets) {
    const set = bySubpath.get(subIndex) ?? new Set<number>();
    set.add(nodeIndex);
    bySubpath.set(subIndex, set);
  }
  const out = cloneSubpaths(subpaths);
  // Walk subpaths from the last one so splicing one does not renumber others.
  for (const subIndex of [...bySubpath.keys()].sort((a, b) => b - a)) {
    const sub = out[subIndex];
    if (!sub) continue;
    const indices = bySubpath.get(subIndex)!;
    sub.nodes = sub.nodes.filter((_, i) => !indices.has(i));
    if (sub.nodes.length < 2) {
      out.splice(subIndex, 1);
      continue;
    }
  }
  return out;
}

/** Convert the segment between two nodes into a straight line. */
export function makeLine(subpaths: Subpath[], subIndex: number, nodeIndex: number): Subpath[] {
  const out = cloneSubpaths(subpaths);
  const sub = out[subIndex];
  if (!sub) return subpaths;
  if (nodeIndex < 0 || nodeIndex >= segmentCount(sub)) return subpaths;
  const a = sub.nodes[nodeIndex];
  const b = sub.nodes[(nodeIndex + 1) % sub.nodes.length];
  a.handleOut = null;
  b.handleIn = null;
  return out;
}

/**
 * Convert a straight segment into a curve by pulling both handles towards the
 * perpendicular of the segment, so the result is visible immediately.
 */
export function makeCurve(subpaths: Subpath[], subIndex: number, nodeIndex: number): Subpath[] {
  const out = cloneSubpaths(subpaths);
  const sub = out[subIndex];
  if (!sub) return subpaths;
  if (nodeIndex < 0 || nodeIndex >= segmentCount(sub)) return subpaths;
  const a = sub.nodes[nodeIndex];
  const b = sub.nodes[(nodeIndex + 1) % sub.nodes.length];
  if (a.handleOut || b.handleIn) return out;
  const dx = b.anchor.x - a.anchor.x;
  const dy = b.anchor.y - a.anchor.y;
  const len = Math.hypot(dx, dy);
  const bulge = Math.min(20, len / 3);
  const nx = len > EPSILON ? -dy / len : 0;
  const ny = len > EPSILON ? dx / len : 1;
  a.handleOut = { x: a.anchor.x + dx / 3 + nx * bulge, y: a.anchor.y + dy / 3 + ny * bulge };
  b.handleIn = { x: b.anchor.x - dx / 3 + nx * bulge, y: b.anchor.y - dy / 3 + ny * bulge };
  return out;
}

/** True when the segment starting at `nodeIndex` is curved. */
export function isCurvedSegment(sub: Subpath, nodeIndex: number): boolean {
  const a = sub.nodes[nodeIndex];
  const b = sub.nodes[(nodeIndex + 1) % sub.nodes.length];
  if (!a || !b) return false;
  return !!(a.handleOut || b.handleIn);
}

export function toggleSegmentType(subpaths: Subpath[], subIndex: number, nodeIndex: number): Subpath[] {
  const sub = subpaths[subIndex];
  if (!sub) return subpaths;
  return isCurvedSegment(sub, nodeIndex)
    ? makeLine(subpaths, subIndex, nodeIndex)
    : makeCurve(subpaths, subIndex, nodeIndex);
}

export function closeSubpath(subpaths: Subpath[], subIndex: number): Subpath[] {
  const out = cloneSubpaths(subpaths);
  if (out[subIndex]) out[subIndex].closed = true;
  return out;
}

export function openSubpath(subpaths: Subpath[], subIndex: number): Subpath[] {
  const out = cloneSubpaths(subpaths);
  if (out[subIndex]) out[subIndex].closed = false;
  return out;
}

// ---------------------------------------------------------------------------
// Geometry queries (shared with the snapper)
// ---------------------------------------------------------------------------

/** Sample a segment as a polyline with `pieces` steps per curve. */
export function segmentPoints(sub: Subpath, nodeIndex: number, pieces = 8): Pt[] {
  const a = sub.nodes[nodeIndex];
  const b = sub.nodes[(nodeIndex + 1) % sub.nodes.length];
  if (!a || !b) return [];
  if (!a.handleOut && !b.handleIn) return [{ ...a.anchor }, { ...b.anchor }];
  const p0 = a.anchor;
  const c1 = a.handleOut ?? p0;
  const p1 = b.anchor;
  const c2 = b.handleIn ?? p1;
  const pts: Pt[] = [];
  for (let i = 0; i <= pieces; i += 1) pts.push(cubicPoint(p0, c1, c2, p1, i / pieces));
  return pts;
}

/** Project a point onto a subpath; returns the closest segment and parameter. */
export function nearestOnSubpath(
  sub: Subpath,
  p: Pt,
  pieces = 16,
): { nodeIndex: number; t: number; point: Pt; distance: number } | null {
  const count = segmentCount(sub);
  if (count === 0) return null;
  let best: { nodeIndex: number; t: number; point: Pt; distance: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const pts = segmentPoints(sub, i, pieces);
    for (let k = 0; k < pts.length - 1; k += 1) {
      const a = pts[k];
      const b = pts[k + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 < EPSILON ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const point = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = dist(point, p);
      if (!best || distance < best.distance) {
        best = {
          nodeIndex: i,
          t: (k + t) / (pts.length - 1),
          point,
          distance,
        };
      }
    }
  }
  return best;
}

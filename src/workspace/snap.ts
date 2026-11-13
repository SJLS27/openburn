/**
 * Snapping engine, shared by drawing tools, object moves and node editing.
 *
 * Everything here is pure: the workspace controller collects the targets from
 * Fabric, converts them to scene coordinates and asks `snapPoint` /
 * `snapDragDelta` for the result. Keeping the engine independent makes the
 * snapper testable and lets future features (guides, tangents, text on path)
 * plug in by adding a new `SnapKind` instead of rewriting the API.
 */

import type { Pt } from './nodes';

/**
 * What produced a snap target. `guide` is reserved for the smart guidelines
 * planned for the next update: the engine already understands it, only the
 * source and the renderer are missing.
 */
export type SnapKind =
  | 'grid'
  | 'vertex'
  | 'center'
  | 'midpoint'
  | 'intersection'
  | 'guide';

export interface SnapTarget {
  position: Pt;
  kind: SnapKind;
  /** Id of the object the target belongs to (used to skip the dragged one). */
  source?: string;
}

export interface SnapOptions {
  enabled: boolean;
  grid: boolean;
  objects: boolean;
  intersections: boolean;
  /** Capture radius in device pixels; it stays constant at any zoom. */
  radiusPx: number;
  /** Scene units per device pixel (`1 / canvas.getZoom()`). */
  zoom: number;
  /** Object ids that must not snap to themselves. */
  exclude?: ReadonlySet<string>;
  /** Grid spacing in document units, used when `grid` is on. */
  gridSize?: number;
}

export interface SnapResult {
  point: Pt;
  kind: SnapKind;
  target: SnapTarget;
}

/** Default capture radius in device pixels (same feel as LightBurn). */
export const DEFAULT_SNAP_RADIUS_PX = 8;

/** Priority when several targets are inside the radius: smaller wins. */
const KIND_PRIORITY: Record<SnapKind, number> = {
  vertex: 0,
  intersection: 1,
  midpoint: 2,
  center: 3,
  guide: 4,
  grid: 5,
};

/** Scene-space radius for the current zoom. */
export function snapRadiusScene(options: Pick<SnapOptions, 'radiusPx' | 'zoom'>): number {
  return options.radiusPx * Math.max(options.zoom, 1e-6);
}

/**
 * Snap a scene point. Object targets win over the grid inside the radius, and
 * among object targets the most specific one wins (vertex > intersection >
 * midpoint > centre). Returns `null` when nothing is close enough.
 */
export function snapPoint(
  p: Pt,
  targets: readonly SnapTarget[],
  options: SnapOptions,
): SnapResult | null {
  if (!options.enabled) return null;
  const radius = snapRadiusScene(options);

  if (options.objects) {
    let best: SnapResult | null = null;
    let bestPriority = Infinity;
    let bestDistance = Infinity;
    for (const target of targets) {
      if (target.kind === 'grid' || target.kind === 'guide') continue;
      if (target.kind === 'intersection' && !options.intersections) continue;
      if (options.exclude && target.source && options.exclude.has(target.source)) continue;
      const distance = Math.hypot(target.position.x - p.x, target.position.y - p.y);
      if (distance > radius) continue;
      const priority = KIND_PRIORITY[target.kind];
      if (priority < bestPriority || (priority === bestPriority && distance < bestDistance)) {
        best = { point: { ...target.position }, kind: target.kind, target };
        bestPriority = priority;
        bestDistance = distance;
      }
    }
    if (best) return best;
  }

  if (options.grid && options.gridSize && options.gridSize > 0) {
    const g = options.gridSize;
    const snapped = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    if (Math.hypot(snapped.x - p.x, snapped.y - p.y) <= radius) {
      return { point: snapped, kind: 'grid', target: { position: snapped, kind: 'grid' } };
    }
  }
  return null;
}

export interface BoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Candidate alignment anchors of a moving bounding box. */
export function boxXs(box: BoxLike): { x: number; anchor: 'left' | 'center' | 'right' }[] {
  return [
    { x: box.left, anchor: 'left' },
    { x: box.left + box.width / 2, anchor: 'center' },
    { x: box.left + box.width, anchor: 'right' },
  ];
}

export function boxYs(box: BoxLike): { y: number; anchor: 'top' | 'center' | 'bottom' }[] {
  return [
    { y: box.top, anchor: 'top' },
    { y: box.top + box.height / 2, anchor: 'center' },
    { y: box.top + box.height, anchor: 'bottom' },
  ];
}

export interface DragSnap {
  dx: number;
  dy: number;
  /** Vertical guideline in scene X, drawn because the box snapped sideways. */
  guideX: number | null;
  /** Horizontal guideline in scene Y. */
  guideY: number | null;
}

/**
 * Snap the bounding box of a dragged selection against edges and centres of
 * other objects. Each axis is resolved independently, so a box can snap to an
 * object's left edge while sliding freely vertically.
 */
export function snapDragDelta(
  box: BoxLike,
  targets: readonly SnapTarget[],
  options: SnapOptions,
): DragSnap {
  const result: DragSnap = { dx: 0, dy: 0, guideX: null, guideY: null };
  if (!options.enabled || !options.objects) return result;
  const radius = snapRadiusScene(options);

  let bestX: { delta: number; guide: number; priority: number } | null = null;
  let bestY: { delta: number; guide: number; priority: number } | null = null;

  for (const target of targets) {
    if (target.kind === 'grid') continue;
    if (options.exclude && target.source && options.exclude.has(target.source)) continue;
    const priority = KIND_PRIORITY[target.kind];

    for (const x of boxXs(box)) {
      const delta = target.position.x - x.x;
      if (Math.abs(delta) <= radius) {
        if (!bestX || Math.abs(delta) < Math.abs(bestX.delta) || (Math.abs(delta) === Math.abs(bestX.delta) && priority < bestX.priority)) {
          bestX = { delta, guide: target.position.x, priority };
        }
      }
    }
    for (const y of boxYs(box)) {
      const delta = target.position.y - y.y;
      if (Math.abs(delta) <= radius) {
        if (!bestY || Math.abs(delta) < Math.abs(bestY.delta) || (Math.abs(delta) === Math.abs(bestY.delta) && priority < bestY.priority)) {
          bestY = { delta, guide: target.position.y, priority };
        }
      }
    }
  }

  if (bestX) {
    result.dx = bestX.delta;
    result.guideX = bestX.guide;
  }
  if (bestY) {
    result.dy = bestY.delta;
    result.guideY = bestY.guide;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Target collection
// ---------------------------------------------------------------------------

/** Rectangle-ish outline used to derive vertex/centre/midpoint targets. */
export interface SnapShape {
  id: string;
  /** Four corners in scene space, in draw order. */
  corners: Pt[];
}

/**
 * Collect the usual targets of a shape: vertices, centre and edge midpoints.
 * A shape with a single point (e.g. a text anchor) only yields its centre.
 */
export function targetsForShape(shape: SnapShape): SnapTarget[] {
  const out: SnapTarget[] = [];
  const corners = shape.corners;
  if (corners.length === 0) return out;
  for (const c of corners) {
    out.push({ position: { ...c }, kind: 'vertex', source: shape.id });
  }
  if (corners.length >= 2) {
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
    out.push({ position: { x: cx, y: cy }, kind: 'center', source: shape.id });
    for (let i = 0; i < corners.length; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      out.push({
        position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        kind: 'midpoint',
        source: shape.id,
      });
    }
  }
  return out;
}

/** Intersection of two segments, or `null` when they do not cross. */
export function segmentIntersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * dax, y: a1.y + t * day };
}

/**
 * Crossings between the edges of the given shapes. Shapes are compared only
 * with each other (an object never intersects itself here).
 */
export function intersectionTargets(shapes: readonly SnapShape[]): SnapTarget[] {
  const out: SnapTarget[] = [];
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const A = shapes[i].corners;
      const B = shapes[j].corners;
      for (let a = 0; a < A.length; a += 1) {
        const a1 = A[a];
        const a2 = A[(a + 1) % A.length];
        for (let b = 0; b < B.length; b += 1) {
          const hit = segmentIntersection(a1, a2, B[b], B[(b + 1) % B.length]);
          if (hit) out.push({ position: hit, kind: 'intersection', source: shapes[j].id });
        }
      }
    }
  }
  return out;
}

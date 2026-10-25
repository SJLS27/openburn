import type {
  CutOrderKey,
  OptimizationSettings,
  PlanSegment,
  Pt,
} from './types';

/**
 * One atomic cut unit: a shape (with all its passes) or an image's raster rows.
 * Items are what the cut planner orders; their internal segment order is kept.
 */
export interface PlanItem {
  layerId?: string;
  layerIndex: number;
  groupIndex: number;
  priority: number;
  /** Rapid/cut sequence for this unit. Rapid targets are recomputed on emit. */
  segments: PlanSegment[];
  start: Pt;
  end: Pt;
  centroid: Pt;
  /** Bounding-box area, used by "cut inner shapes first". */
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  closed: boolean;
  /** Whether the whole item may be reversed (direction optimisation). */
  reversible: boolean;
}

/** Beyond this many items the planner skips the expensive local search. */
const MAX_LOCAL_SEARCH = 1200;
/** Beyond this many items the whole planner falls back to creation order. */
const MAX_ITEMS = 2500;

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Pt, b: Pt, tol = 1e-6): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;
}

function norm(p: Pt): Pt {
  const len = Math.hypot(p.x, p.y);
  return len < 1e-9 ? { x: 0, y: 0 } : { x: p.x / len, y: p.y / len };
}

function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function cutSegments(item: PlanItem): PlanSegment[] {
  return item.segments.filter((s) => s.kind === 'cut' && s.points.length > 1);
}

function firstCut(item: PlanItem): PlanSegment | undefined {
  return item.segments.find((s) => s.kind === 'cut' && s.points.length > 1);
}

function lastCut(item: PlanItem): PlanSegment | undefined {
  for (let i = item.segments.length - 1; i >= 0; i -= 1) {
    const seg = item.segments[i];
    if (seg.kind === 'cut' && seg.points.length > 1) return seg;
  }
  return undefined;
}

/** Recompute start/end/centroid/area from the item's segments. */
export function refreshItem(item: PlanItem): PlanItem {
  const cuts = cutSegments(item);
  let start: Pt = { x: 0, y: 0 };
  let end: Pt = { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const seg of cuts) {
    if (seg.points.length === 0) continue;
    start = seg.points[0];
    end = seg.points[seg.points.length - 1];
    for (const p of seg.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      sx += p.x;
      sy += p.y;
      count += 1;
    }
  }
  if (count === 0) {
    minX = minY = maxX = maxY = 0;
  }
  return {
    ...item,
    start,
    end,
    centroid: count > 0 ? { x: sx / count, y: sy / count } : { x: 0, y: 0 },
    area: (maxX - minX) * (maxY - minY),
    bbox: { minX, minY, maxX, maxY },
  };
}

/** Reverse a single cut in place (points + per-point powers). */
function reverseCut(seg: PlanSegment): PlanSegment {
  return {
    ...seg,
    points: [...seg.points].reverse(),
    powers: seg.powers ? [...seg.powers].reverse() : undefined,
  };
}

/** Reverse every cut in the item, preserving pass structure. */
function reverseItem(item: PlanItem): PlanItem {
  const segments = item.segments.map((seg) =>
    seg.kind === 'cut' ? reverseCut(seg) : seg,
  );
  return refreshItem({ ...item, segments });
}

/** Rotate a closed polyline so it starts at `index`. */
function rotateClosed(seg: PlanSegment, index: number): PlanSegment {
  const pts = seg.points;
  const closed = pts.length > 2 && samePoint(pts[0], pts[pts.length - 1], 1e-6);
  if (!closed) return seg;
  const ring = pts.slice(0, pts.length - 1);
  const powers = seg.powers ? seg.powers.slice(0, pts.length - 1) : undefined;
  if (index <= 0 || index >= ring.length) return seg;
  const newPts = [...ring.slice(index), ...ring.slice(0, index)];
  newPts.push(newPts[0]);
  const newPowers = powers
    ? [...powers.slice(index), ...powers.slice(0, index)]
    : undefined;
  if (newPowers) newPowers.push(newPowers[0]);
  return { ...seg, points: newPts, powers: newPowers };
}

/** Sharpness of the turn at vertex i (radians); corners are near π/2 or sharper. */
function cornerStrength(points: Pt[], i: number): number {
  const n = points.length;
  if (n < 3) return 0;
  const prev = points[(i - 1 + n) % n];
  const next = points[(i + 1) % n];
  const cur = points[i];
  const ax = cur.x - prev.x;
  const ay = cur.y - prev.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cos = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** Pick the entry vertex for a closed contour. */
function bestClosedStart(points: Pt[], from: Pt, preferCorners: boolean): number {
  const n = points.length > 1 && samePoint(points[0], points[points.length - 1]) ? points.length - 1 : points.length;
  let bestIndex = 0;
  let bestScore = Infinity;
  for (let i = 0; i < n; i += 1) {
    const d = distance(from, points[i]);
    const cornerPenalty = preferCorners && cornerStrength(points, i) > Math.PI / 3 ? 0 : 1e6;
    const score = d + cornerPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Orient an item relative to the current head position: choose the best start
 * point (closed shapes), the best direction (open shapes) and, when enabled,
 * prefer corners as start points.
 */
function orientItem(item: PlanItem, from: Pt, opt: OptimizationSettings): PlanItem {
  const cuts = cutSegments(item);
  if (cuts.length === 0) return item;
  const seg = cuts[0];
  const points = seg.points;
  const closed = points.length > 2 && samePoint(points[0], points[points.length - 1], 1e-6);

  if (closed) {
    if (opt.chooseBestStartingPoint || opt.chooseCorners) {
      const index = bestClosedStart(points, from, opt.chooseCorners);
      if (index > 0) {
        const segments = item.segments.map((s) =>
          s.kind === 'cut' && s.points.length === points.length ? rotateClosed(s, index) : s,
        );
        return refreshItem({ ...item, segments });
      }
    }
    return item;
  }

  if (cuts.length !== 1 || !item.reversible || !opt.chooseBestDirection) return item;
  const dStart = distance(from, points[0]);
  const dEnd = distance(from, points[points.length - 1]);
  if (dEnd < dStart - 1e-9) {
    return refreshItem({
      ...item,
      segments: item.segments.map((s) => (s === seg ? reverseCut(s) : s)),
    });
  }
  return item;
}

/** Two items have the same geometry if their polylines match up to reversal. */
function sameGeometry(a: PlanItem, b: PlanItem, tol: number): boolean {
  const ca = cutSegments(a);
  const cb = cutSegments(b);
  if (ca.length !== cb.length) return false;
  for (let k = 0; k < ca.length; k += 1) {
    const pa = ca[k].points;
    const pb = cb[k].points;
    if (ca[k].powers || cb[k].powers) return false;
    if (pa.length !== pb.length) return false;
    let forward = true;
    let backward = true;
    for (let i = 0; i < pa.length; i += 1) {
      if (distance(pa[i], pb[i]) > tol) forward = false;
      if (distance(pa[i], pb[pb.length - 1 - i]) > tol) backward = false;
      if (!forward && !backward) return false;
    }
  }
  return true;
}

/** Remove duplicate/overlapping items (LightBurn "Remove overlapping lines"). */
function removeOverlaps(items: PlanItem[], tol: number): PlanItem[] {
  if (items.length > MAX_ITEMS) return items;
  const out: PlanItem[] = [];
  for (const item of items) {
    if (item.layerId === undefined) {
      out.push(item);
      continue;
    }
    let duplicate = false;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const other = out[i];
      if (other.layerId !== item.layerId) continue;
      if (Math.abs(other.area - item.area) > Math.max(tol, item.area * 0.01)) continue;
      if (sameGeometry(other, item, tol)) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) out.push(item);
  }
  return out;
}

type Block = PlanItem[];

/** Split items into blocks according to the ordered sort criteria. */
function buildBlocks(items: PlanItem[], orderBy: CutOrderKey[]): Block[] {
  const keys = orderBy.length > 0 ? orderBy : (['layer'] as CutOrderKey[]);
  const keyOf = (item: PlanItem, key: CutOrderKey): string | number => {
    if (key === 'layer') return item.layerIndex;
    if (key === 'group') return item.groupIndex;
    return item.priority;
  };

  // Stable multi-key sort.
  const sorted = [...items].sort((a, b) => {
    for (const key of keys) {
      const ka = keyOf(a, key);
      const kb = keyOf(b, key);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  });

  const blocks: Block[] = [];
  let current: Block = [];
  let currentKey = '';
  for (const item of sorted) {
    const key = keys.map((k) => String(keyOf(item, k))).join('|');
    if (current.length > 0 && key !== currentKey) {
      blocks.push(current);
      current = [];
    }
    currentKey = key;
    current.push(item);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Stable sort by centroid along the requested direction. */
function sortByDirection(items: PlanItem[], dir: OptimizationSettings['cutInDirectionOrder']): PlanItem[] {
  if (dir === 'none') return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (dir) {
      case 'topBottom':
        return a.centroid.y - b.centroid.y;
      case 'bottomTop':
        return b.centroid.y - a.centroid.y;
      case 'leftRight':
        return a.centroid.x - b.centroid.x;
      case 'rightLeft':
        return b.centroid.x - a.centroid.x;
      default:
        return 0;
    }
  });
  return sorted;
}

/**
 * Order inner shapes before the shapes that contain them. Containment is
 * approximated with bounding boxes, which is accurate enough for nesting cuts.
 */
function cutInnerFirst(items: PlanItem[]): PlanItem[] {
  if (items.length > MAX_ITEMS) return items;
  const depths = items.map((item) =>
    items.reduce((depth, other) => {
      if (other === item) return depth;
      const contains =
        other.bbox.minX <= item.bbox.minX + 1e-6 &&
        other.bbox.minY <= item.bbox.minY + 1e-6 &&
        other.bbox.maxX >= item.bbox.maxX - 1e-6 &&
        other.bbox.maxY >= item.bbox.maxY - 1e-6 &&
        other.area > item.area + 1e-6;
      return contains ? depth + 1 : depth;
    }, 0),
  );
  return items
    .map((item, i) => ({ item, depth: depths[i] }))
    .sort((a, b) => b.depth - a.depth)
    .map((x) => x.item);
}

/** Greedy nearest-neighbour ordering with per-item orientation. */
function greedyOrder(items: PlanItem[], from: Pt, opt: OptimizationSettings): PlanItem[] {
  const remaining = items.map((item) => orientItem(item, from, opt));
  const out: PlanItem[] = [];
  let position = from;
  let prevDir: Pt | null = null;

  while (remaining.length > 0) {
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const oriented = orientItem(remaining[i], position, opt);
      remaining[i] = oriented;
      const d = distance(position, oriented.start);
      const itemDir = norm({
        x: oriented.end.x - oriented.start.x,
        y: oriented.end.y - oriented.start.y,
      });
      let score = d;
      const incoming = prevDir;
      if (opt.reduceDirectionChanges && incoming) {
        if (itemDir.x !== 0 || itemDir.y !== 0) {
          const cos = incoming.x * itemDir.x + incoming.y * itemDir.y;
          score = d * (1 + 0.25 * (1 - Math.max(-1, Math.min(1, cos))));
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const item = remaining.splice(best, 1)[0];
    out.push(item);
    prevDir = norm({ x: item.end.x - item.start.x, y: item.end.y - item.start.y });
    if (prevDir.x === 0 && prevDir.y === 0) prevDir = null;
    position = item.end;
  }
  return out;
}

function totalTravel(order: PlanItem[], from: Pt): number {
  let total = order.length > 0 ? distance(from, order[0].start) : 0;
  for (let i = 1; i < order.length; i += 1) {
    total += distance(order[i - 1].end, order[i].start);
  }
  return total;
}

/**
 * Or-opt local search: relocate a single item (optionally reversed) to the
 * position that most reduces travel. Uses exact insertion deltas, so it is
 * correct for asymmetric open paths (fill scan lines) as well as closed shapes.
 */
function orOpt(order: PlanItem[], from: Pt): PlanItem[] {
  const n = order.length;
  if (n < 3) return order;
  let seq = [...order];

  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (let i = 0; i < seq.length; i += 1) {
      const item = seq[i];
      const candidates = item.reversible ? [item, reverseItem(item)] : [item];
      const prev = i > 0 ? seq[i - 1] : null;
      const next = i + 1 < seq.length ? seq[i + 1] : null;
      const removeDelta =
        (prev ? distance(prev.end, item.start) : distance(from, item.start)) +
        (next ? distance(item.end, next.start) : 0) -
        (prev
          ? next
            ? distance(prev.end, next.start)
            : 0
          : next
            ? distance(from, next.start)
            : 0);

      const without = [...seq.slice(0, i), ...seq.slice(i + 1)];
      let bestDelta = -1e-6;
      let bestIndex = -1;
      let bestCandidate = item;

      for (let j = 0; j <= without.length; j += 1) {
        const a = j > 0 ? without[j - 1] : null;
        const b = j < without.length ? without[j] : null;
        for (const candidate of candidates) {
          let add: number;
          if (a && b) {
            add =
              distance(a.end, candidate.start) +
              distance(candidate.end, b.start) -
              distance(a.end, b.start);
          } else if (!a && b) {
            add =
              distance(from, candidate.start) +
              distance(candidate.end, b.start) -
              distance(from, b.start);
          } else if (a && !b) {
            add = distance(a.end, candidate.start);
          } else {
            add = distance(from, candidate.start);
          }
          const delta = add - removeDelta;
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIndex = j;
            bestCandidate = candidate;
          }
        }
      }

      if (bestIndex >= 0) {
        without.splice(bestIndex, 0, bestCandidate);
        seq = without;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return seq;
}

function emit(items: PlanItem[]): PlanSegment[] {
  const out: PlanSegment[] = [];
  let position: Pt | null = null;

  for (const item of items) {
    let led = false;
    for (const seg of item.segments) {
      if (seg.points.length === 0) continue;
      if (seg.kind === 'rapid') {
        // Always emit the rapid, even when it is zero-length: this guarantees
        // the laser is switched off between shapes and passes.
        out.push({ ...seg, points: [seg.points[0]] });
        position = seg.points[0];
        continue;
      }
      const start = seg.points[0];
      if (!led && (!position || distance(position, start) > 1e-9)) {
        out.push({ kind: 'rapid', points: [start] });
      }
      led = true;
      out.push(seg);
      position = seg.points[seg.points.length - 1];
    }
  }
  return out;
}

/**
 * Order cut units and emit a flat list of rapid/cut segments. Layer order is
 * configurable through the LightBurn-style Optimization Settings.
 */
export function optimizePlan(items: PlanItem[], opt: OptimizationSettings): PlanSegment[] {
  if (items.length === 0) return [];

  let list = opt.removeOverlapping ? removeOverlaps(items, opt.overlapTolerance) : items;

  if (!opt.enabled) {
    // Preserve creation order (but recreate the leading rapids).
    return emit(list);
  }

  if (opt.cutInnerFirst) list = cutInnerFirst(list);

  if (list.length > MAX_ITEMS) {
    // Too large to optimise interactively: keep the ordered blocks as-is.
    return emit(buildBlocks(list, opt.orderBy).flat());
  }

  const blocks = buildBlocks(list, opt.orderBy);
  const ordered: PlanItem[] = [];
  let position: Pt = { x: 0, y: 0 };

  for (const block of blocks) {
    let working = sortByDirection(block, opt.cutInDirectionOrder);
    if (opt.reduceTravel) {
      working = greedyOrder(working, position, opt);
      if (working.length <= MAX_LOCAL_SEARCH) working = orOpt(working, position);
    }
    if (working.length > 0) {
      ordered.push(...working);
      position = working[working.length - 1].end;
    }
  }

  return emit(ordered);
}

/**
 * Backwards-compatible helper: convert a flat segment list into items and run
 * the planner. Used by callers that do not build items themselves.
 */
export function optimizeSegments(
  segments: PlanSegment[],
  opt: OptimizationSettings,
): PlanSegment[] {
  const items: PlanItem[] = [];
  let layerIndex = 0;
  let lastLayer: string | undefined;
  const layerIndexById = new Map<string, number>();

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg.kind === 'rapid') continue;
    const id = seg.layerId ?? '';
    if (!layerIndexById.has(id)) layerIndexById.set(id, layerIndex++);
    layerIndex = layerIndexById.get(id) ?? 0;
    if (id !== lastLayer) lastLayer = id;
    items.push(
      refreshItem({
        layerId: seg.layerId,
        layerIndex,
        groupIndex: 0,
        priority: 0,
        segments: [seg],
        start: seg.points[0] ?? { x: 0, y: 0 },
        end: seg.points[seg.points.length - 1] ?? { x: 0, y: 0 },
        centroid: { x: 0, y: 0 },
        area: 0,
        bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        closed: seg.points.length > 2 && samePoint(seg.points[0], seg.points[seg.points.length - 1], 1e-6),
        reversible: !seg.powers,
      }),
    );
  }
  return optimizePlan(items, opt);
}

/** Total cut length of a flat segment list (utility used by preview). */
export function segmentsLength(segments: PlanSegment[]): number {
  return segments.reduce(
    (total, seg) => (seg.kind === 'cut' ? total + polylineLength(seg.points) : total),
    0,
  );
}

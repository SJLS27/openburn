import paper from 'paper';

interface Vec {
  x: number;
  y: number;
}

function area(points: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function normalize(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function offsetPolygon(points: Vec[], distance: number): Vec[] {
  const n = points.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    const e1 = normalize({ x: p1.x - p0.x, y: p1.y - p0.y });
    const e2 = normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
    const n1 = { x: e1.y, y: -e1.x };
    const n2 = { x: e2.y, y: -e2.x };

    const a1 = { x: p0.x + n1.x * distance, y: p0.y + n1.y * distance };
    const b1 = { x: p1.x + n1.x * distance, y: p1.y + n1.y * distance };
    const a2 = { x: p1.x + n2.x * distance, y: p1.y + n2.y * distance };
    const b2 = { x: p2.x + n2.x * distance, y: p2.y + n2.y * distance };

    const d1 = { x: b1.x - a1.x, y: b1.y - a1.y };
    const d2 = { x: b2.x - a2.x, y: b2.y - a2.y };
    const denom = d1.x * d2.y - d1.y * d2.x;

    if (Math.abs(denom) > 1e-9) {
      const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / denom;
      const inter = { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
      const dist = Math.hypot(inter.x - p1.x, inter.y - p1.y);
      if (dist <= Math.abs(distance) * 2.5 + 1e-6) {
        out.push(inter);
        continue;
      }
    }
    const mid = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
    out.push({ x: p1.x + mid.x * distance, y: p1.y + mid.y * distance });
  }
  return out;
}

function toPathData(points: Vec[], closed: boolean): string {
  if (points.length === 0) return '';
  const parts = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)} ${p.y.toFixed(4)}`);
  return `${parts.join(' ')}${closed ? ' Z' : ''}`;
}

/** Offset a closed polygon by distance (positive expands, negative shrinks). */
export function offsetPolygonPoints(
  points: { x: number; y: number }[],
  distance: number,
): { x: number; y: number }[] {
  if (points.length < 3 || Math.abs(distance) < 1e-6) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const magnitude = Math.abs(distance);
  const candidates = [offsetPolygon(points, magnitude), offsetPolygon(points, -magnitude)];
  const areas = candidates.map((c) => Math.abs(area(c)));
  const chosen =
    distance >= 0
      ? areas[0] >= areas[1]
        ? candidates[0]
        : candidates[1]
      : areas[0] <= areas[1]
        ? candidates[0]
        : candidates[1];
  return chosen;
}

/** Absolute area of a closed polygon (mm²). */
export function polygonArea(points: { x: number; y: number }[]): number {
  return Math.abs(area(points));
}

/**
 * Approximate outline offset for polygonal geometry. Curves are flattened to
 * their anchor points, which is accurate for rectangles/polygons and close
 * enough for laser kerf compensation preview.
 */
export function offsetPathData(pathData: string, distance: number): string | null {
  const item = new paper.CompoundPath(pathData);
  const results: string[] = [];

  const paths: paper.Path[] = [];
  if (item instanceof paper.Path) paths.push(item);
  else if (item instanceof paper.CompoundPath) {
    for (const child of item.children ?? []) {
      if (child instanceof paper.Path) paths.push(child);
    }
  }

  for (const p of paths) {
    // Densify curves first so offsets follow arcs instead of jumping across
    // their control points.
    try {
      p.flatten(0.12);
    } catch {
      /* flatten is best-effort */
    }
    const pts = p.segments.map((s) => ({ x: s.point.x, y: s.point.y }));
    if (pts.length < 3) continue;
    const closed = p.closed;

    // The normal direction depends on the path winding, so evaluate both
    // candidates and pick the one that grows (positive offset) or shrinks
    // (negative offset) the enclosed area.
    const magnitude = Math.abs(distance);
    const candidates = [offsetPolygon(pts, magnitude), offsetPolygon(pts, -magnitude)];
    const areas = candidates.map((c) => Math.abs(area(c)));
    const chosen =
      distance >= 0
        ? areas[0] >= areas[1]
          ? candidates[0]
          : candidates[1]
        : areas[0] <= areas[1]
          ? candidates[0]
          : candidates[1];

    results.push(toPathData(chosen, closed));
  }

  item.remove();
  if (results.length === 0) return null;
  return results.join(' ');
}

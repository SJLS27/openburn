import type { PlanSegment, Pt } from './types';

interface Item {
  rapid: PlanSegment | null;
  cut: PlanSegment;
}

const MAX_ITEMS = 2500;

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/**
 * Reorder cut segments with a greedy nearest-neighbour pass to reduce travel.
 * Layer order is preserved, and open polylines may be reversed. Very large
 * jobs are left untouched to avoid quadratic blow-ups.
 */
export function optimizeSegments(segments: PlanSegment[]): PlanSegment[] {
  if (segments.length < 4) return segments;

  const items: Item[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg.kind === 'rapid') {
      const next = segments[i + 1];
      if (next && next.kind === 'cut') {
        items.push({ rapid: seg, cut: next });
        i += 1;
      } else {
        return segments;
      }
    } else {
      items.push({ rapid: null, cut: seg });
    }
  }

  if (items.length < 2) return segments;

  const blocks: Item[][] = [];
  let current: Item[] = [];
  let layerId: string | undefined;
  for (const item of items) {
    const id = item.cut.layerId;
    if (current.length > 0 && id !== layerId) {
      blocks.push(current);
      current = [];
    }
    layerId = id;
    current.push(item);
  }
  if (current.length > 0) blocks.push(current);

  const out: PlanSegment[] = [];

  for (const block of blocks) {
    if (block.length < 2 || block.length > MAX_ITEMS) {
      for (const item of block) {
        if (item.rapid) out.push(item.rapid);
        out.push(item.cut);
      }
      continue;
    }

    const remaining = [...block];
    let position: Pt = remaining[0].cut.points[0] ?? { x: 0, y: 0 };

    while (remaining.length > 0) {
      let best = 0;
      let bestDistance = Infinity;
      let reverse = false;

      for (let i = 0; i < remaining.length; i += 1) {
        const points = remaining[i].cut.points;
        if (points.length === 0) {
          best = i;
          bestDistance = -1;
          break;
        }
        const dStart = distance(position, points[0]);
        const dEnd = distance(position, points[points.length - 1]);
        const d = Math.min(dStart, dEnd);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
          reverse = dEnd < dStart;
        }
      }

      const item = remaining.splice(best, 1)[0];
      let points = item.cut.points;
      let powers = item.cut.powers;
      const closed =
        points.length > 2 && samePoint(points[0], points[points.length - 1]);

      if (reverse && !closed && points.length > 1) {
        points = [...points].reverse();
        powers = powers ? [...powers].reverse() : undefined;
      }

      const start = points[0] ?? position;
      out.push({ kind: 'rapid', points: [start] });
      out.push({ ...item.cut, points, powers });
      position = points[points.length - 1] ?? position;
    }
  }

  return out;
}

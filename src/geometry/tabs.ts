import type { Pt } from '@/gcode/types';

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function ringLength(ring: Pt[]): number {
  let total = 0;
  for (let i = 1; i < ring.length; i += 1) total += distance(ring[i - 1], ring[i]);
  return total;
}

function pointAt(ring: Pt[], target: number): Pt {
  let walked = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const seg = distance(ring[i - 1], ring[i]);
    if (walked + seg >= target || i === ring.length - 1) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (target - walked) / seg)) : 0;
      return {
        x: ring[i - 1].x + (ring[i].x - ring[i - 1].x) * t,
        y: ring[i - 1].y + (ring[i].y - ring[i - 1].y) * t,
      };
    }
    walked += seg;
  }
  return ring[ring.length - 1];
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || distance(prev, p) > 1e-5) out.push(p);
  }
  return out;
}

function sliceRing(ring: Pt[], from: number, to: number): Pt[] {
  const points: Pt[] = [pointAt(ring, from)];
  let walked = 0;
  for (let i = 1; i < ring.length; i += 1) {
    walked += distance(ring[i - 1], ring[i]);
    if (walked > from + 1e-7 && walked < to - 1e-7) points.push(ring[i]);
  }
  points.push(pointAt(ring, to));
  return dedupe(points);
}

/**
 * Split a closed contour into open polylines leaving small uncut gaps (tabs).
 */
export function addTabsToContour(
  points: Pt[],
  tabWidth: number,
  spacing: number,
): Pt[][] {
  if (points.length < 3 || tabWidth <= 0 || spacing <= 0) return [points];

  const ring = [...points];
  if (!samePoint(ring[0], ring[ring.length - 1])) ring.push(ring[0]);

  const total = ringLength(ring);
  if (total <= 0) return [points];

  const step = Math.max(tabWidth + 0.5, spacing);
  if (total < step) return [points];

  const gaps: [number, number][] = [];
  for (let start = step / 2; start < total; start += step) {
    gaps.push([start, Math.min(total, start + tabWidth)]);
  }

  const kept: [number, number][] = [];
  let cursor = 0;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart > cursor) kept.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < total) kept.push([cursor, total]);

  const out: Pt[][] = [];
  for (const [from, to] of kept) {
    if (to - from < 0.2) continue;
    const piece = sliceRing(ring, from, to);
    if (piece.length >= 2) out.push(piece);
  }
  return out.length > 0 ? out : [points];
}

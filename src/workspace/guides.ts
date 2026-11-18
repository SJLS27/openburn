import type { Guide } from '@/types/document';
import type { Pt } from './nodes';
import type { SnapShape, SnapTarget } from './snap';

/**
 * Ruler guides: the persistent guides the user drags out of the rulers, as
 * opposed to the transient ones the snapper shows while dragging an object.
 *
 * Everything here is pure; the controller owns the Fabric representation and
 * the document stores the positions, so guides survive save/load.
 */

export const MAX_GUIDES = 64;

/** Round to 1 µm so dragging out a guide does not store float noise. */
export function roundGuide(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Append a guide unless one already sits within `tolerance` on that axis. */
export function addGuide(
  guides: readonly Guide[],
  axis: Guide['axis'],
  position: number,
  tolerance = 0.5,
): Guide[] {
  if (!Number.isFinite(position)) return [...guides];
  const rounded = roundGuide(position);
  const duplicate = guides.some(
    (g) => g.axis === axis && Math.abs(g.position - rounded) <= tolerance,
  );
  if (duplicate || guides.length >= MAX_GUIDES) return [...guides];
  return [...guides, { axis, position: rounded }];
}

/** Remove the guide closest to `position` on `axis` (within `tolerance`). */
export function removeGuideAt(
  guides: readonly Guide[],
  axis: Guide['axis'],
  position: number,
  tolerance = 0.5,
): Guide[] {
  let bestIndex = -1;
  let bestDistance = Infinity;
  guides.forEach((guide, index) => {
    if (guide.axis !== axis) return;
    const distance = Math.abs(guide.position - position);
    if (distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) return [...guides];
  return guides.filter((_, index) => index !== bestIndex);
}

/** Move the guide at `index`, keeping the list otherwise intact. */
export function moveGuide(guides: readonly Guide[], index: number, position: number): Guide[] {
  if (index < 0 || index >= guides.length || !Number.isFinite(position)) return [...guides];
  return guides.map((guide, i) => (i === index ? { ...guide, position: roundGuide(position) } : guide));
}

/**
 * Snap shapes for the guides so the normal snapper can target them: a vertical
 * guide is a zero-width shape spanning the bed, and its centre is the line.
 */
export function guideShapes(
  guides: readonly Guide[],
  bed: { width: number; height: number },
): SnapShape[] {
  return guides.map((guide, index) => ({
    id: `guide:${guide.axis}:${index}`,
    corners:
      guide.axis === 'x'
        ? [
            { x: guide.position, y: 0 },
            { x: guide.position, y: bed.height },
          ]
        : [
            { x: 0, y: guide.position },
            { x: bed.width, y: guide.position },
          ],
  }));
}

/** Snap targets a guide offers to a drawn point (its centre line). */
export function guideTargets(guides: readonly Guide[]): SnapTarget[] {
  return guides.map((guide, index) => ({
    kind: 'guide',
    position:
      guide.axis === 'x'
        ? { x: guide.position, y: 0 }
        : { x: 0, y: guide.position },
    source: `guide:${guide.axis}:${index}`,
  }));
}

/**
 * Point on a guide closest to `p`, or `null` when the pointer is further than
 * `radius` from the line. Used when drawing a point that prefers guides.
 */
export function snapToGuide(guides: readonly Guide[], p: Pt, radius: number): Pt | null {
  let best: { distance: number; point: Pt } | null = null;
  for (const guide of guides) {
    const distance = guide.axis === 'x' ? Math.abs(p.x - guide.position) : Math.abs(p.y - guide.position);
    if (distance > radius) continue;
    if (best && distance >= best.distance) continue;
    best = {
      distance,
      point: guide.axis === 'x' ? { x: guide.position, y: p.y } : { x: p.x, y: guide.position },
    };
  }
  return best?.point ?? null;
}

/** Index of the guide under a scene point, for selection and deletion. */
export function guideAt(
  guides: readonly Guide[],
  p: Pt,
  radius: number,
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  guides.forEach((guide, index) => {
    const distance = guide.axis === 'x' ? Math.abs(p.x - guide.position) : Math.abs(p.y - guide.position);
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

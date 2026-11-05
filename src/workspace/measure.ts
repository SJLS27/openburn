import type { Pt } from '@/gcode/types';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LiveMeasure {
  width: number;
  height: number;
  /** Displacement of the top-left corner since the drag started. */
  dx: number;
  dy: number;
  /** Rotation in degrees. */
  angle: number;
  /** Length of a single selected line / measured segment, if any. */
  length?: number;
}

/**
 * Numbers shown while the user moves, scales or rotates a selection. The
 * bounding box is compared with the box captured when the gesture started, so
 * ΔX/ΔY measure the actual movement instead of the absolute position.
 */
export function liveMeasure(start: Box, current: Box, angle: number, length?: number): LiveMeasure {
  return {
    width: current.width,
    height: current.height,
    dx: current.left - start.left,
    dy: current.top - start.top,
    angle,
    ...(length !== undefined ? { length } : {}),
  };
}

/** Total length of a polyline, used for line / measure objects. */
export function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Angle of a line in degrees, normalised to -180..180. */
export function segmentAngle(points: Pt[]): number {
  if (points.length < 2) return 0;
  const a = points[0];
  const b = points[points.length - 1];
  // Canvas Y grows downwards; flip it so "up" is positive like a protractor.
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
  if (deg > 180) return deg - 360;
  if (deg <= -180) return deg + 360;
  return deg;
}

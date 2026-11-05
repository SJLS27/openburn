/**
 * Pure geometry helpers for the Shape Properties panel.
 *
 * The panel edits the axis-aligned bounding box of the selection (like
 * LightBurn): X/Y are the top-left corner and W/H the visible size, even when
 * the objects are rotated. Fabric has no direct "set the bounding box" API, so
 * the scale factor per local axis is solved here and then applied to the
 * active object.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LocalSize {
  /** Untransformed object size along its own axes. */
  width: number;
  height: number;
}

export interface ScaleSolution {
  scaleX: number;
  scaleY: number;
}

/** Rotate a vector about the origin by `angleDeg` degrees. */
function rotatePoint(p: { x: number; y: number }, angleDeg: number): { x: number; y: number } {

  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * AABB of a rectangle with local half-extents hx/hy, rotated by `angleDeg`
 * around its centre.
 */
export function rotatedExtent(halfWidth: number, halfHeight: number, angleDeg: number): {
  halfWidth: number;
  halfHeight: number;
} {
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
  ].map((p) => rotatePoint(p, angleDeg));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2,
    halfHeight: (Math.max(...ys) - Math.min(...ys)) / 2,
  };
}

/**
 * Scale factors that make the bounding box of a rotated object match
 * `targetWidth` x `targetHeight`.
 *
 *   W = w·sx·|cos θ| + h·sy·|sin θ|
 *   H = w·sx·|sin θ| + h·sy·|cos θ|
 *
 * `sx` applies to the object's local X axis and `sy` to its local Y axis. The
 * determinant can vanish near 45°, in which case each axis is scaled
 * independently from its dominant term.
 */
export function boundingBoxScale(
  size: LocalSize,
  angleDeg: number,
  target: { width: number; height: number },
): ScaleSolution {
  const w = Math.max(1e-9, size.width);
  const h = Math.max(1e-9, size.height);
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));

  const a = w * c;
  const b = h * s;
  const c2 = w * s;
  const d = h * c;
  const det = a * d - b * c2;

  if (Math.abs(det) < 1e-6) {
    // Parallel case (θ ≈ 45°): both equations carry the same information,
    // split the target evenly so the result stays stable.
    const targetHalf = target.width / 2 + target.height / 2;
    const currentHalf = a + b;
    const factor = currentHalf > 1e-9 ? targetHalf / currentHalf : 1;
    return { scaleX: factor, scaleY: factor };
  }

  return {
    scaleX: (target.width * d - target.height * b) / det,
    scaleY: (a * target.height - c2 * target.width) / det,
  };
}

/** New top-left so a box moves as a whole to the requested X/Y. */
export function translateDelta(box: Box, target: { x?: number; y?: number }): { dx: number; dy: number } {
  return {
    dx: target.x !== undefined ? target.x - box.left : 0,
    dy: target.y !== undefined ? target.y - box.top : 0,
  };
}

/** Centre of a box. */
export function boxCenter(box: Box): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

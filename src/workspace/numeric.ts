import { boundingBoxScale, rotatedExtent } from './transform';

/**
 * Port of the bits of a Fabric object the numeric size editor needs. Keeping
 * this narrow lets the size/position logic be unit-tested without a canvas.
 */
export interface NumericTarget {
  /** Current rotation in degrees. */
  get angle(): number;
  setAngle(angle: number): void;
  /** Untransformed size including the current scale and stroke. */
  getScaledSize(): { x: number; y: number };
  getScale(): { x: number; y: number };
  setScale(x: number, y: number): void;
  /** Axis-aligned bounds with the current transform. */
  getBounds(): { left: number; top: number; width: number; height: number };
  /** Translate in scene units. */
  move(dx: number, dy: number): void;
  syncCoords(): void;
}

export interface NumericPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
}

export interface NumericOptions {
  /** Proportional scaling (the W/H lock); stretch is then skipped. */
  lockAspect: boolean;
}

/**
 * Resolve the W/H part of a patch according to the aspect lock. With the lock
 * on, the edited axis wins and the other follows; when both are present (never
 * produced by the panel) the width wins.
 */
export function resolveSizePatch(
  box: { width: number; height: number },
  patch: NumericPatch,
  lockAspect: boolean,
): NumericPatch {
  if (!lockAspect || (patch.width === undefined && patch.height === undefined)) return patch;
  if (box.width <= 1e-9 || box.height <= 1e-9) return patch;
  const ratio = box.width / box.height;
  if (patch.width === undefined) {
    return { ...patch, width: Math.abs((patch.height as number) * ratio) };
  }
  if (patch.height === undefined) {
    return { ...patch, height: Math.abs(patch.width / ratio) };
  }
  return { ...patch, height: Math.abs(patch.width / ratio) };
}

/**
 * Apply a numeric patch to one object so its axis-aligned bounding box ends up
 * at the requested X/Y and W/H, keeping its rotation. Scaling is solved so the
 * box is exact even when the object is rotated.
 */
export function applyNumericSingle(
  target: NumericTarget,
  patch: NumericPatch,
  options: NumericOptions,
): void {
  const resolved = resolveSizePatch(
    { width: target.getBounds().width, height: target.getBounds().height },
    patch,
    options.lockAspect,
  );

  if (resolved.angle !== undefined) target.setAngle(resolved.angle);
  const angle = target.angle;

  if (resolved.width !== undefined || resolved.height !== undefined) {
    const size = target.getScaledSize();
    const scale = target.getScale();
    const current = rotatedExtent(
      (size.x * Math.abs(scale.x)) / 2,
      (size.y * Math.abs(scale.y)) / 2,
      angle,
    );
    const solution = boundingBoxScale(
      { width: Math.max(1e-6, size.x), height: Math.max(1e-6, size.y) },
      angle,
      {
        width: resolved.width ?? current.halfWidth * 2,
        height: resolved.height ?? current.halfHeight * 2,
      },
    );
    target.setScale(scale.x * solution.scaleX, scale.y * solution.scaleY);
  }

  if (resolved.x !== undefined || resolved.y !== undefined) {
    target.syncCoords();
    const rect = target.getBounds();
    target.move((resolved.x ?? rect.left) - rect.left, (resolved.y ?? rect.top) - rect.top);
  }
  target.syncCoords();
}

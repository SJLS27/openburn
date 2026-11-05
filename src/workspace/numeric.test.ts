import { describe, expect, it } from 'vitest';
import { applyNumericSingle, resolveSizePatch, type NumericTarget } from './numeric';

/**
 * Minimal Fabric-like object: a rectangle of `w` x `h` (unscaled), rotated
 * about its centre, with `scaleX`/`scaleY` multipliers.
 */
function makeTarget(w: number, h: number, angle = 0, scale = 1): NumericTarget & {
  state: { angle: number; scaleX: number; scaleY: number; left: number; top: number };
} {
  const state = { angle, scaleX: scale, scaleY: scale, left: 10, top: 20 };
  const hv = (a: number) => Math.abs(Math.cos((a * Math.PI) / 180));
  const sv = (a: number) => Math.abs(Math.sin((a * Math.PI) / 180));
  const bounds = () => {
    const ww = w * Math.abs(state.scaleX);
    const hh = h * Math.abs(state.scaleY);
    const width = ww * hv(state.angle) + hh * sv(state.angle);
    const height = ww * sv(state.angle) + hh * hv(state.angle);
    return { left: state.left, top: state.top, width, height };
  };
  const target: NumericTarget & { state: typeof state } = {
    state,
    get angle() {
      return state.angle;
    },
    setAngle(a: number) {
      state.angle = a;
    },
    getScaledSize: () => ({ x: w, y: h }),
    getScale: () => ({ x: state.scaleX, y: state.scaleY }),
    setScale(x: number, y: number) {
      state.scaleX = x;
      state.scaleY = y;
    },
    getBounds: bounds,
    move(dx: number, dy: number) {
      state.left += dx;
      state.top += dy;
    },
    syncCoords: () => {},
  };
  return target;
}

describe('workspace/numeric', () => {
  it('sets the bounding box width and height exactly', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { width: 200, height: 100 }, { lockAspect: false });
    const b = t.getBounds();
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.height).toBeCloseTo(100, 6);
  });

  it('moves the top-left corner (X/Y)', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { x: 100, y: 200 }, { lockAspect: false });
    const b = t.getBounds();
    expect(b.left).toBeCloseTo(100, 6);
    expect(b.top).toBeCloseTo(200, 6);
  });

  it('scales a rotated object so the box is exact', () => {
    const t = makeTarget(100, 50, 30);
    applyNumericSingle(t, { width: 180, height: 140 }, { lockAspect: false });
    const b = t.getBounds();
    expect(b.width).toBeCloseTo(180, 5);
    expect(b.height).toBeCloseTo(140, 5);
  });

  it('keeps the ratio when the lock is on', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { width: 300 }, { lockAspect: true });
    const b = t.getBounds();
    expect(b.width).toBeCloseTo(300, 6);
    expect(b.height).toBeCloseTo(150, 6);
  });

  it('derives the width from a height edit when locked', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { height: 25 }, { lockAspect: true });
    const b = t.getBounds();
    expect(b.width).toBeCloseTo(50, 6);
    expect(b.height).toBeCloseTo(25, 6);
  });

  it('does not touch the ratio when the lock is off', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { width: 300 }, { lockAspect: false });
    const b = t.getBounds();
    expect(b.height).toBeCloseTo(50, 6);
  });

  it('rotates and keeps the edited size', () => {
    const t = makeTarget(100, 50);
    applyNumericSingle(t, { angle: 90, width: 60, height: 120 }, { lockAspect: false });
    expect(t.angle).toBe(90);
    const b = t.getBounds();
    expect(b.width).toBeCloseTo(60, 5);
    expect(b.height).toBeCloseTo(120, 5);
  });

  it('returns the patch unchanged when no size is present', () => {
    const patch = { x: 1, angle: 10 };
    expect(resolveSizePatch({ width: 10, height: 10 }, patch, true)).toBe(patch);
  });

  it('never produces negative sizes', () => {
    const resolved = resolveSizePatch({ width: 100, height: 50 }, { width: -50 }, true);
    expect(resolved.width).toBe(-50);
    expect(resolved.height).toBeCloseTo(25, 6);
  });
});

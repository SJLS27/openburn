import { describe, expect, it } from 'vitest';
import { boundingBoxScale, rotatedExtent, translateDelta } from './transform';

describe('workspace/transform', () => {
  it('scales an unrotated box directly', () => {
    const s = boundingBoxScale({ width: 100, height: 50 }, 0, { width: 200, height: 100 });
    expect(s.scaleX).toBeCloseTo(2, 9);
    expect(s.scaleY).toBeCloseTo(2, 9);
  });

  it('scales a rotated box so its bounding box matches the target', () => {
    const size = { width: 100, height: 50 };
    const angle = 30;
    const s = boundingBoxScale(size, angle, { width: 200, height: 120 });

    // Rebuild the bounding box with the solved scale and compare.
    const ext = rotatedExtent((size.width * s.scaleX) / 2, (size.height * s.scaleY) / 2, angle);
    expect(ext.halfWidth * 2).toBeCloseTo(200, 6);
    expect(ext.halfHeight * 2).toBeCloseTo(120, 6);
  });

  it('keeps a 90° rotated box exact', () => {
    const size = { width: 100, height: 50 };
    const s = boundingBoxScale(size, 90, { width: 60, height: 120 });
    const ext = rotatedExtent((size.width * s.scaleX) / 2, (size.height * s.scaleY) / 2, 90);
    expect(ext.halfWidth * 2).toBeCloseTo(60, 6);
    expect(ext.halfHeight * 2).toBeCloseTo(120, 6);
  });

  it('stays stable near 45°', () => {
    const s = boundingBoxScale({ width: 100, height: 100 }, 45, { width: 200, height: 200 });
    expect(Number.isFinite(s.scaleX)).toBe(true);
    expect(Number.isFinite(s.scaleY)).toBe(true);
    expect(s.scaleX).toBeGreaterThan(0);
  });

  it('computes the translation keeping the top-left corner', () => {
    expect(translateDelta({ left: 10, top: 20, width: 30, height: 40 }, { x: 50 })).toEqual({
      dx: 40,
      dy: 0,
    });
  });
});

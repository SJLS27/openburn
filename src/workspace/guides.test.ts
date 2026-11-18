import { describe, expect, it } from 'vitest';
import {
  MAX_GUIDES,
  addGuide,
  guideAt,
  guideShapes,
  guideTargets,
  moveGuide,
  removeGuideAt,
  roundGuide,
  snapToGuide,
} from './guides';

const bed = { width: 400, height: 300 };

describe('workspace/guides', () => {
  describe('addGuide', () => {
    it('adds a vertical and a horizontal guide', () => {
      let guides = addGuide([], 'x', 100);
      guides = addGuide(guides, 'y', 50);
      expect(guides).toEqual([
        { axis: 'x', position: 100 },
        { axis: 'y', position: 50 },
      ]);
    });

    it('rounds to microns so dragging does not store float noise', () => {
      expect(roundGuide(12.3456789)).toBe(12.346);
      expect(addGuide([], 'x', 12.3456789)[0].position).toBe(12.346);
    });

    it('does not stack guides on top of each other', () => {
      const first = addGuide([], 'x', 100);
      const second = addGuide(first, 'x', 100.2);
      expect(second).toHaveLength(1);
    });

    it('allows a horizontal guide at the same position as a vertical one', () => {
      const guides = addGuide(addGuide([], 'x', 100), 'y', 100);
      expect(guides).toHaveLength(2);
    });

    it('ignores NaN positions', () => {
      expect(addGuide([], 'x', Number.NaN)).toEqual([]);
    });

    it('stops at MAX_GUIDES', () => {
      let guides: ReturnType<typeof addGuide> = [];
      for (let i = 0; i < MAX_GUIDES + 5; i += 1) guides = addGuide(guides, 'x', i * 2);
      expect(guides).toHaveLength(MAX_GUIDES);
    });
  });

  describe('removeGuideAt', () => {
    const guides = [
      { axis: 'x' as const, position: 100 },
      { axis: 'y' as const, position: 50 },
    ];

    it('removes the guide under the pointer', () => {
      expect(removeGuideAt(guides, 'x', 100.1)).toEqual([{ axis: 'y', position: 50 }]);
    });

    it('leaves the list alone when nothing is close enough', () => {
      expect(removeGuideAt(guides, 'x', 150)).toEqual(guides);
    });

    it('only considers the requested axis', () => {
      expect(removeGuideAt(guides, 'x', 50)).toEqual(guides);
    });
  });

  describe('moveGuide', () => {
    it('moves one guide and leaves the rest untouched', () => {
      const guides = [
        { axis: 'x' as const, position: 10 },
        { axis: 'x' as const, position: 20 },
      ];
      expect(moveGuide(guides, 1, 33.3333)).toEqual([
        { axis: 'x', position: 10 },
        { axis: 'x', position: 33.333 },
      ]);
    });

    it('ignores an out-of-range index', () => {
      const guides = [{ axis: 'x' as const, position: 10 }];
      expect(moveGuide(guides, 5, 20)).toEqual(guides);
    });
  });

  describe('guideShapes', () => {
    it('turns a vertical guide into a zero-width shape across the bed', () => {
      const [shape] = guideShapes([{ axis: 'x', position: 120 }], bed);
      expect(shape.corners).toEqual([
        { x: 120, y: 0 },
        { x: 120, y: 300 },
      ]);
    });

    it('spans the width for a horizontal guide', () => {
      const [shape] = guideShapes([{ axis: 'y', position: 42 }], bed);
      expect(shape.corners).toEqual([
        { x: 0, y: 42 },
        { x: 400, y: 42 },
      ]);
    });

    it('gives every guide a distinct id', () => {
      const shapes = guideShapes(
        [
          { axis: 'x', position: 10 },
          { axis: 'x', position: 20 },
        ],
        bed,
      );
      expect(new Set(shapes.map((s) => s.id)).size).toBe(2);
    });
  });

  describe('guideTargets', () => {
    it('offers the guide line as a snap target', () => {
      const [target] = guideTargets([{ axis: 'x', position: 77 }]);
      expect(target.kind).toBe('guide');
      expect(target.position.x).toBe(77);
    });
  });

  describe('snapToGuide', () => {
    const guides = [
      { axis: 'x' as const, position: 100 },
      { axis: 'y' as const, position: 200 },
    ];

    it('snaps the axis closest to the pointer and keeps the other one free', () => {
      expect(snapToGuide(guides, { x: 101, y: 150 }, 2)).toEqual({ x: 100, y: 150 });
      expect(snapToGuide(guides, { x: 150, y: 199 }, 2)).toEqual({ x: 150, y: 200 });
    });

    it('returns null when the pointer is far from every guide', () => {
      expect(snapToGuide(guides, { x: 300, y: 50 }, 2)).toBeNull();
    });

    it('picks the nearest when two guides are in range', () => {
      const close = [
        { axis: 'x' as const, position: 100 },
        { axis: 'x' as const, position: 101 },
      ];
      expect(snapToGuide(close, { x: 100.6, y: 0 }, 2)).toEqual({ x: 101, y: 0 });
    });
  });

  describe('guideAt', () => {
    it('finds the guide under the pointer for selection', () => {
      const guides = [{ axis: 'x' as const, position: 100 }];
      expect(guideAt(guides, { x: 100.3, y: 999 }, 1)).toBe(0);
      expect(guideAt(guides, { x: 120, y: 999 }, 1)).toBe(-1);
    });
  });
});

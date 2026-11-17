import { describe, expect, it } from 'vitest';
import { BED_ORIGIN_OPTIONS, BED_ORIGINS, isBedOrigin, mapBedPoint } from './origin';

const BED = { width: 400, height: 300 };

describe('gcode/origin', () => {
  describe('mapBedPoint', () => {
    it('keeps the design coordinates for a bottom-left machine zero', () => {
      expect(mapBedPoint({ x: 10, y: 20 }, BED, 'bottom-left')).toEqual({ x: 10, y: 300 - 20 });
    });

    it('does not mirror either axis for a top-left machine zero', () => {
      expect(mapBedPoint({ x: 10, y: 20 }, BED, 'top-left')).toEqual({ x: 10, y: 20 });
    });

    it('mirrors both axes for a bottom-right machine zero', () => {
      expect(mapBedPoint({ x: 10, y: 20 }, BED, 'bottom-right')).toEqual({ x: 390, y: 280 });
    });

    it('mirrors only X for a top-right machine zero', () => {
      expect(mapBedPoint({ x: 10, y: 20 }, BED, 'top-right')).toEqual({ x: 390, y: 20 });
    });

    it('maps the bed origin corner to 0,0 for every origin', () => {
      const corner = { width: 400, height: 300 };
      const cases = {
        'bottom-left': { x: 0, y: 300 },
        'top-left': { x: 0, y: 0 },
        'bottom-right': { x: 400, y: 300 },
        'top-right': { x: 400, y: 0 },
      } as const;
      for (const origin of BED_ORIGINS) {
        expect(mapBedPoint({ x: 0, y: 0 }, corner, origin)).toEqual(cases[origin]);
      }
    });

    it('is an involution: applying it twice returns the original point', () => {
      for (const origin of BED_ORIGINS) {
        const once = mapBedPoint({ x: 37, y: 81 }, BED, origin);
        const twice = mapBedPoint(once, BED, origin);
        expect(twice.x).toBeCloseTo(37, 10);
        expect(twice.y).toBeCloseTo(81, 10);
      }
    });

    it('does not mutate the input point', () => {
      const p = { x: 5, y: 6 };
      mapBedPoint(p, BED, 'bottom-right');
      expect(p).toEqual({ x: 5, y: 6 });
    });
  });

  describe('BED_ORIGIN_OPTIONS', () => {
    it('offers one option per corner', () => {
      expect(BED_ORIGIN_OPTIONS).toHaveLength(4);
      expect(new Set(BED_ORIGIN_OPTIONS.map((o) => o.value))).toEqual(new Set(BED_ORIGINS));
    });
  });

  describe('isBedOrigin', () => {
    it('accepts every known corner and rejects anything else', () => {
      for (const origin of BED_ORIGINS) expect(isBedOrigin(origin)).toBe(true);
      expect(isBedOrigin('center')).toBe(false);
      expect(isBedOrigin(undefined)).toBe(false);
      expect(isBedOrigin(0)).toBe(false);
    });
  });
});

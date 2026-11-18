import { describe, expect, it } from 'vitest';
import type { JobPlan, PlanSegment, Pt } from '@/gcode/types';
import {
  CHUNK_SIZE,
  LOD_LEVELS,
  buildPreviewGeometry,
  chunkPaths,
  completedPaths,
  lodFor,
  polylinePath,
  simplify,
  simplifyFor,
  thin,
} from './previewPaths';

const BED = { width: 400, height: 300 };

function cut(points: Pt[], layerId = 'l1', powers?: number[]): PlanSegment {
  return { kind: 'cut', points, layerId, ...(powers ? { powers } : {}) };
}

function rapid(points: Pt[]): PlanSegment {
  return { kind: 'rapid', points };
}

function planWith(segments: PlanSegment[]): JobPlan {
  return {
    segments,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    gcode: [],
    timeSeconds: 1,
    cutDistance: 1,
    rapidDistance: 0,
    layerStats: [],
    lineCount: 0,
    warnings: [],
  };
}

const baseOpts = { zoom: 1, colorByLayer: new Map([['l1', '#ff0000']]), defaultColor: '#fff' };

describe('ui/previewPaths', () => {
  describe('lodFor', () => {
    it('maps zoom ranges to tiers', () => {
      expect(lodFor(0.1)).toBe('far');
      expect(lodFor(0.49)).toBe('far');
      expect(lodFor(0.5)).toBe('mid');
      expect(lodFor(1.9)).toBe('mid');
      expect(lodFor(2)).toBe('near');
      expect(lodFor(80)).toBe('near');
    });

    it('keeps the near tier lossless', () => {
      expect(LOD_LEVELS.near.tolerance).toBe(0);
      expect(LOD_LEVELS.near.minLength).toBe(0);
    });
  });

  describe('simplify (Douglas-Peucker)', () => {
    it('removes collinear midpoints', () => {
      const line: Pt[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      expect(simplify(line, 0.1)).toHaveLength(2);
    });

    it('keeps meaningful corners', () => {
      const l: Pt[] = [
        { x: 0, y: 0 },
        { x: 5, y: 3 },
        { x: 10, y: 0 },
      ];
      expect(simplify(l, 0.1)).toHaveLength(3);
    });

    it('is a no-op for tolerance 0 or short polylines', () => {
      const l: Pt[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      expect(simplify(l, 0)).toBe(l);
      expect(simplify([{ x: 0, y: 0 }], 1)).toHaveLength(1);
    });

    it('handles a long scan line without stack overflow', () => {
      const many: Pt[] = Array.from({ length: 20000 }, (_, i) => ({ x: i * 0.01, y: Math.sin(i) }));
      expect(() => simplify(many, 0.01)).not.toThrow();
    });
  });

  describe('thin', () => {
    it('drops points closer than the minimum length', () => {
      const pts: Pt[] = [
        { x: 0, y: 0 },
        { x: 0.05, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ];
      expect(thin(pts, 0.5)).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);
    });

    it('always keeps the endpoints', () => {
      const pts: Pt[] = [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
      ];
      expect(thin(pts, 10)).toHaveLength(2);
    });

    it('is a no-op when minLength is 0', () => {
      const pts: Pt[] = [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
      ];
      expect(thin(pts, 0)).toBe(pts);
    });
  });

  describe('simplifyFor', () => {
    it('never changes geometry in the near tier', () => {
      const pts: Pt[] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      expect(simplifyFor(pts, 5)).toBe(pts);
    });

    it('simplifies further when zoomed out', () => {
      const pts: Pt[] = [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.05 },
        { x: 0.4, y: 0 },
      ];
      expect(simplifyFor(pts, 0.3).length).toBeLessThan(pts.length);
    });
  });

  describe('polylinePath', () => {
    it('emits absolute M/L commands rounded to microns', () => {
      const d = polylinePath([
        { x: 0, y: 0 },
        { x: 10.12345, y: 5 },
      ]);
      expect(d).toBe('M0 0L10.123 5');
    });

    it('returns an empty string for no points', () => {
      expect(polylinePath([])).toBe('');
    });
  });

  describe('chunkPaths', () => {
    it('keeps short lists in one chunk', () => {
      expect(chunkPaths(['a', 'b'], 10)).toEqual(['ab']);
    });

    it('splits long lists into capped chunks', () => {
      const paths = Array.from({ length: 25 }, (_, i) => `p${i}`);
      const chunks = chunkPaths(paths, 10);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toContain('p0');
      expect(chunks[2]).toContain('p24');
    });

    it('defaults to CHUNK_SIZE and returns nothing for an empty list', () => {
      expect(CHUNK_SIZE).toBeGreaterThan(1000);
      expect(chunkPaths([])).toEqual([]);
    });
  });

  describe('buildPreviewGeometry', () => {
    it('groups cut paths by layer with their colour', () => {
      const g = buildPreviewGeometry(
        planWith([cut([{ x: 0, y: 0 }, { x: 10, y: 0 }])]),
        BED,
        baseOpts,
      );
      expect(g.toolpaths).toHaveLength(1);
      expect(g.toolpaths[0].layerId).toBe('l1');
      expect(g.toolpaths[0].color).toBe('#ff0000');
      expect(g.toolpaths[0].chunks[0]).toBe('M0 0L10 0');
      expect(g.bed).toEqual(BED);
    });

    it('falls back to the default colour for an unknown layer', () => {
      const g = buildPreviewGeometry(
        planWith([cut([{ x: 0, y: 0 }, { x: 1, y: 0 }], 'ghost')]),
        BED,
        baseOpts,
      );
      expect(g.toolpaths[0].color).toBe('#fff');
    });

    it('records travel between cut segments and skips tiny moves', () => {
      const g = buildPreviewGeometry(
        planWith([
          cut([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
          rapid([{ x: 10, y: 0 }]),
          // 0.01 mm hop: not worth a stroke.
          rapid([{ x: 10.01, y: 0 }]),
          rapid([{ x: 50, y: 50 }]),
          cut([{ x: 50, y: 50 }, { x: 60, y: 50 }]),
        ]),
        BED,
        baseOpts,
      );
      const travel = g.travel.join('');
      // The 0.01 mm hop draws nothing, but the head is now at 10.01; only the
      // long move produces a subpath.
      expect(travel).toBe('M10.01 0L50 50');
    });

    it('draws only the lit runs of a raster segment', () => {
      const g = buildPreviewGeometry(
        planWith([
          cut(
            [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 10, y: 0 },
            ],
            'l1',
            [0, 100, 0],
          ),
        ]),
        BED,
        baseOpts,
      );
      // One lit run → one subpath, not the whole 10 mm scan line.
      expect(g.toolpaths[0].chunks[0]).toBe('M5 0L10 0');
    });

    it('skips empty and single-point segments', () => {
      const g = buildPreviewGeometry(
        planWith([
          { kind: 'cut', points: [], layerId: 'l1' },
          cut([{ x: 1, y: 1 }]),
        ]),
        BED,
        baseOpts,
      );
      expect(g.toolpaths).toHaveLength(0);
    });

    it('chunks 12k segments into several paths', () => {
      const segments = Array.from({ length: 12000 }, (_, i) =>
        cut([{ x: i % 100, y: Math.floor(i / 100) }, { x: (i % 100) + 1, y: Math.floor(i / 100) }]),
      );
      const g = buildPreviewGeometry(planWith(segments), BED, baseOpts);
      expect(g.toolpaths[0].chunks.length).toBeGreaterThan(1);
    });
  });

  describe('completedPaths', () => {
    it('only includes cut segments before the playhead', () => {
      const plan = planWith([
        cut([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
        rapid([{ x: 20, y: 0 }]),
        cut([{ x: 20, y: 0 }, { x: 30, y: 0 }]),
      ]);
      const done = completedPaths(plan, 1, baseOpts);
      expect(done[0].chunks.join('')).toBe('M0 0L10 0');
    });

    it('returns nothing at the start and everything at the end', () => {
      const plan = planWith([cut([{ x: 0, y: 0 }, { x: 10, y: 0 }])]);
      expect(completedPaths(plan, 0, baseOpts)).toEqual([]);
      expect(completedPaths(plan, 99, baseOpts)[0].chunks[0]).toBe('M0 0L10 0');
    });
  });
});

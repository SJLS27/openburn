import { describe, expect, it, vi } from 'vitest';
import { FabricImage } from 'fabric';
import { DEFAULT_DEVICE, DEFAULT_OPTIMIZATION } from './types';
import { DEFAULT_CUT_SETTINGS, createLayer, type LayerDef } from '@/types/document';
import { buildJob } from './job';

// jsdom has no real 2D canvas, so rasterising would always fail. Stub the
// rasteriser to return one scan line and assert the job wires it into a cut
// path (the regression we care about: images must not be silently dropped).
const mocks = vi.hoisted(() => ({
  rasterRows: vi.fn(() => [
    { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], powers: [50, 50] },
  ]),
}));

vi.mock('./geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./geometry')>();
  return { ...actual, rasterRows: mocks.rasterRows };
});

function makeImage(layerId: string): FabricImage {
  const el = document.createElement('img');
  Object.defineProperty(el, 'naturalWidth', { value: 100 });
  Object.defineProperty(el, 'naturalHeight', { value: 100 });
  const image = new FabricImage(el, { left: 0, top: 0, scaleX: 1, scaleY: 1 });
  image.set('layerId', layerId);
  return image;
}

function layerWithMode(mode: LayerDef['settings']['mode'], id = 'layer-image'): LayerDef {
  return {
    ...createLayer(0),
    id,
    settings: { ...DEFAULT_CUT_SETTINGS, mode },
  };
}

describe('buildJob images', () => {
  it('rasterises images on an Image-mode layer into cut paths', async () => {
    mocks.rasterRows.mockClear();
    const layer = layerWithMode('image');

    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: DEFAULT_DEVICE,
    });

    expect(mocks.rasterRows).toHaveBeenCalledTimes(1);
    expect(plan.segments.some((s) => s.kind === 'cut')).toBe(true);
    expect(plan.layerStats[0]?.segments).toBeGreaterThan(0);
    expect(plan.warnings).toHaveLength(0);
  });

  it('skips images on a Line-mode layer with a warning (regression)', async () => {
    mocks.rasterRows.mockClear();
    const layer = layerWithMode('line');

    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: DEFAULT_DEVICE,
    });

    expect(mocks.rasterRows).not.toHaveBeenCalled();
    expect(plan.segments).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/image skipped in line mode/i);
  });

  it('emits variable power (S words) for raster rows', async () => {
    mocks.rasterRows.mockClear();
    mocks.rasterRows.mockReturnValueOnce([
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 10, y: 0 },
          { x: 15, y: 0 },
        ],
        powers: [0, 50, 100, 0],
      },
    ]);
    const layer = layerWithMode('image');
    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: { ...DEFAULT_DEVICE, maxS: 1000, laserMode: 'M4' },
      optimization: { ...DEFAULT_OPTIMIZATION, enabled: false },
    });
    const gcode = plan.gcode.join('\n');

    // The first move into the row lights up with the power of point 0 (0).
    // Each following G1 carries the power of the *previous* point, matching
    // the preview.
    expect(gcode).toContain('G1 X5 Y400');
    expect(gcode).toContain('G1 X10 Y400 S500');
    expect(gcode).toContain('G1 X15 Y400 S1000');
    expect(gcode).toMatch(/M4 S0/);
  });

  it('clamps raster power to maxS', async () => {
    mocks.rasterRows.mockClear();
    mocks.rasterRows.mockReturnValueOnce([
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        powers: [100, 100],
      },
    ]);
    const layer = layerWithMode('image');
    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: { ...DEFAULT_DEVICE, maxS: 255 },
      optimization: { ...DEFAULT_OPTIMIZATION, enabled: false },
    });

    expect(plan.gcode.join('\n')).toContain('M4 S255');
    expect(plan.gcode.join('\n')).not.toMatch(/S\d{4,}/);
  });
});

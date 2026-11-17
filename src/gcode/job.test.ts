import { describe, expect, it, vi } from 'vitest';
import { FabricImage, Rect } from 'fabric';
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

  it('warns when a grayscale image burns white areas at Min power', async () => {
    mocks.rasterRows.mockClear();
    mocks.rasterRows.mockReturnValueOnce([
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        powers: [20, 20],
      },
    ]);
    const layer = layerWithMode('image');
    layer.settings = { ...layer.settings, dither: 'grayscale', minPower: 20 };

    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: DEFAULT_DEVICE,
      optimization: { ...DEFAULT_OPTIMIZATION, enabled: false },
    });

    expect(plan.warnings.join(' ')).toMatch(/min power 20%/i);
    expect(plan.warnings.join(' ')).toMatch(/set min power to 0/i);
  });

  it('does not warn about Min power for threshold images', async () => {
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
    layer.settings = { ...layer.settings, dither: 'threshold', minPower: 20 };

    const plan = await buildJob({
      objects: [makeImage(layer.id)],
      layers: [layer],
      bed: { width: 400, height: 400 },
      device: DEFAULT_DEVICE,
      optimization: { ...DEFAULT_OPTIMIZATION, enabled: false },
    });

    expect(plan.warnings).toHaveLength(0);
  });
});

describe('buildJob device origin', () => {
  // A 10x10 square on a 100x80 bed: its top-left corner is (20, 10) and the
  // bottom-right corner is (30, 20) in document coordinates.
  async function planFor(origin: (typeof DEFAULT_DEVICE)['origin']) {
    const layer = layerWithMode('line');
    const rect = new Rect({ left: 20, top: 10, width: 10, height: 10 });
    rect.set('layerId', layer.id);
    return buildJob({
      objects: [rect],
      layers: [layer],
      bed: { width: 100, height: 80 },
      device: { ...DEFAULT_DEVICE, origin },
      optimization: { ...DEFAULT_OPTIMIZATION, enabled: false },
    });
  }

  /** First G1 move of the job as [x, y]. */
  function firstMove(plan: { gcode: string[] }): [number, number] {
    const line = plan.gcode.find((l) => l.startsWith('G1 ') && l.includes('X'));
    if (!line) throw new Error('job has no G1 move');
    const x = Number(/X(-?[\d.]+)/.exec(line)?.[1]);
    const y = Number(/Y(-?[\d.]+)/.exec(line)?.[1]);
    return [x, y];
  }

  it('maps the design for a bottom-left machine zero', async () => {
    const [x, y] = firstMove(await planFor('bottom-left'));
    expect(x).toBeCloseTo(20, 3);
    expect(y).toBeCloseTo(80 - 10, 3);
  });

  it('does not mirror for a top-left machine zero', async () => {
    const [x, y] = firstMove(await planFor('top-left'));
    expect(x).toBeCloseTo(20, 3);
    expect(y).toBeCloseTo(10, 3);
  });

  it('mirrors both axes for a bottom-right machine zero', async () => {
    const [x, y] = firstMove(await planFor('bottom-right'));
    expect(x).toBeCloseTo(100 - 20, 3);
    expect(y).toBeCloseTo(80 - 10, 3);
  });

  it('mirrors only X for a top-right machine zero', async () => {
    const [x, y] = firstMove(await planFor('top-right'));
    expect(x).toBeCloseTo(100 - 20, 3);
    expect(y).toBeCloseTo(10, 3);
  });

  it('keeps absolute positioning for every corner', async () => {
    for (const origin of ['bottom-left', 'top-left', 'bottom-right', 'top-right'] as const) {
      const plan = await planFor(origin);
      expect(plan.gcode.some((l) => l.startsWith('G90 '))).toBe(true);
    }
  });
});

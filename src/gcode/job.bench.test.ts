import { describe, expect, it } from 'vitest';
import { Ellipse, Rect } from 'fabric';
import { DEFAULT_DEVICE, DEFAULT_OPTIMIZATION } from './types';
import { DEFAULT_CUT_SETTINGS, createLayer, type LayerDef } from '@/types/document';
import { buildJob } from './job';

/**
 * Where the time goes when the Preview or **Send to laser** builds a job.
 *
 * The roadmap keeps a "Web Worker for GCode" idea, with a measurement attached:
 * 200 fills ≈ 1.2 s, of which ~90 % is Paper.js (`objectContours` +
 * `hatchContours`), not the planner. This benchmark keeps the claim alive; it
 * only runs with `BENCH=1` and prints numbers instead of asserting timings.
 *
 * The decision recorded in docs/ARCHITECTURE.md depends on these figures.
 */

const RUN = process.env.BENCH === '1';

function fillLayer(id: string, patch: Partial<LayerDef['settings']> = {}): LayerDef {
  return {
    ...createLayer(0),
    id,
    settings: { ...DEFAULT_CUT_SETTINGS, mode: 'fill', output: true, ...patch },
  };
}

function tagged<T extends Rect | Ellipse>(obj: T, layerId: string): T {
  obj.set('layerId', layerId);
  return obj;
}

async function build(objects: (Rect | Ellipse)[], layers: LayerDef[]): Promise<number> {
  const plan = await buildJob({
    objects: objects as never,
    layers,
    bed: { width: 400, height: 400 },
    device: DEFAULT_DEVICE,
    optimization: DEFAULT_OPTIMIZATION,
  });
  return plan.segments.length;
}

describe('gcode job benchmark', () => {
  it.skipIf(!RUN)('measures 200 small fills', async () => {
    const layer = fillLayer('layer-fill');
    const objects: Rect[] = [];
    for (let i = 0; i < 200; i += 1) {
      objects.push(
        tagged(
          new Rect({
            left: 10 + (i % 20) * 18,
            top: 10 + Math.floor(i / 20) * 18,
            width: 12,
            height: 12,
            fill: '#000000',
            stroke: null,
            objectCaching: false,
          }),
          layer.id,
        ),
      );
    }

    // Warm up so module initialisation is not counted.
    await build(objects, [layer]);

    const start = performance.now();
    const segments = await build(objects, [layer]);
    const total = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[bench] 200-fills segments=${segments} total=${total.toFixed(0)}ms`);
    expect(segments).toBeGreaterThan(0);
  });

  it.skipIf(!RUN)('measures one large dense fill', async () => {
    const layer = fillLayer('layer-big', { interval: 0.05 });
    const objects = [
      tagged(
        new Ellipse({
          left: 20,
          top: 20,
          rx: 150,
          ry: 150,
          fill: '#000000',
          stroke: null,
          objectCaching: false,
        }),
        layer.id,
      ),
    ];
    await build(objects, [layer]);

    const start = performance.now();
    const segments = await build(objects, [layer]);
    // eslint-disable-next-line no-console
    console.log(`[bench] big-fill segments=${segments} total=${(performance.now() - start).toFixed(0)}ms`);
    expect(segments).toBeGreaterThan(0);
  });
});

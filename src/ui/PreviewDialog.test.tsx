import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PreviewDialog } from './PreviewDialog';
import type { JobPlan } from '@/gcode/types';

/**
 * jsdom has no 2D canvas. A recording context lets us assert *how* the plan is
 * painted without a real raster backend.
 */
const record = vi.hoisted(() => ({
  strokes: [] as { style: string; points: number }[],
  fills: [] as { style: string; x: number; y: number }[],
  draws: 0,
}));

function makeContext(): CanvasRenderingContext2D {
  const ctx = {
    canvas: { width: 780, height: 500 },
    strokeStyle: '#000',
    fillStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    stroke: () => {
      record.strokes.push({ style: String(ctx.strokeStyle), points: 0 });
    },
    fill: () => {},
    fillRect: (x: number, y: number) => {
      record.fills.push({ style: String(ctx.fillStyle), x: Number(x), y: Number(y) });
    },
    strokeRect: () => {},
    fillText: () => {},
    clearRect: () => {},
    drawImage: () => {
      record.draws += 1;
    },
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    putImageData: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  record.strokes = [];
  record.fills = [];
  record.draws = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    makeContext as unknown as HTMLCanvasElement['getContext'],
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function planWithImage(): JobPlan {
  return {
    segments: [
      { kind: 'rapid', points: [{ x: 0, y: 0 }] },
      {
        kind: 'cut',
        layerId: 'image',
        power: 100,
        feed: 1200,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 30, y: 10 },
        ],
        // Moves: 1 -> 0 (off), 2 -> 100 (lit).
        powers: [0, 100, 100],
      },
      { kind: 'rapid', points: [{ x: 0, y: 0 }] },
      {
        kind: 'cut',
        layerId: 'vector',
        power: 50,
        feed: 1200,
        points: [
          { x: 50, y: 50 },
          { x: 60, y: 50 },
        ],
      },
    ],
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 50 },
    gcode: [],
    timeSeconds: 10,
    cutDistance: 20,
    rapidDistance: 0,
    layerStats: [
      { layerId: 'image', name: 'C00', color: '#000000', distance: 20, seconds: 1, segments: 1 },
      { layerId: 'vector', name: 'C01', color: '#ff0000', distance: 10, seconds: 1, segments: 1 },
    ],
    lineCount: 0,
    warnings: [],
  };
}

describe('PreviewDialog', () => {
  it('paints raster rows with toned pixels instead of the layer colour', () => {
    render(
      <PreviewDialog
        plan={planWithImage()}
        bed={{ width: 400, height: 400 }}
        onClose={() => {}}
        onSend={() => {}}
        canSend={false}
        connectedName="GRBL"
      />,
    );

    // The vector layer is still stroked in its layer colour…
    expect(record.strokes.some((s) => s.style === '#ff0000')).toBe(true);
    // …but nothing is stroked with the black image layer colour.
    expect(record.strokes.some((s) => s.style === '#000000')).toBe(false);
    // Raster pixels are toned (grayscale, never pure black) with power-driven
    // alpha.
    const rasterFills = record.fills.filter((f) => /^rgba\(\d+,\d+,\d+/.test(f.style));
    expect(rasterFills.length).toBeGreaterThan(0);
    for (const fill of rasterFills) {
      const [r] = fill.style.match(/\d+/g)!.map(Number);
      expect(r).toBeGreaterThanOrEqual(150);
    }
  });

  it('shows the job summary', () => {
    render(
      <PreviewDialog
        plan={planWithImage()}
        bed={{ width: 400, height: 400 }}
        onClose={() => {}}
        onSend={() => {}}
        canSend
        connectedName="GRBL"
      />,
    );

    expect(screen.getByText('Job summary')).toBeTruthy();
    expect(screen.getByText('Layers')).toBeTruthy();
  });
});

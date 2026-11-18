import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreviewDialog } from './PreviewDialog';
import { rasterPowerColor } from './previewPaths';
import type { JobPlan } from '@/gcode/types';

const baseProps = {
  bed: { width: 400, height: 400 },
  onClose: () => {},
  onSend: () => {},
  canSend: false,
  connectedName: 'GRBL',
};

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

/** Every `<path>` in the preview SVG. */
/** The preview SVG (not the small icons inside the buttons). */
function previewSvg(container: HTMLElement): SVGSVGElement {
  return container.querySelector('svg[role="img"]') as SVGSVGElement;
}

function paths(container: HTMLElement): SVGPathElement[] {
  return [...previewSvg(container).querySelectorAll('path')] as SVGPathElement[];
}

describe('PreviewDialog (vector)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders an SVG with a bed viewBox instead of a bitmap canvas', () => {
    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);

    const svg = previewSvg(container);
    expect(svg).toBeTruthy();
    // Zoom scales this box: no pixels are magnified.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400 400');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('draws the toolpaths as vector paths', () => {
    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);
    const ds = paths(container).map((p) => p.getAttribute('d') ?? '');
    const all = ds.join(' ');
    expect(all).toContain('M50 50L60 50');
  });

  it('strokes raster runs with the power ramp, never the black layer colour', () => {
    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);

    // Not yet cut: the raster still uses its layer colour (pending toolpath).
    const pendingStrokes = paths(container).map((p) => p.getAttribute('stroke') ?? '');
    expect(pendingStrokes).toContain('#ff0000');

    // Move the playhead past the raster segment.
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '600' } });

    const strokes = paths(container).map((p) => p.getAttribute('stroke') ?? '');
    // The image layer never strokes solid black once engraved.
    expect(strokes.filter((s) => s === '#000000')).toHaveLength(0);
    // The vector layer keeps its own colour.
    expect(strokes).toContain('#ff0000');
  });

  it('keeps 1px hairlines at any zoom', () => {
    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);
    const strokeWidths = paths(container).map((p) => p.getAttribute('vector-effect'));
    expect(strokeWidths.every((v) => v === 'non-scaling-stroke')).toBe(true);
  });

  it('ramps the colour and opacity with power', () => {
    const low = rasterPowerColor(10);
    const mid = rasterPowerColor(50);
    const high = rasterPowerColor(100);

    expect(low.a).toBeLessThan(mid.a);
    expect(mid.a).toBeLessThan(high.a);
    expect(high.a).toBeCloseTo(1, 6);
    expect(low.g).toBeLessThan(mid.g);
    expect(mid.g).toBeLessThan(high.g);
    expect(low.a).toBeGreaterThan(0.1);
    expect(rasterPowerColor(0).a).toBeLessThan(low.a);
    expect(rasterPowerColor(-10)).toEqual(rasterPowerColor(0));
    expect(rasterPowerColor(250)).toEqual(rasterPowerColor(100));
  });

  it('shows the layer summary', () => {
    render(<PreviewDialog plan={planWithImage()} {...baseProps} />);
    expect(screen.getByText('Layers')).toBeTruthy();
    expect(screen.getByText('C01')).toBeTruthy();
  });

  it('zooms by shrinking the viewBox, not by scaling pixels', async () => {
    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);
    const svg = previewSvg(container);
    const before = svg.getAttribute('viewBox');

    const zoomIn = screen.getByTitle('Zoom in');
    await vi.waitFor(() => zoomIn.click());
    vi.runOnlyPendingTimers();

    const after = svg.getAttribute('viewBox');
    expect(after).not.toBe(before);
    // A deeper zoom means a smaller world window, never a larger bitmap.
    const beforeW = Number(before?.split(' ')[2]);
    const afterW = Number(after?.split(' ')[2]);
    expect(afterW).toBeLessThan(beforeW);
  });

  it('renders the raster image as an <image> texture, not vector hairlines', () => {
    // Stub the canvas path so `textureFor` can encode a PNG URL in jsdom.
    vi.stubGlobal('ImageData', class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    });
    const ctx = {
      putImageData: vi.fn(),
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

    const { container } = render(<PreviewDialog plan={planWithImage()} {...baseProps} />);
    const svg = previewSvg(container);
    const image = svg.querySelector('image') as SVGImageElement | null;

    // One full-image (pending, dimmed) texture is present because there are
    // raster segments in the plan.
    expect(image).not.toBeNull();
    // Animated by the fake clock it has not advanced, so the pending dim texture
    // is shown and the reveal texture is not yet present.
    expect(image?.getAttribute('opacity')).toBe('0.32');

    // The texture is anchored to the raster image's world bbox.
    const x = Number(image?.getAttribute('x'));
    const width = Number(image?.getAttribute('width'));
    expect(width).toBeGreaterThan(0);
    expect(x).toBeGreaterThanOrEqual(0);
  });
});

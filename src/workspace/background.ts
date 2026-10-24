import type { Canvas } from 'fabric';

interface BackgroundOptions {
  bedWidth: number;
  bedHeight: number;
  gridSize: number;
  showGrid: boolean;
  showOutline: boolean;
  units: 'mm' | 'in';
}

/**
 * Draws the LightBurn-style workspace backdrop (grid, bed outline, origin)
 * on a canvas layered beneath the Fabric canvas. Both share the same
 * viewportTransform so they always line up.
 */
export class BackgroundRenderer {
  private ctx: CanvasRenderingContext2D;
  private fabric: Canvas;
  private options: BackgroundOptions;

  constructor(canvasEl: HTMLCanvasElement, fabric: Canvas, options: BackgroundOptions) {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.fabric = fabric;
    this.options = options;
    this.resize();
  }

  setOptions(patch: Partial<BackgroundOptions>): void {
    this.options = { ...this.options, ...patch };
    this.render();
  }

  resize(): void {
    const el = this.ctx.canvas;
    const parent = el.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = parent.getBoundingClientRect();
    el.width = Math.max(1, Math.round(width * dpr));
    el.height = Math.max(1, Math.round(height * dpr));
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  render(): void {
    const ctx = this.ctx;
    const { width, height } = ctx.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const vpt = this.fabric.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const zoom = vpt[0];
    const ox = vpt[4];
    const oy = vpt[5];

    // Workspace background
    ctx.fillStyle = '#303236';
    ctx.fillRect(0, 0, width, height);

    const { bedWidth, bedHeight, gridSize, showGrid, showOutline, units } = this.options;

    // Bed fill + outline
    const bx = ox;
    const by = oy;
    const bw = bedWidth * zoom;
    const bh = bedHeight * zoom;

    ctx.fillStyle = '#35373c';
    ctx.fillRect(bx, by, bw, bh);

    if (showGrid && gridSize > 0) {
      const minor = gridSize * zoom;
      if (minor > 4) {
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= bedWidth + 0.001; x += gridSize) {
          const sx = Math.round(ox + x * zoom) + 0.5;
          ctx.moveTo(sx, by);
          ctx.lineTo(sx, by + bh);
        }
        for (let y = 0; y <= bedHeight + 0.001; y += gridSize) {
          const sy = Math.round(oy + y * zoom) + 0.5;
          ctx.moveTo(bx, sy);
          ctx.lineTo(bx + bw, sy);
        }
        ctx.stroke();

        // Major grid every 5 cells
        const major = gridSize * 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath();
        for (let x = 0; x <= bedWidth + 0.001; x += major) {
          const sx = Math.round(ox + x * zoom) + 0.5;
          ctx.moveTo(sx, by);
          ctx.lineTo(sx, by + bh);
        }
        for (let y = 0; y <= bedHeight + 0.001; y += major) {
          const sy = Math.round(oy + y * zoom) + 0.5;
          ctx.moveTo(bx, sy);
          ctx.lineTo(bx + bw, sy);
        }
        ctx.stroke();
      }
    }

    if (showOutline) {
      ctx.strokeStyle = '#6a6e75';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw), Math.round(bh));

      // Origin marker
      ctx.strokeStyle = '#c8b060';
      ctx.lineWidth = 1.5;
      const arm = 12;
      if (ox > -arm && oy > -arm) {
        ctx.beginPath();
        ctx.moveTo(ox - arm, oy);
        ctx.lineTo(ox + arm, oy);
        ctx.moveTo(ox, oy - arm);
        ctx.lineTo(ox, oy + arm);
        ctx.stroke();
      }
    }

    // Rulers along the bed edges
    this.drawRulers(ctx, zoom, ox, oy, bedWidth, bedHeight, units);
  }

  private drawRulers(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    ox: number,
    oy: number,
    bedWidth: number,
    bedHeight: number,
    units: 'mm' | 'in',
  ): void {
    const stepMm = units === 'mm' ? pickStep(zoom, [1, 2, 5, 10, 20, 50, 100]) : pickStep(zoom, [1, 2, 5, 10, 20, 50, 100]);
    const toUnit = units === 'mm' ? 1 : 1 / 25.4;
    const label = (mm: number) => {
      const v = mm * toUnit;
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    };

    ctx.save();
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#8a8f97';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;

    const top = Math.max(0, oy - 14);
    for (let x = 0; x <= bedWidth + 0.001; x += stepMm) {
      const sx = Math.round(ox + x * zoom) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, top + 8);
      ctx.lineTo(sx, top + 12);
      ctx.stroke();
      ctx.fillText(label(x), sx + 2, top + 7);
    }

    const left = Math.max(0, ox - 26);
    for (let y = 0; y <= bedHeight + 0.001; y += stepMm) {
      const sy = Math.round(oy + y * zoom) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left + 18, sy);
      ctx.lineTo(left + 22, sy);
      ctx.stroke();
      ctx.fillText(label(y), left, sy - 2);
    }
    ctx.restore();
  }
}

function pickStep(zoom: number, steps: number[]): number {
  for (const s of steps) {
    if (s * zoom >= 40) return s;
  }
  return steps[steps.length - 1];
}

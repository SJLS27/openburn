import type { Canvas } from 'fabric';
import { rulerCursor, rulerTicks } from './ruler';

interface BackgroundOptions {
  bedWidth: number;
  bedHeight: number;
  gridSize: number;
  showGrid: boolean;
  showOutline: boolean;
  units: 'mm' | 'in';
  /** Ruler guides from the document, drawn above the grid and below objects. */
  guides?: readonly { axis: 'x' | 'y'; position: number }[];
}

/** Band reserved for the rulers at the top and left of the workspace. */
const RULER_W = 22;
const RULER_H = 18;

/**
 * Draws the LightBurn-style workspace backdrop (grid, bed outline, origin)
 * on a canvas layered beneath the Fabric canvas. Both share the same
 * viewportTransform so they always line up.
 */
export class BackgroundRenderer {
  private ctx: CanvasRenderingContext2D;
  private fabric: Canvas;
  private options: BackgroundOptions;
  /** Pointer position in scene units, highlighted on the rulers. */
  private cursor: { x: number; y: number } | null = null;

  constructor(canvasEl: HTMLCanvasElement, fabric: Canvas, options: BackgroundOptions) {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.fabric = fabric;
    this.options = options;
    this.resize();
  }

  /** Where the rulers end, in CSS pixels (the controller uses it to start drags). */
  static rulerBands(): { width: number; height: number } {
    return { width: RULER_W, height: RULER_H };
  }

  setOptions(patch: Partial<BackgroundOptions>): void {
    this.options = { ...this.options, ...patch };
    this.render();
  }

  /** Track the mouse so both rulers show where the pointer is. */
  setCursor(point: { x: number; y: number } | null): void {
    this.cursor = point;
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

    // Ruler guides sit above the grid and below the artwork.
    this.drawGuides(ctx, zoom, ox, oy, width, height);

    // Rulers pinned to the viewport edges (not to the bed), like LightBurn.
    this.drawRulers(ctx, zoom, ox, oy, width, height, units);
  }

  /**
   * Persistent guides dragged out of the rulers. They are drawn on the
   * backdrop, so they never become selection, export or snap targets as Fabric
   * objects would.
   */
  private drawGuides(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    ox: number,
    oy: number,
    width: number,
    height: number,
  ): void {
    const guides = this.options.guides ?? [];
    if (guides.length === 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(94,160,220,0.85)';
    ctx.lineWidth = 1;
    for (const guide of guides) {
      ctx.beginPath();
      if (guide.axis === 'x') {
        const sx = Math.round(ox + guide.position * zoom) + 0.5;
        if (sx < RULER_W || sx > width) continue;
        ctx.moveTo(sx, RULER_H);
        ctx.lineTo(sx, height);
      } else {
        const sy = Math.round(oy + guide.position * zoom) + 0.5;
        if (sy < RULER_H || sy > height) continue;
        ctx.moveTo(RULER_W, sy);
        ctx.lineTo(width, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Top and left rulers that scroll with the canvas. Ticks come from
   * `rulerTicks`; the scene origin (bed 0,0) is always labelled, including
   * when it is off-screen.
   */
  private drawRulers(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    ox: number,
    oy: number,
    width: number,
    height: number,
    units: 'mm' | 'in',
  ): void {
    const scale = units === 'mm' ? 1 : 1 / 25.4;
    ctx.save();

    // Bands.
    ctx.fillStyle = 'rgba(24,25,28,0.92)';
    ctx.fillRect(0, 0, width, RULER_H);
    ctx.fillRect(0, 0, RULER_W, height);
    ctx.fillStyle = 'rgba(24,25,28,0.92)';
    ctx.fillRect(0, 0, RULER_W, RULER_H);
    ctx.strokeStyle = '#3a3d42';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H + 0.5);
    ctx.lineTo(width, RULER_H + 0.5);
    ctx.moveTo(RULER_W + 0.5, 0);
    ctx.lineTo(RULER_W + 0.5, height);
    ctx.stroke();

    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#8a8f97';
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.textBaseline = 'top';

    // Horizontal ruler (X).
    ctx.beginPath();
    for (const tick of rulerTicks(width - RULER_W, ox - RULER_W, zoom * scale, units)) {
      const x = Math.round(RULER_W + tick.screen) + 0.5;
      if (x < RULER_W || x > width) continue;
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, RULER_H - (tick.major ? 7 : 3));
    }
    ctx.stroke();
    for (const tick of rulerTicks(width - RULER_W, ox - RULER_W, zoom * scale, units)) {
      const x = Math.round(RULER_W + tick.screen) + 0.5;
      if (!tick.major || x < RULER_W || x > width - 12) continue;
      ctx.fillText(tick.label, x + 2, 2);
    }

    // Vertical ruler (Y): labels rotated so they read bottom-up.
    ctx.beginPath();
    for (const tick of rulerTicks(height - RULER_H, oy - RULER_H, zoom * scale, units)) {
      const y = Math.round(RULER_H + tick.screen) + 0.5;
      if (y < RULER_H || y > height) continue;
      ctx.moveTo(RULER_W, y);
      ctx.lineTo(RULER_W - (tick.major ? 7 : 3), y);
    }
    ctx.stroke();
    for (const tick of rulerTicks(height - RULER_H, oy - RULER_H, zoom * scale, units)) {
      const y = Math.round(RULER_H + tick.screen) + 0.5;
      if (!tick.major || y < RULER_H + 10 || y > height) continue;
      ctx.save();
      ctx.translate(2, y - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(tick.label, 0, 0);
      ctx.restore();
    }

    // Origin markers (bed 0,0).
    ctx.strokeStyle = '#c8b060';
    ctx.lineWidth = 1.5;
    const originX = ox;
    const originY = oy;
    if (originX >= RULER_W && originX <= width) {
      ctx.beginPath();
      ctx.moveTo(originX - 4, RULER_H);
      ctx.lineTo(originX + 4, RULER_H);
      ctx.stroke();
    }
    if (originY >= RULER_H && originY <= height) {
      ctx.beginPath();
      ctx.moveTo(RULER_W, originY - 4);
      ctx.lineTo(RULER_W, originY + 4);
      ctx.stroke();
    }

    // Pointer position.
    if (this.cursor) {
      const cx = rulerCursor(width - RULER_W, ox - RULER_W, zoom * scale, this.cursor.x);
      const cy = rulerCursor(height - RULER_H, oy - RULER_H, zoom * scale, this.cursor.y);
      ctx.strokeStyle = '#ffb357';
      ctx.lineWidth = 1;
      if (cx !== null) {
        const x = Math.round(RULER_W + cx) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
      }
      if (cy !== null) {
        const y = Math.round(RULER_H + cy) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(RULER_W, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

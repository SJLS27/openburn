import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Screenshot helper for the documentation captures.
 *
 * The window is captured at its real size (the compositor decides it, so on
 * Wayland we cannot force 1600 × 1000) and then composed into a 1600 × 1000
 * surface on the app's own background. When the window is narrower than the
 * target, the editor is anchored on the left and the empty area on the right
 * is filled with a matching tint, so the PNG keeps a single frame size across
 * every capture without letterboxing the UI.
 */

export const FRAME = { width: 1600, height: 1000 } as const;
export const MAX_FRAME_ZOOM = 1.45;

export type Box = { x: number; y: number; width: number; height: number };

type ComposeOptions = {
  /** Region of the *viewport* to use (e.g. an element bounding box). */
  clip?: Box;
  /** Outline one element on top of the capture. */
  callout?: { clip: Box; border: string; label?: string };
  /**
   * Scale cap. The hero uses ~2 because the window is captured smaller than
   * 1600 × 1000 on some compositors; panels stay near 1 to keep text crisp.
   */
  maxZoom?: number;
  /** Hide the orange accent tick (used when cropping a single panel). */
  noAccent?: boolean;
};

/**
 * Compose a padded 1600 × 1000 PNG.
 *
 * The shot is decoded, scaled to fit (never upscaled past 1.45×, so small
 * panels stay crisp) and centred on a subtly textured version of the app
 * background. Rounding is done at 2× and downsampled for clean edges.
 */
export async function captureFrame(page: Page, outPath: string, options: ComposeOptions = {}): Promise<void> {
  const shot = await page.screenshot();
  const dataUrl = await page.evaluate(
    async ({ shotBase64, options, frame }) => {
      const bg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('cannot decode screenshot'));
        img.src = `data:image/png;base64,${shotBase64}`;
      });

      const src = options.clip ?? {
        x: 0,
        y: 0,
        width: bg.naturalWidth,
        height: bg.naturalHeight,
      };
      const scale = Math.min(frame.width / src.width, (frame.height - 32) / src.height, options.maxZoom ?? 1.45);
      const w = Math.round(src.width * scale);
      const h = Math.round(src.height * scale);
      const x = Math.round((frame.width - w) / 2);
      const y = Math.round((frame.height - h) / 2);

      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';

      // Background: the app's dark chrome with a faint diagonal grid.
      const grad = g.createLinearGradient(0, 0, frame.width, frame.height);
      grad.addColorStop(0, '#1c1e22');
      grad.addColorStop(0.6, '#23262b');
      grad.addColorStop(1, '#191b1f');
      g.fillStyle = grad;
      g.fillRect(0, 0, frame.width, frame.height);
      g.globalAlpha = 0.05;
      g.strokeStyle = '#d2691e';
      g.lineWidth = 1;
      for (let i = -frame.height; i < frame.width; i += 48) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + frame.height, frame.height);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Floating shot with a soft shadow.
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 40;
      g.shadowOffsetY = 16;
      g.fillStyle = '#26282c';
      g.beginPath();
      g.roundRect(x, y, w, h, 12);
      g.fill();
      g.restore();

      g.save();
      g.beginPath();
      g.roundRect(x, y, w, h, 12);
      g.clip();
      g.drawImage(bg, src.x, src.y, src.width, src.height, x, y, w, h);
      if (options.callout) {
        const c = options.callout.clip;
        const cx = x + (c.x - src.x) * scale;
        const cy = y + (c.y - src.y) * scale;
        g.strokeStyle = options.callout.border;
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(cx - 5, cy - 5, c.width * scale + 10, c.height * scale + 10, 8);
        g.stroke();
      }
      g.restore();

      // Hairline border and accent tick.
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 12);
      g.stroke();
      if (!options.noAccent) {
        g.fillStyle = '#d2691e';
        g.beginPath();
        g.roundRect(x + 24, y + h + 8, 88, 4, 2);
        g.fill();
      }

      return canvas.toDataURL('image/png');
    },
    { shotBase64: shot.toString('base64'), options, frame: FRAME },
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createTestProfile, dismissWelcome, launchEnv, removeTestProfile } from './helpers';

/**
 * App icon: the flame in the app's own vector style, rendered by the same
 * canvas stack the editor uses, on the launcher gradient. Purely a capture,
 * it is not used by the app at runtime.
 *
 * Opt-in: `npm run docs:icon` (needs the dev-mode debug build).
 */

const repoRoot = path.resolve(__dirname, '..');
const outPath = path.join(repoRoot, 'docs/app-icon.png');

let app: ElectronApplication;
let page: Page;
const profile = createTestProfile();
const capture = !!process.env.CAPTURE_DOCS;

test.describe('app icon', () => {
  test.skip(!capture, 'opt-in: npm run docs:icon');

  test.beforeAll(async () => {
    if (!capture) return;
    const env = launchEnv(profile);
    env.NODE_ENV = 'development';
    app = await electron.launch({ args: [repoRoot, '--no-sandbox', '--capture=docs'], env });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await dismissWelcome(page);
  });

  test.afterAll(async () => {
    await app?.close();
    removeTestProfile(profile);
  });

  test('renders the flame on the icon gradient', async () => {
    // Draw into a throwaway page region: square, transparent corners, no text.
    const dataUrl = await page.evaluate(async () => {
      const svg = await fetch('./favicon.svg').then((r) => r.text());
      const flameSvg = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const path = flameSvg.querySelector('path')?.getAttribute('d') ?? '';
      const flame = new Image();
      flame.src = `data:image/svg+xml;base64,${btoa(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 8 48 48"><path d="${path}" fill="#ff8a3d"/></svg>`,
      )}`;
      await flame.decode();

      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const g = canvas.getContext('2d')!;

      // Squircle body in the launcher palette.
      g.beginPath();
      g.roundRect(0, 0, size, size, size * 0.22);
      g.clip();
      const bg = g.createLinearGradient(0, 0, size, size);
      bg.addColorStop(0, '#34373c');
      bg.addColorStop(0.55, '#24262a');
      bg.addColorStop(1, '#1a1c20');
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);

      // Warm glow behind the flame.
      const glow = g.createRadialGradient(size / 2, size * 0.56, size * 0.04, size / 2, size / 2, size * 0.52);
      glow.addColorStop(0, 'rgba(226,122,44,0.45)');
      glow.addColorStop(1, 'rgba(226,122,44,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, size, size);

      // Flame alone, generously sized.
      g.imageSmoothingQuality = 'high';
      const side = size * 0.74;
      g.drawImage(flame, (size - side) / 2, (size - side) / 2, side, side);
      return canvas.toDataURL('image/png');
    });

    await test.info().attach('icon', { body: Buffer.from(dataUrl.split(',')[1]!, 'base64'), contentType: 'image/png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
    expect(dataUrl.startsWith('data:image/png')).toBe(true);
  });
});

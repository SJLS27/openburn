import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createTestProfile, dismissWelcome, launchEnv, removeTestProfile } from './helpers';
import {
  buildDemoScene,
  controllerReady,
  drawPlate,
  openLightBurnFixture,
  resetDemo,
  sceneForNodes,
  zoomToPage,
} from './demo';
import { captureFrame, type Box } from './capture';

/**
 * Documentation screenshots for the README and the website.
 *
 * Opt-in: `npm run docs:screenshots`. CI never runs it. It drives the real app
 * headless (own profile, never the developer's config) and writes 1600 × 1000
 * PNGs to `docs/screenshots/`; `scripts/build-docs-assets.sh` then derives the
 * WebP sizes used by `website/public/screenshots/`.
 *
 * Needs the dev-mode debug build (`npm run docs:screenshots` makes it), because
 * the demo scene uses the helpers that only exist in dev builds
 * (`window.__openburnStore`).
 */

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'docs/screenshots');

let app: ElectronApplication;
let page: Page;
const profile = createTestProfile();

/** Opt-in: only runs when CAPTURE_DOCS is set (CI skips it). */
const capture = !!process.env.CAPTURE_DOCS;

async function shot(name: string, options: { clip?: Box; maxZoom?: number; noAccent?: boolean } = {}): Promise<void> {
  await page.waitForTimeout(350);
  await captureFrame(page, path.join(outDir, `${name}.png`), options);
}

async function openTools(item: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.locator('.menu-dropdown').getByRole('button', { name: item }).click();
}

async function closeDialog(header: string, button: string): Promise<void> {
  const dialog = page.locator('.dialog', {
    has: page.locator('.dialog-header', { hasText: header }),
  });
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(page.locator('.dialog-header', { hasText: header })).toHaveCount(0);
}

async function box(selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} is not visible`);
  return found;
}

test.describe('documentation screenshots', () => {
  test.skip(!capture, 'opt-in: npm run docs:screenshots');

  test.beforeAll(async () => {
    if (!capture) return;
    const env = launchEnv(profile);
    env.NODE_ENV = 'development';
    app = await electron.launch({
      // `capture=docs` starts the debug session without the welcome dialog.
      args: [repoRoot, '--no-sandbox', '--capture=docs'],
      env,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);
    // Usually already absent in capture mode; harmless otherwise.
    await dismissWelcome(page);
    await controllerReady(page);
  });

  test.afterAll(async () => {
    await app?.close();
    removeTestProfile(profile);
  });

  test.describe.configure({ mode: 'serial' });

  test('captures the documentation screenshots', async () => {
    test.setTimeout(240_000);

    // --- Hero: full editor with the demo scene ---------------------------
    await buildDemoScene(page);
    await zoomToPage(page);
    // Scaling cap ~2: the window is 1024 px wide under Wayland, so the hero is
    // upscaled to fill the 1600 × 1000 frame instead of floating in a margin.
    await shot('overview', { maxZoom: 2 });

    // --- Node editing ----------------------------------------------------
    await sceneForNodes(page);
    const horns = await page.evaluate(() => {
      const c = (
        window as unknown as {
          __openburn: {
            canvas: {
              getObjects: () => Array<{
                type: string;
                left: number;
                top: number;
                width: number;
                height: number;
                scaleX: number;
                scaleY: number;
              }>;
              setActiveObject: (o: unknown) => void;
            };
          };
        }
      ).__openburn;
      const paths = c.canvas.getObjects().filter((o) => o.type === 'path');
      const last = paths[paths.length - 1];
      if (!last) return null;
      c.canvas.setActiveObject(last);
      return {
        x: last.left,
        y: last.top,
        width: (last.width ?? 0) * last.scaleX,
        height: (last.height ?? 0) * last.scaleY,
      };
    });
    if (horns) {
      await page.keyboard.press('n');
      await page.evaluate(() => {
        const c = (
          window as unknown as {
            __openburn: {
              selectAllNodes: () => void;
              selectNode: (s: number, n: number, a: boolean) => void;
              setStatus: (t: string) => void;
            };
          }
        ).__openburn;
        c.selectAllNodes();
        c.selectNode(0, 1, false);
        c.setStatus('Edit nodes: drag the Bézier handles, double-click a segment to add a node');
      });
      await page.mouse.move(5, 5);
    }
    await shot('nodes-snapping', { maxZoom: 2 });

    // --- Preview ---------------------------------------------------------
    await buildDemoScene(page);
    await page.getByTitle('Preview (Alt+P)').click();
    const preview = page.locator('.dialog', { has: page.locator('.dialog-header', { hasText: 'Preview' }) });
    await expect(preview).toBeVisible();
    // Play to the end so the whole toolpath is drawn, then pause.
    await preview
      .locator('input[type="range"]')
      .first()
      .evaluate((el: HTMLInputElement) => {
        el.value = el.max;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await expect(preview.getByText('100%')).toBeVisible();
    // Hide the editor's selection handles behind the dialog.
    await page.evaluate(() => {
      const c = (
        window as unknown as {
          __openburn: { canvas: { discardActiveObject: () => void; requestRenderAll: () => void } };
        }
      ).__openburn;
      c.canvas.discardActiveObject();
      c.canvas.requestRenderAll();
    });
    await page.waitForTimeout(500);
    await shot('preview', { maxZoom: 2 });
    await closeDialog('Preview', 'Close');

    // --- Material test ---------------------------------------------------
    await resetDemo(page);
    await openTools(/Material Test…/);
    await expect(
      page.locator('.dialog', { has: page.locator('.dialog-header', { hasText: 'Material Test' }) }),
    ).toBeVisible();
    await page.locator('.dialog').getByRole('button', { name: 'Create test grid' }).click();
    await page.waitForTimeout(600);
    // The generator leaves its own objects selected: drop them for a clean shot.
    await page.evaluate(() => {
      const c = (
        window as unknown as {
          __openburn: { canvas: { discardActiveObject: () => void; requestRenderAll: () => void } };
        }
      ).__openburn;
      c.canvas.discardActiveObject();
      c.canvas.requestRenderAll();
    });
    // Keep the panel readable: the active layer plus three representative
    // cells (the full grid keeps its own sublayers, they are just not listed).
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __openburnStore: {
            getState: () => { doc: { layers: { id: string; name: string }[] } };
            setState: (patch: { activeLayerId: string }) => void;
            removeLayer: (id: string) => void;
          };
        }
      ).__openburnStore;
      const layers = [...store.getState().doc.layers];
      const cells = layers.filter((l) => /P\d+ S\d+/.test(l.name)).slice(0, 3);
      const fixed = layers.filter((l) => l.name === 'CUT' || l.name === 'NOTES');
      const keep = new Set([...cells.map((l) => l.id), ...fixed.map((l) => l.id)]);
      store.setState({ activeLayerId: fixed[0]?.id ?? layers[0]!.id });
      for (const layer of layers) {
        if (!keep.has(layer.id)) store.removeLayer(layer.id);
      }
    });
    await zoomToPage(page);
    await page.evaluate(() => {
      (window as unknown as { __openburn: { setStatus: (t: string) => void } }).__openburn.setStatus(
        'Material test: 5 × 5 cells with one real sublayer per cell — labels on the NOTES layer',
      );
    });
    await page.mouse.move(5, 5);
    await shot('material-test', { maxZoom: 2 });

    // --- LightBurn compatibility -----------------------------------------
    await openLightBurnFixture(page);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const menu = page.locator('.menu-dropdown');
    await expect(menu).toBeVisible();
    // Let the dropdown finish laying out before measuring the clip.
    await page.waitForTimeout(400);
    const menuBox = await menu.boundingBox();
    const fileButton = await box('.menu-item');
    const dock = await box('#panel-cuts');
    await shot('lightburn', {
      clip: {
        x: 0,
        y: 0,
        width: Math.max(dock.x + dock.width, (menuBox?.x ?? 0) + (menuBox?.width ?? 0)) + 12,
        height: Math.max(fileButton.y + (menuBox?.height ?? 0) + 320, 640),
      },
    });
    await page.keyboard.press('Escape');

    // --- Focus test ------------------------------------------------------
    await resetDemo(page);
    await drawPlate(page);
    await zoomToPage(page);
    await openTools(/Focus Test…/);
    await expect(
      page.locator('.dialog', { has: page.locator('.dialog-header', { hasText: 'Focus Test' }) }),
    ).toBeVisible();
    await page.locator('.dialog').getByRole('button', { name: 'Create focus ramp' }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const c = (
        window as unknown as {
          __openburn: { canvas: { discardActiveObject: () => void; requestRenderAll: () => void } };
        }
      ).__openburn;
      c.canvas.discardActiveObject();
      c.canvas.requestRenderAll();
    });
    await zoomToPage(page);
    await page.mouse.move(5, 5);
    await shot('focus-test');

    // --- Adjust image ----------------------------------------------------
    await resetDemo(page);
    const photo = await page.evaluate(() => {
      // A grayscale gradient with big type: enough to show the adjustment
      // pipeline without a binary fixture in the repo.
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 640;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(390, 280, 30, 400, 320, 420);
      grad.addColorStop(0, '#f6f3ec');
      grad.addColorStop(0.5, '#c9c2b4');
      grad.addColorStop(1, '#23211f');
      g.fillStyle = grad;
      g.fillRect(0, 0, 800, 640);
      g.fillStyle = '#141312';
      g.font = '800 128px Inter, Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText('BURN', 400, 350);
      return c.toDataURL('image/png');
    });
    await page.evaluate(
      (dataUrl) =>
        (
          window as unknown as {
            __openburn: {
              dropFiles: (f: Array<{ name: string; dataUrl: string }>, at?: { x: number; y: number }) => Promise<void>;
            };
          }
        ).__openburn.dropFiles([{ name: 'photo.png', dataUrl }], { x: 70, y: 40 }),
      photo,
    );
    await page.waitForTimeout(700);
    await openTools(/Adjust Image…/);
    await expect(
      page.locator('.dialog', { has: page.locator('.dialog-header', { hasText: 'Adjust Image' }) }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await shot('image-tools');
    await closeDialog('Adjust Image', 'Cancel');

    // --- Cuts / Layers panel (website showcase) ---------------------------
    await buildDemoScene(page);
    const panel = await box('#panel-cuts');
    await shot('cuts-layers', { clip: panel, maxZoom: 3, noAccent: true });
  });
});

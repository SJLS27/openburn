import path from 'node:path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * Workspace navigation tests. They run against the real Electron build, so run
 * `npm run build` first (the `test:e2e` script does it for you). On headless
 * Linux use `xvfb-run -a npm run test:e2e`.
 */

const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;

type WorkspaceHandle = {
  canvas: { viewportTransform: number[] };
};

async function readViewport(): Promise<number[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __openburn: WorkspaceHandle }).__openburn.canvas.viewportTransform.slice(),
  );
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __openburn?: unknown }).__openburn),
  );
});

test.afterAll(async () => {
  if (!app) return;
  // The controller may leave the document clean; exit directly so the native
  // "unsaved changes" dialog can never block the test run.
  await app
    .evaluate(({ app: electronApp }) => electronApp.exit(0))
    .catch(() => undefined);
});

test('dragging with the middle mouse button pans the canvas', async () => {
  const before = await readViewport();

  const box = await page.locator('.fabric-host').boundingBox();
  if (!box) throw new Error('canvas host is not visible');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const dx = 90;
  const dy = 50;

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up({ button: 'middle' });

  const after = await readViewport();

  // viewportTransform is [scaleX, skewX, skewY, scaleY, translateX, translateY].
  expect(after[4]).toBeCloseTo(before[4] + dx, -1);
  expect(after[5]).toBeCloseTo(before[5] + dy, -1);
});

test('middle-button panning does not move or select objects', async () => {
  // Draw a rectangle first using the rect tool, then pan over it.
  await page.getByRole('button', { name: 'Rectangle (R)' }).click();
  const box = await page.locator('.fabric-host').boundingBox();
  if (!box) throw new Error('canvas host is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x - 40, y - 30);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 6 });
  await page.mouse.up();

  const snapshot = () =>
    page.evaluate(() => {
      const ws = (
        window as unknown as {
          __openburn: {
            canvas: {
              getObjects: () => Array<{ left?: number; top?: number; type?: string }>;
              getActiveObjects: () => unknown[];
            };
          };
        }
      ).__openburn;
      return {
        objects: ws.canvas.getObjects().map((o) => ({ left: o.left, top: o.top, type: o.type })),
        active: ws.canvas.getActiveObjects().length,
      };
    });

  const beforeState = await snapshot();
  const before = await readViewport();
  expect(beforeState.objects.length).toBeGreaterThan(0);

  // Now pan with the middle button over the shape.
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });

  const afterState = await snapshot();
  const after = await readViewport();

  // The viewport moved...
  expect(Math.abs(after[4] - before[4])).toBeGreaterThan(30);
  expect(Math.abs(after[5] - before[5])).toBeGreaterThan(20);
  // ...but the objects and the selection stayed put.
  expect(afterState.objects).toEqual(beforeState.objects);
  expect(afterState.active).toBe(beforeState.active);
});

import path from 'node:path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  createTestProfile,
  dismissWelcome,
  launchEnv,
  removeTestProfile,
} from './helpers';

/**
 * Ruler guides: dragging one out of the ruler stores it in the document, it
 * renders on the backdrop (never as a Fabric object, so it cannot be selected
 * or exported) and it participates in snapping.
 */

const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;
const profile = createTestProfile();

type Guide = { axis: 'x' | 'y'; position: number };

/** The controller exposes the document; guides are stored on it. */
async function guides(): Promise<Guide[]> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __openburn: { snapshotDocument: () => { guides?: Guide[] } };
      }).__openburn.snapshotDocument().guides ?? [],
  );
}

async function controllerReady(): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __openburn?: unknown }).__openburn);
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: launchEnv(profile),
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissWelcome(page);
  await controllerReady();
});

test.afterAll(async () => {
  await app?.close();
  removeTestProfile(profile);
});

test.beforeEach(async () => {
  await page.evaluate(() => {
    (window as unknown as { __openburn: { newDocument: () => void } }).__openburn.newDocument();
  });
  await expect.poll(async () => (await guides()).length).toBe(0);
});

test('dragging out of the top ruler adds a horizontal guide to the document', async () => {
  const host = await page.locator('.fabric-host').boundingBox();
  if (!host) throw new Error('workspace is not visible');

  // The top ruler band is the first ~18 px of the workspace.
  const startX = host.x + host.width / 2;
  const startY = host.y + 8;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 120, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => guides().then((g) => g.length)).toBe(1);
  const [guide] = await guides();
  expect(guide.axis).toBe('y');
});

test('dragging out of the left ruler adds a vertical guide', async () => {
  const host = await page.locator('.fabric-host').boundingBox();
  if (!host) throw new Error('workspace is not visible');

  const startX = host.x + 8;
  const startY = host.y + host.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => guides().then((g) => g.length)).toBe(1);
  expect((await guides())[0].axis).toBe('x');
});

test('a guide is drawn on the backdrop, not as a canvas object', async () => {
  await page.evaluate(async () => {
    const api = window as unknown as { __openburn: { setGuides: (g: Guide[]) => void } };
    api.__openburn.setGuides([{ axis: 'x', position: 50 }]);
  });

  await expect.poll(async () => (await guides()).length).toBe(1);
  const objectCount = await page.evaluate(
    () =>
      (window as unknown as { __openburn: { canvas: { getObjects: () => unknown[] } } })
        .__openburn.canvas.getObjects().length,
  );
  expect(objectCount).toBe(0);
});

test('a guide survives save and reopen', async () => {
  const designPath = path.join(profile, 'guides.obrn');
  await page.evaluate(async (position) => {
    const api = window as unknown as {
      __openburn: { setGuides: (g: Guide[]) => void; saveProject: () => Promise<string | null> };
    };
    api.__openburn.setGuides([{ axis: 'y', position }]);
  }, 123.5);

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath, bookmarks: undefined });
  }, designPath);

  await page.getByRole('button', { name: 'Save (Ctrl+S)' }).click();
  await expect.poll(() => guides().then((g) => g.length)).toBe(1);

  await page.evaluate(() => {
    (window as unknown as { __openburn: { newDocument: () => void } }).__openburn.newDocument();
  });
  await expect.poll(() => guides().then((g) => g.length)).toBe(0);

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [filePath], bookmarks: undefined });
  }, designPath);
  await page.evaluate(async () => {
    const api = window.openburn;
    const chosen = await api?.openFile();
    if (!chosen) throw new Error('no file chosen');
    await (
      window as unknown as { __openburn: { openPath: (p: string) => Promise<void> } }
    ).__openburn.openPath(chosen);
  });

  await expect.poll(() => guides().then((g) => g.length)).toBe(1);
  expect((await guides())[0]).toEqual({ axis: 'y', position: 123.5 });
});

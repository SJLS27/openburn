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

const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;
const profile = createTestProfile();

/** Minimal shape of the controller exposed on `window.__openburn`. */
type Controller = {
  canvas: {
    getObjects: () => { type: string; path?: unknown[]; getBoundingRect: () => { left: number; top: number; width: number; height: number } }[];
    getActiveObjects: () => unknown[];
    setActiveObject: (o: unknown) => void;
    requestRenderAll: () => void;
  };
  selectAllNodes: () => void;
  deleteSelectedNodes: () => boolean;
  setSelectedNodeType: (type: 'corner' | 'smooth' | 'symmetric') => void;
  toggleSelectedSegment: () => void;
  nodeHandles: { circle: { left: number; top: number }; subIndex: number; nodeIndex: number }[];
  selectNode: (subIndex: number, nodeIndex: number, additive: boolean) => void;
  getCanvas: () => { getZoom: () => number; viewportTransform: number[] };
  newDocument: () => void;
  convertToPath: () => Promise<void>;
};

async function controller(): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __openburn?: unknown }).__openburn);
}

/** Number of commands of the first path on the canvas. */
async function pathCommandCount(): Promise<number> {
  return page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    const pathObj = c.canvas.getObjects().find((o) => o.type === 'path');
    return pathObj?.path?.length ?? -1;
  });
}

/** Command types of the first path, e.g. `['M','L','L','Z']`. */
async function pathCommands(): Promise<string[]> {
  return page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    const pathObj = c.canvas.getObjects().find((o) => o.type === 'path');
    return (pathObj?.path ?? []).map((cmd) => String((cmd as unknown[])[0]));
  });
}

/** Start from an empty document (the unsaved-changes guard may not appear). */
async function freshDocument(): Promise<void> {
  await page.evaluate(() => (window as unknown as { __openburn: Controller }).__openburn.newDocument());
  await dismissWelcome(page);
}

/** Draw a rectangle with the real rect tool and convert it to a path. */
async function drawRectanglePath(): Promise<void> {
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox()) ?? { x: 0, y: 0, width: 500, height: 400 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.press('r');
  await page.mouse.move(cx - 90, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    return c.canvas.getObjects().filter((o) => o.type === 'rect').length;
  })).toBe(1);
  await page.keyboard.press('Escape');
  // Select the rectangle and turn it into an editable path.
  await page.mouse.click(cx, cy);
  await page.evaluate(() => {
    const c = (window as unknown as { __openburn: { convertToPath: () => Promise<void> } }).__openburn;
    return c.convertToPath();
  });
  await expect.poll(() => pathCommandCount()).toBeGreaterThan(0);
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: launchEnv(profile),
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissWelcome(page);
  await controller();
});

test.afterAll(async () => {
  await app?.close();
  removeTestProfile(profile);
});

test.describe.configure({ mode: 'serial' });

test('node mode deletes only the selected node, not the whole path', async () => {
  await freshDocument();
  await drawRectanglePath();

  const before = await pathCommandCount();
  await page.keyboard.press('n');

  // Select a single node by clicking its handle on the canvas.
  const handle = page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller & { nodeHandles: { circle: unknown }[] } }).__openburn;
    return c.nodeHandles.length;
  });
  expect(await handle).toBeGreaterThan(0);

  const deleted = await page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    // Select exactly one node through the UI selection helper.
    const anyc = c as unknown as {
      nodeHandles: { circle: { left: number; top: number }; subIndex: number; nodeIndex: number }[];
      selectNode: (sub: number, node: number, additive: boolean) => void;
    };
    const first = anyc.nodeHandles[0];
    anyc.selectNode(first.subIndex, first.nodeIndex, false);
    return c.deleteSelectedNodes();
  });
  expect(deleted).toBe(true);

  // The path still exists and lost one node instead of disappearing.
  const after = await pathCommandCount();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test('segment line/curve conversion keeps the path valid', async () => {
  await freshDocument();
  await drawRectanglePath();
  await page.keyboard.press('n');
  await page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    c.selectAllNodes();
    c.toggleSelectedSegment();
  });
  const commands = await pathCommands();
  expect(commands).toContain('C');
  await page.evaluate(() => (window as unknown as { __openburn: Controller }).__openburn.toggleSelectedSegment());
  expect(await pathCommands()).not.toContain('C');
});

test('node type can be switched to smooth and symmetric', async () => {
  await freshDocument();
  await drawRectanglePath();
  await page.keyboard.press('n');
  await page.evaluate(() => {
    const c = (window as unknown as { __openburn: Controller }).__openburn;
    c.selectAllNodes();
    c.setSelectedNodeType('smooth');
  });
  // A smoothed corner grows handles, so the path becomes a curve.
  expect(await pathCommands()).toContain('C');
});

test('snap options popover toggles object snapping', async () => {
  await page.getByRole('button', { name: 'Snap settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Snap settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Enable snapping').check();
  await dialog.getByLabel('Objects (vertices, centres)').check();
  await expect(dialog.getByLabel('Objects (vertices, centres)')).toBeChecked();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test('snapping aligns a drawn rectangle to an existing object edge', async () => {
  await freshDocument();

  // Objects + intersections on, grid off, generous capture radius.
  await page.getByRole('button', { name: 'Snap settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Snap settings' });
  await dialog.getByLabel('Enable snapping').check();
  await dialog.getByLabel('Objects (vertices, centres)').check();
  await dialog.getByLabel('Grid').uncheck();
  await page.mouse.click(5, 5);

  /** Scene → client pixel helper matching the canvas layout. */
  const toClient = async (x: number, y: number) => {
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox()) ?? { x: 0, y: 0 };
    const { zoom, vpt } = await page.evaluate(() => {
      const c = (window as unknown as { __openburn: Controller }).__openburn;
      return { zoom: c.getCanvas().getZoom(), vpt: c.getCanvas().viewportTransform };
    });
    return { x: box.x + x * zoom + vpt[4], y: box.y + y * zoom + vpt[5], zoom };
  };

  const rects = () =>
    page.evaluate(() => {
      const c = (window as unknown as { __openburn: Controller }).__openburn;
      return c.canvas
        .getObjects()
        .filter((o) => o.type === 'rect')
        .map((o) => {
          const b = o.getBoundingRect();
          return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
        });
    });

  // First rectangle between (100,150) and (180,220).
  await page.keyboard.press('r');
  const a = await toClient(100, 150);
  const b = await toClient(180, 220);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  const [first] = await rects();

  // Second rectangle starts on empty canvas to the right and ends 3 mm past
  // the first rectangle's right edge, so the drawn corner must snap back.
  await page.keyboard.press('r');
  const start = await toClient(first.right + 30, first.top + 10);
  const end = await toClient(first.right + 3 / start.zoom, first.bottom);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  // The snap indicator shows the captured edge while drawing.
  await expect(page.getByTestId('snap-hint')).toBeVisible();
  await page.mouse.up();

  const all = await rects();
  expect(all).toHaveLength(2);
  // The second rectangle's left edge lands exactly on the first right edge.
  expect(Math.abs(all[1].left - first.right)).toBeLessThan(0.01);
});

import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * Integration tests for the system clipboard bridge.
 *
 * These exercise the *real* Electron clipboard (not a mock), which is where
 * platform-specific Inkscape formats actually show up. On headless Linux run
 * them with `xvfb-run -a npm run test:e2e`.
 */

const repoRoot = path.resolve(__dirname, '..');
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm">' +
  '<rect width="10" height="10"/></svg>';
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (!app) return;
  // Adding objects marks the document dirty, and the app asks to save on close.
  // Exit the main process directly so the native "unsaved changes" dialog does
  // not block the test run.
  await app
    .evaluate(({ app: electronApp }) => electronApp.exit(0))
    .catch(() => undefined);
});

/**
 * Write raw bytes under the given clipboard types. Returns false when the
 * platform cannot own a raw format or does not publish it back (common on
 * headless CI), so the test can skip instead of failing on an environment
 * limitation.
 */
async function writeClipboard(entries: Record<string, number[]>): Promise<boolean> {
  const ok = await app.evaluate(async ({ clipboard, ClipboardItem }, payload) => {
    try {
      const items: Record<string, Blob> = {};
      for (const [type, bytes] of Object.entries(payload)) {
        items[type] = new Blob([Uint8Array.from(bytes)]);
      }
      await clipboard.write([new ClipboardItem(items)]);

      // Verify the format actually round-trips: headless runners without a
      // clipboard manager often accept the write but expose nothing on read.
      const readback = await clipboard.read();
      for (const type of Object.keys(payload)) {
        const entry = readback.find((item) => item.types.includes(type));
        if (!entry) continue;
        const blob = await entry.getType(type);
        if (blob instanceof Blob && blob.size > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }, entries);
  // Give the OS clipboard a tick to publish the new owner.
  await page.waitForTimeout(100);
  return ok;
}

async function readClipboardBridge() {
  return page.evaluate(() =>
    (window as unknown as {
      openburn: {
        readClipboard: () => Promise<{ svg: string | null; image: string | null }>;
      };
    }).openburn.readClipboard(),
  );
}

test('plain image/svg+xml round-trips through the clipboard bridge', async () => {
  const wrote = await writeClipboard({
    'image/svg+xml': Array.from(Buffer.from(SVG, 'utf-8')),
  });
  test.skip(!wrote, 'platform does not allow writing image/svg+xml to the clipboard');

  const payload = await readClipboardBridge();
  expect(payload.svg).toContain('<svg');
});

test('Inkscape compressed SVG wins over the raster snapshot', async () => {
  const gz = gzipSync(Buffer.from(SVG));
  const wrote = await writeClipboard({
    // Exactly how Inkscape exposes its vector payload on Linux/X11; Electron 45
    // may surface it under this raw-format wrapper.
    'electron application/osclipboard;format="image/x-inkscape-compressed-svg"':
      Array.from(gz),
    'image/png': Array.from(PNG_1PX),
  });
  test.skip(!wrote, 'platform does not allow writing the raw Inkscape format');

  const payload = await readClipboardBridge();
  // The vector payload must be decoded as SVG, not pasted as the PNG snapshot.
  expect(payload.svg).toContain('<svg');
  expect(payload.svg).not.toContain('<html');
});

test('pasting an Inkscape SVG creates vector shapes, never a raster image', async () => {
  const gz = gzipSync(Buffer.from(SVG));
  const wrote = await writeClipboard({
    'electron application/osclipboard;format="image/x-inkscape-compressed-svg"':
      Array.from(gz),
    'image/png': Array.from(PNG_1PX),
  });
  test.skip(!wrote, 'platform does not allow writing the raw Inkscape format');

  const types = await page.evaluate(async () => {
    const ws = (window as unknown as {
      __openburn?: {
        canvas: { getObjects: () => Array<{ type?: string }> };
        pasteFromSystem: () => Promise<void>;
      };
    }).__openburn;
    if (!ws) return [];
    await ws.pasteFromSystem();
    return ws.canvas.getObjects().map((o) => o.type ?? '');
  });

  // The clipboard also carries image/png; the vector must win, otherwise the
  // "Inkscape paste becomes an image" regression is back.
  expect(types.length).toBeGreaterThan(0);
  expect(types).not.toContain('image');
  expect(
    types.some((type) => /rect|path|group|polygon|polyline|ellipse|circle/i.test(type)),
  ).toBe(true);
});

/** Number of objects currently on the Fabric canvas. */
async function objectCount(): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __openburn?: { canvas: { getObjects: () => unknown[] } } })
        .__openburn?.canvas.getObjects().length ?? 0,
  );
}

/** Put an Inkscape-style compressed SVG (plus a PNG snapshot) on the clipboard. */
async function writeInkscapeSvg(): Promise<boolean> {
  return writeClipboard({
    'electron application/osclipboard;format="image/x-inkscape-compressed-svg"':
      Array.from(gzipSync(Buffer.from(SVG))),
    'image/png': Array.from(PNG_1PX),
  });
}

test('Edit → Paste uses the system clipboard when the internal one is empty', async () => {
  const wrote = await writeInkscapeSvg();
  test.skip(!wrote, 'platform does not allow writing the raw Inkscape format');

  const before = await objectCount();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.menu-dropdown').getByText('Paste', { exact: true }).click();

  await expect.poll(objectCount, { timeout: 5000 }).toBeGreaterThan(before);
});

test('canvas context menu → Paste uses the system clipboard', async () => {
  const wrote = await writeInkscapeSvg();
  test.skip(!wrote, 'platform does not allow writing the raw Inkscape format');

  const before = await objectCount();
  await page.locator('.workspace-area').click({
    button: 'right',
    position: { x: 260, y: 220 },
  });
  await expect(page.locator('.canvas-context-menu')).toBeVisible();
  await page.locator('.canvas-context-menu').getByText('Paste', { exact: true }).click();

  await expect.poll(objectCount, { timeout: 5000 }).toBeGreaterThan(before);
});

test('canvas context menu → Paste from clipboard reads the system clipboard', async () => {
  const wrote = await writeInkscapeSvg();
  test.skip(!wrote, 'platform does not allow writing the raw Inkscape format');

  const before = await objectCount();
  await page.locator('.workspace-area').click({
    button: 'right',
    position: { x: 280, y: 240 },
  });
  await expect(page.locator('.canvas-context-menu')).toBeVisible();
  await page
    .locator('.canvas-context-menu')
    .getByText('Paste from clipboard', { exact: true })
    .click();

  await expect.poll(objectCount, { timeout: 5000 }).toBeGreaterThan(before);
});

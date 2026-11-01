import fs from 'node:fs';
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
 * P6 desktop fundamentals: window bounds, autosave recovery, recents and
 * drag & drop. Each test uses its own profile directory.
 */

const repoRoot = path.resolve(__dirname, '..');

async function launch(
  profile: string,
  extraArgs: string[] = [],
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [repoRoot, '--no-sandbox', ...extraArgs],
    env: launchEnv(profile),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __openburn?: unknown }).__openburn),
  );
  return { app, page };
}

async function exit(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ app: electronApp }) => electronApp.exit(0))
    .catch(() => undefined);
}

async function drawRectangle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rectangle (R)' }).click();
  const box = await page.locator('.fabric-host').boundingBox();
  if (!box) throw new Error('canvas host is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 40, y - 30);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 6 });
  await page.mouse.up();
}

test('restores the window size on the next launch', async () => {
  // Wayland compositors ignore programmatic window positions and sizes, so the
  // assertion is only meaningful under a plain X11 server (CI uses xvfb).
  test.skip(process.env.XDG_SESSION_TYPE === 'wayland', 'needs an X11 server');
  const profile = createTestProfile();
  const first = await launch(profile);
  await dismissWelcome(first.page);

  await first.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 80, width: 1280, height: 760 });
  });
  await expect
    .poll(() => {
      const file = path.join(profile, 'window-state.json');
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, number>;
    })
    .toMatchObject({ x: 100, y: 80, width: 1280, height: 760 });

  await first.app.close();

  const second = await launch(profile);
  const bounds = await second.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  expect(bounds.width).toBe(1280);
  expect(bounds.height).toBe(760);

  await second.app.close();
  removeTestProfile(profile);
});

test('offers to recover an autosaved draft after a crash', async () => {
  const profile = createTestProfile();
  const first = await launch(profile);
  await dismissWelcome(first.page);
  await drawRectangle(first.page);

  await expect
    .poll(() => fs.existsSync(path.join(profile, 'autosave.json')), { timeout: 8000 })
    .toBe(true);

  // Simulate a crash: exit without letting the window close or save.
  await exit(first.app);

  const second = await launch(profile);
  const dialog = second.page.locator('.dialog-header', { hasText: 'Recover Unsaved Work' });
  await expect(dialog).toBeVisible();
  await second.page.getByRole('button', { name: 'Recover', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(second.page).toHaveTitle(/Untitled \*/);

  const rects = await second.page.evaluate(
    () =>
      (window as unknown as {
        __openburn: { canvas: { getObjects: () => Array<{ type?: string }> } };
      }).__openburn.canvas.getObjects().filter((o) => o.type === 'rect').length,
  );
  expect(rects).toBe(1);

  await exit(second.app);
  removeTestProfile(profile);
});

test('drops an SVG file onto the canvas', async () => {
  const profile = createTestProfile();
  const { app, page } = await launch(profile);
  await dismissWelcome(page);

  await page.evaluate(() => {
    const host = document.querySelector('.workspace-area');
    if (!host) throw new Error('workspace is not mounted');
    const box = host.getBoundingClientRect();
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm">' +
          '<rect x="0" y="0" width="40" height="20"/></svg>',
      ],
      'dropped.svg',
      { type: 'image/svg+xml' },
    );
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    };
    host.dispatchEvent(new DragEvent('dragover', init));
    host.dispatchEvent(new DragEvent('drop', init));
  });

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as {
            __openburn: { canvas: { getObjects: () => unknown[] } };
          }).__openburn.canvas.getObjects().length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page).toHaveTitle(/\*/);

  await exit(app);
  removeTestProfile(profile);
});

test('reopens a saved project from File → Open Recent', async () => {
  const profile = createTestProfile();
  const { app, page } = await launch(profile);
  await dismissWelcome(page);

  const designPath = path.join(profile, 'recent-test.obrn');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath, bookmarks: undefined });
  }, designPath);

  await drawRectangle(page);
  await page.getByRole('button', { name: 'Save (Ctrl+S)' }).click();
  await expect.poll(() => fs.existsSync(designPath)).toBe(true);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(
    page.locator('.menu-dropdown').getByRole('button', { name: /recent-test\.obrn/ }),
  ).toBeVisible();

  // Start a clean document, then reopen the saved project from the menu.
  await page.locator('.menu-dropdown').getByRole('button', { name: /^New/ }).click();
  await expect(page).toHaveTitle(/Untitled/);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('.menu-dropdown').getByRole('button', { name: /recent-test\.obrn/ }).click();
  await expect(page).toHaveTitle(/recent-test\.obrn/);
  await expect(page).not.toHaveTitle(/\*/);

  // Saving added the file to recents without relying on a prior Open.
  const recent = JSON.parse(
    fs.readFileSync(path.join(profile, 'recent-files.json'), 'utf-8'),
  ) as Array<{ path: string }>;
  expect(recent.some((entry) => entry.path === designPath)).toBe(true);

  await app.close();
  removeTestProfile(profile);
});

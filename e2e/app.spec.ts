import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const repoRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
) as { version: string };

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
  await app?.close();
});

test('opens the editor window', async () => {
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page).toHaveTitle(/OpenBurn/);
});

test('main process reports the package version', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  expect(version).toBe(pkg.version);
});

test('Help → Check for Updates opens the updater dialog', async () => {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: /Check for Updates/ }).click();

  await expect(page.getByText('Software Update')).toBeVisible();
  // Launched from source, the app is not packaged, so the updater reports that
  // automatic updates are unavailable instead of failing.
  await expect(
    page.getByText(/Automatic updates are only available in packaged builds/),
  ).toBeVisible();
});

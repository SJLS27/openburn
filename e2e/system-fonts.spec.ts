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

test.beforeAll(async () => {
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: launchEnv(profile),
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissWelcome(page);
});

test.afterAll(async () => {
  await app?.close();
  removeTestProfile(profile);
});

test('lists the fonts installed on this machine (GitHub: system fonts)', async () => {
  const result = await page.evaluate(() => window.openburn?.fonts.list());

  // An empty list with an error is acceptable on machines without fontconfig,
  // but the IPC must always answer with the documented shape.
  expect(result).toBeDefined();
  expect(Array.isArray(result?.fonts)).toBe(true);
  for (const font of result?.fonts ?? []) {
    expect(typeof font.family).toBe('string');
    expect(typeof font.file).toBe('string');
    expect(['regular', 'bold', 'italic', 'bold italic']).toContain(font.style);
  }
});

test('refuses to read a font that was not listed', async () => {
  const error = await page.evaluate(async () => {
    try {
      await window.openburn?.fonts.read('/etc/passwd');
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  });
  expect(error).toMatch(/outside the system font list/);
});

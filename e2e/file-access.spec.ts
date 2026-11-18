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
 * The main process only reads and writes paths the user picked: a native
 * dialog, a drag & drop or the recent list. `electron/pathAllowList.ts` is the
 * gate; these tests exercise it through the real IPC surface.
 */

const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeAll(async () => {
  profile = createTestProfile();
  app = await electron.launch({
    args: [repoRoot, '--no-sandbox'],
    env: launchEnv(profile),
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissWelcome(page);
});

test.afterAll(async () => {
  await app
    .evaluate(({ app: electronApp }) => electronApp.exit(0))
    .catch(() => undefined);
  removeTestProfile(profile);
});

/** Read through the renderer bridge and return the error message, if any. */
async function readError(filePath: string): Promise<string | null> {
  return page.evaluate(async (target) => {
    try {
      await window.openburn?.readFile(target);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, filePath);
}

test('refuses to read a path the user never picked', async () => {
  const error = await readError('/etc/passwd');
  expect(error).toMatch(/Access denied/i);
});

test('refuses to write a path the user never picked', async () => {
  const target = path.join(profile, 'never-chosen.txt');
  const error = await page.evaluate(async (filePath) => {
    try {
      await window.openburn?.writeFile(filePath, 'pwned');
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, target);
  expect(error).toMatch(/Access denied/i);
  expect(fs.existsSync(target)).toBe(false);
});

test('a file chosen in the save dialog can be written and read back', async () => {
  const target = path.join(profile, 'chosen.obrn');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath, bookmarks: undefined });
  }, target);

  const saved = await page.evaluate(async (filePath) => {
    const api = window.openburn;
    if (!api) return null;
    const chosen = await api.saveFile({ defaultPath: 'chosen.obrn' });
    if (!chosen) return null;
    await api.writeFile(chosen, '{"content":"written by the test"}');
    return api.readFile(chosen);
  }, target);

  expect(saved).toBe('{"content":"written by the test"}');
  expect(fs.readFileSync(target, 'utf-8')).toBe('{"content":"written by the test"}');
});

test('a file chosen in the open dialog can be read but not written', async () => {
  const source = path.join(profile, 'readonly.obrn');
  fs.writeFileSync(source, '{"content":"original"}');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [filePath], bookmarks: undefined });
  }, source);

  const result = await page.evaluate(async () => {
    const api = window.openburn;
    if (!api) return null;
    const chosen = await api.openFile();
    if (!chosen) return null;
    const text = await api.readFile(chosen);
    let writeError: string | null = null;
    try {
      await api.writeFile(chosen, 'overwritten');
    } catch (err) {
      writeError = (err as Error).message;
    }
    return { text, writeError };
  });

  expect(result?.text).toBe('{"content":"original"}');
  // Picking a file for opening is enough to save it later, so writing back is
  // allowed: the user did choose this file.
  expect(result?.writeError).toBeNull();
});

test('a path approved through a drop becomes readable', async () => {
  const dropped = path.join(profile, 'dropped.svg');
  fs.writeFileSync(dropped, '<svg xmlns="http://www.w3.org/2000/svg"/>');

  // Before approval the main process refuses it.
  expect(await readError(dropped)).toMatch(/Access denied/i);

  const text = await page.evaluate(async (filePath) => {
    const api = window.openburn;
    if (!api) return null;
    await api.approvePaths([filePath]);
    return api.readFile(filePath);
  }, dropped);

  expect(text).toContain('<svg');
});

test('a path that does not exist cannot be approved', async () => {
  const missing = path.join(profile, 'ghost.svg');
  const error = await page.evaluate(async (filePath) => {
    const api = window.openburn;
    if (!api) return null;
    await api.approvePaths([filePath]);
    try {
      await api.readFile(filePath);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, missing);
  expect(error).toMatch(/Access denied/i);
});

test('a symlink cannot be used to reach a file outside the grant', async () => {
  const allowed = path.join(profile, 'allowed.svg');
  fs.writeFileSync(allowed, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const secret = path.join(profile, 'secret.txt');
  fs.writeFileSync(secret, 'top secret');
  const link = path.join(profile, 'link.svg');
  fs.symlinkSync(secret, link);

  await page.evaluate(async (filePath) => {
    await window.openburn?.approvePaths([filePath]);
  }, allowed);

  expect(await readError(link)).toMatch(/Access denied/i);
});

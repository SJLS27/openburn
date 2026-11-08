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

/** Live `textAlign` of every text object on the canvas, in creation order. */
async function textAligns(): Promise<string[]> {
  return page.evaluate(() => {
    const controller = (window as unknown as {
      __openburn?: { canvas: { getObjects: () => { type: string; textAlign?: string }[] } };
    }).__openburn;
    return (controller?.canvas.getObjects() ?? [])
      .filter((o) => o.type === 'textbox' || o.type === 'text' || o.type === 'i-text')
      .map((o) => o.textAlign ?? 'left');
  });
}

/** Create a textbox through the real text tool (T + click). */
async function createText(): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox()) ?? { x: 0, y: 0, width: 400, height: 300 };
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => textAligns()).toHaveLength(1);
  // Leave editing so the text object is selected and not in edit mode.
  await page.keyboard.press('Escape');
}

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

test('aligns the selected text from the text toolbar', async () => {
  await createText();

  await page.getByTitle('Align text center').click();
  await expect.poll(() => textAligns()).toEqual(['center']);

  await page.getByTitle('Align text right').click();
  await expect.poll(() => textAligns()).toEqual(['right']);

  await page.getByTitle('Align text left').click();
  await expect.poll(() => textAligns()).toEqual(['left']);
});

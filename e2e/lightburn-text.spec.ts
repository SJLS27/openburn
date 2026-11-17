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
// Small sample derived from the attachment in GitHub #1 (a LightBurn 2.x
// project whose text lives only in `<BackupPath>`).
const fixture = path.join(repoRoot, 'src', 'io', '__fixtures__', 'text-backuppath.lbrn2');

let app: ElectronApplication;
let page: Page;
const profile = createTestProfile();

interface TextSnapshot {
  text: string;
  fontFamily: string;
  fontSize: number;
  textLines: string[];
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

test('opens LightBurn text as an editable textbox (GitHub #1)', async () => {
  await page.evaluate(
    (filePath) =>
      (
        window as unknown as { __openburn: { openPath: (p: string) => Promise<void> } }
      ).__openburn.openPath(filePath),
    fixture,
  );

  const texts = () =>
    page.evaluate<TextSnapshot[]>(() => {
      const controller = (
        window as unknown as {
          __openburn?: {
            canvas: {
              getObjects: () => {
                type: string;
                text?: string;
                fontFamily?: string;
                fontSize?: number;
                textLines?: string[];
              }[];
            };
          };
        }
      ).__openburn;
      return (controller?.canvas.getObjects() ?? [])
        .filter((o) => o.type === 'textbox' || o.type === 'text' || o.type === 'i-text')
        .map((o) => ({
          text: o.text ?? '',
          fontFamily: o.fontFamily ?? '',
          fontSize: o.fontSize ?? 0,
          textLines: o.textLines ?? [],
        }));
    });

  await expect.poll(async () => (await texts()).length).toBe(1);

  const [text] = await texts();
  expect(text.text).toBe('ZA VEDNO V\nNAŠIH SRCIH');
  expect(text.textLines).toEqual(['ZA VEDNO V', 'NAŠIH SRCIH']);
  expect(text.fontFamily).toBe('Arial Black');
  expect(text.fontSize).toBe(25);
});

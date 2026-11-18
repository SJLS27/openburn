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
  /** `lightburnFontFamily`: the family named in the file. */
  backupFamily?: string;
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
                lightburnFontFamily?: string;
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
          backupFamily: o.lightburnFontFamily,
        }));
    });

  await expect.poll(async () => (await texts()).length).toBe(1);

  const [text] = await texts();
  expect(text.text).toBe('ZA VEDNO V\nNAŠIH SRCIH');
  expect(text.textLines).toEqual(['ZA VEDNO V', 'NAŠIH SRCIH']);
  expect(text.fontSize).toBe(25);

  // Where Arial Black is installed the object keeps it; elsewhere the importer
  // falls back to Inter. Both are valid — the original name is kept either way.
  const fonts = await page.evaluate(() =>
    (window.openburn?.fonts?.list ? window.openburn.fonts.list() : Promise.resolve({ fonts: [] })),
  );
  const installed = (fonts.fonts ?? []).some(
    (f) => f.family.toLowerCase() === 'arial black',
  );
  expect(text.fontFamily).toBe(installed ? 'Arial Black' : 'Inter');
  expect(text.backupFamily).toBe('Arial Black');
});

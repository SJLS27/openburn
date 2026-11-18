import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Regression: with no fonts installed, Chromium aborted inside Skia
 * (`FATAL: SkFontMgr_FontConfigInterface.cpp: Not implemented`) before the first
 * window existed, so the editor never opened and no dialog could explain why.
 *
 * `electron/fontFallback.ts` cannot patch the process that is already starting
 * (Chromium reads fontconfig before any app code runs), so on a fontless system
 * it writes a fontconfig that adds the bundled Inter and relaunches once.
 * These tests cover both halves:
 *
 * 1. the first boot detects the situation and leaves the fallback behind;
 * 2. a process started with that configuration comes up without the abort.
 */

const repoRoot = path.resolve(__dirname, '..');
const electronBin = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
const fallbackConfig = path.join(os.tmpdir(), 'openburn-fontconfig.conf');
const fallbackFont = path.join(os.tmpdir(), 'openburn-fonts', 'OpenBurnFallback.ttf');

let profile: string;
let previousFontConfig: string | undefined;

test.beforeAll(() => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-e2e-fonts-'));

  // An empty font directory plus a fontconfig that only knows about it: the
  // same situation as a container or a stripped-down distro.
  const emptyDir = path.join(profile, 'empty-fonts');
  fs.mkdirSync(emptyDir, { recursive: true });
  const emptyFontConfig = path.join(profile, 'fonts.conf');
  fs.writeFileSync(
    emptyFontConfig,
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
      '<fontconfig>',
      `  <dir>${emptyDir}</dir>`,
      `  <cachedir>${path.join(profile, 'font-cache')}</cachedir>`,
      '</fontconfig>',
      '',
    ].join('\n'),
  );

  fs.rmSync(fallbackConfig, { force: true });
  fs.rmSync(path.dirname(fallbackFont), { recursive: true, force: true });

  // Playwright's `env` option cannot *remove* an inherited variable, so the
  // empty config goes through the parent environment instead.
  previousFontConfig = process.env.FONTCONFIG_FILE;
  process.env.FONTCONFIG_FILE = emptyFontConfig;
});

test.afterAll(() => {
  fs.rmSync(profile, { recursive: true, force: true });
  if (previousFontConfig === undefined) delete process.env.FONTCONFIG_FILE;
  else process.env.FONTCONFIG_FILE = previousFontConfig;
});

test('boots without fonts by relaunching with the bundled face', async () => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }

  // The first boot hands over to the relaunch, so the Playwright connection is
  // expected to drop: that is the designed behaviour, not a test failure.
  await electron
    .launch({ args: [repoRoot, '--no-sandbox'], env })
    .then((app) => app.close())
    .catch(() => undefined);

  await expect.poll(() => fs.existsSync(fallbackFont), { timeout: 20000 }).toBe(true);
  await expect.poll(() => fs.existsSync(fallbackConfig), { timeout: 20000 }).toBe(true);
  const config = fs.readFileSync(fallbackConfig, 'utf-8');
  expect(config).toContain(`<dir>${path.dirname(fallbackFont)}</dir>`);
  // The cache has to be declared first, or fontconfig never caches the directory
  // and Skia cannot see the face.
  expect(config.indexOf('<cachedir>')).toBeLessThan(config.indexOf('<dir>'));
});

test('the relaunched process starts without the Skia abort', async () => {
  await expect.poll(() => fs.existsSync(fallbackConfig), { timeout: 20000 }).toBe(true);

  const log = path.join(profile, 'relaunch.log');
  const child = spawn(electronBin, [repoRoot, '--no-sandbox'], {
    env: { ...process.env, FONTCONFIG_FILE: fallbackConfig },
    stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')],
  });
  await new Promise((resolve) => setTimeout(resolve, 7000));
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(fs.readFileSync(log, 'utf-8')).not.toContain('FATAL:third_party/skia');
});

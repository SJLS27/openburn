import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the packaged renderer (`dist/`) and the
 * compiled Electron main process (`dist-electron/`), so run `npm run build`
 * first (the `test:e2e` script does it for you).
 *
 * Electron is launched by each spec with `_electron.launch()`, so there are no
 * browser projects here. On headless Linux use `xvfb-run -a npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});

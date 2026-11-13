import { defineConfig } from '@playwright/test';

/**
 * Documentation screenshots (README + website). Not part of CI.
 *
 * Run it through `npm run docs:screenshots`, which builds a dev-mode renderer
 * first so the demo helpers in `src/main.tsx` are exposed on `window`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /screenshot-(docs|icon)\.spec\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
});

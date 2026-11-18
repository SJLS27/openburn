import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

/**
 * Only these files need a DOM: they mount React or Fabric, or use
 * `localStorage`/`window` timers. Everything else runs in plain `node`, which is
 * far cheaper to set up (creating jsdom for 52 files was the bulk of the
 * suite's CPU) and catches accidental browser globals in pure logic.
 */
const DOM_TESTS = [
  'src/ui/**/*.test.{ts,tsx}',
  'src/workspace/textStyle.test.ts',
  'src/state/{store,updateStore,recentStore,autosave}.test.ts',
  // Uses `window.setTimeout` for log batching.
  'src/serial/machine.test.ts',
  'src/io/lightburn.test.ts',
  'src/gcode/job.test.ts',
  'src/gcode/job.bench.test.ts',
];

// `test.setupFiles` is not inherited inside `projects`, so the DOM project gets
// it explicitly below.
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };
const resolve = { alias: { '@': path.resolve(__dirname, 'src') } };

/**
 * `define` is not applied to test files inside `test.projects`, so the constant
 * Vite injects in the app is replaced here for both projects.
 */
const appVersionPlugin = {
  name: 'openburn-app-version',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('/src/') && !id.includes('/electron/')) return null;
    if (!code.includes('__APP_VERSION__')) return null;
    return code.replaceAll('__APP_VERSION__', JSON.stringify(pkg.version));
  },
};

const coverage = {
  provider: 'v8' as const,
  reportsDirectory: 'coverage',
  include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
  exclude: ['src/**/*.d.ts', 'src/test/**', 'src/main.tsx', 'e2e/**'],
};

export default defineConfig({
  define,
  resolve,
  test: {
    globals: true,
    projects: [
      {
        // Pure logic: units, geometry, GCode, parsers, state, main process.
        plugins: [appVersionPlugin, react()],
        define,
        resolve,
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
          exclude: ['node_modules/**', 'dist/**', 'dist-electron/**', ...DOM_TESTS],
        },
      },
      {
        // React components and the handful of tests that need a real DOM.
        plugins: [appVersionPlugin, react()],
        define,
        resolve,
        test: {
          name: 'jsdom',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: DOM_TESTS,
        },
      },
    ],
    coverage,
  },
});

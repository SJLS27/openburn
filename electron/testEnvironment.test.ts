import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// picomatch ships no types; Vitest uses it for the `include` globs itself.
// @ts-expect-error -- untyped dependency, used only in this guard.
import picomatch from 'picomatch';

/**
 * The suite runs in two environments (`vitest.config.ts`): `node` for pure logic
 * and `jsdom` for the handful of files that need a DOM. Running jsdom for every
 * file was the bulk of the suite's CPU, so a file matched by the `node` project
 * must not reach for browser globals.
 *
 * This guard fails when a `node` test file grows a DOM dependency without being
 * moved to `DOM_TESTS`, which would otherwise show up as a confusing
 * `document is not defined` much later.
 */

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'vitest.config.ts'), 'utf-8');

/** Read the `DOM_TESTS` array from the Vitest config without importing it. */
function domTestGlobs(): string[] {
  const match = config.match(/const DOM_TESTS = \[([\s\S]*?)\];/);
  if (!match) throw new Error('DOM_TESTS is missing from vitest.config.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFiles(rel, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * Actual uses of browser globals. A bare `document` is too common as a word in
 * this codebase (the design is a "document"), so only property access counts.
 */
const DOM_GLOBALS = new RegExp(
  [
    String.raw`\bdocument\.(?!querySelectorAll\b)`,
    String.raw`\bwindow\.`,
    String.raw`\bglobalThis\.window\b`,
    String.raw`\blocalStorage\.`,
    String.raw`\bsessionStorage\.`,
    String.raw`\bnew (ResizeObserver|IntersectionObserver|MutationObserver)\b`,
    String.raw`\bmatchMedia\(`,
  ].join('|'),
);

describe('test environments', () => {
  const isDomTest = picomatch(domTestGlobs(), { dot: true });
  const files = [...testFiles('src'), ...testFiles('electron')];

  it('defines both projects in the config', () => {
    expect(config).toContain("name: 'node'");
    expect(config).toContain("name: 'jsdom'");
  });

  it('runs every test file in exactly one environment', () => {
    const listed = new Set(domTestGlobs());
    expect(listed.size).toBe(domTestGlobs().length);
    // No file may be matched by both the node include and DOM_TESTS.
    const nodeInclude = picomatch(['src/**/*.test.ts', 'electron/**/*.test.ts'], { dot: true });
    for (const file of files) {
      const inNode = nodeInclude(file) && !isDomTest(file);
      const inJsdom = isDomTest(file);
      expect(inNode !== inJsdom, `${file} must belong to exactly one project`).toBe(true);
    }
  });

  it('keeps browser globals out of the node project', () => {
    const offenders = files
      .filter((file) => !isDomTest(file))
      // Strip comments first: prose about "the window" is not a DOM access.
      .map((file) => ({
        file,
        code: fs
          .readFileSync(path.join(root, file), 'utf-8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\s)\/\/.*$/gm, '$1'),
      }))
      .filter(({ code }) => DOM_GLOBALS.test(code))
      .map(({ file }) => file);
    expect(offenders, `move these to DOM_TESTS or drop the DOM dependency: ${offenders.join(', ')}`)
      .toEqual([]);
  });
});

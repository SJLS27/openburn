// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFallbackFontConfig,
  bundledFallbackFont,
  countFcListFonts,
  dirsContainFonts,
  fallbackLayout,
  installFallbackFont,
  needsStartupFallback,
  shouldRelaunchWithFallback,
  systemFontConfigDirs,
} from './fontFallback';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-fontfallback-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('needsStartupFallback', () => {
  it('triggers only when the list is empty and no system dir holds a font', () => {
    expect(needsStartupFallback('linux', 0, false)).toBe(true);
  });

  it('trusts fonts found on disk even when fc-list fails or is missing', () => {
    expect(needsStartupFallback('linux', 0, true)).toBe(false);
  });

  it('never touches a machine that lists fonts', () => {
    expect(needsStartupFallback('linux', 12, true)).toBe(false);
  });

  it('never triggers outside Linux', () => {
    expect(needsStartupFallback('darwin', 0, false)).toBe(false);
    expect(needsStartupFallback('win32', 0, false)).toBe(false);
  });
});

describe('buildFallbackFontConfig', () => {
  it('declares the cache before the directory', () => {
    const xml = buildFallbackFontConfig('/tmp/fonts', '/tmp/cache', '/nonexistent.conf');
    expect(xml).toContain('<dir>/tmp/fonts</dir>');
    expect(xml).toContain('<cachedir>/tmp/cache</cachedir>');
    // fontconfig only caches directories added after a cache is known, and an
    // uncached face is invisible to Skia (the abort comes back).
    expect(xml.indexOf('<cachedir>')).toBeLessThan(xml.indexOf('<dir>'));
  });

  it('includes the system config when it exists so generic families resolve', () => {
    const system = path.join(tmp, 'fonts.conf');
    fs.writeFileSync(system, '<fontconfig/>');
    const xml = buildFallbackFontConfig('/tmp/fonts', '/tmp/cache', system);
    expect(xml).toContain(`<include ignore_missing="yes">${system}</include>`);
    expect(xml.indexOf('<include')).toBeLessThan(xml.indexOf('<cachedir>'));
  });

  it('omits the include when the system config is missing', () => {
    const xml = buildFallbackFontConfig('/tmp/fonts', '/tmp/cache', path.join(tmp, 'nope.conf'));
    expect(xml).not.toContain('<include');
  });

  it('escapes characters that would break the XML', () => {
    const xml = buildFallbackFontConfig('/tmp/a&b/<c>', '/tmp/cache', path.join(tmp, 'nope'));
    expect(xml).toContain('<dir>/tmp/a&amp;b/&lt;c&gt;</dir>');
  });
});

describe('shouldRelaunchWithFallback', () => {
  it('relaunches once when the system has no font', () => {
    expect(shouldRelaunchWithFallback('linux', 0, false, { retried: false })).toBe(true);
  });

  // Regression: a broken fallback must not relaunch on every start.
  it('never loops: the retried boot gives up instead', () => {
    expect(shouldRelaunchWithFallback('linux', 0, false, { retried: true })).toBe(false);
  });

  it('leaves machines with fonts alone', () => {
    expect(shouldRelaunchWithFallback('linux', 10, true, { retried: false })).toBe(false);
    expect(shouldRelaunchWithFallback('linux', 0, true, { retried: false })).toBe(false);
  });

  it('never triggers outside Linux', () => {
    expect(shouldRelaunchWithFallback('darwin', 0, false, { retried: false })).toBe(false);
  });
});

describe('fallbackLayout', () => {
  it('keeps every artifact under the given temp root', () => {
    const layout = fallbackLayout('/tmp/root');
    expect(layout.fontDir).toBe('/tmp/root/openburn-fonts');
    expect(layout.cacheDir).toBe('/tmp/root/openburn-fontconfig-cache');
    expect(layout.configFile).toBe('/tmp/root/openburn-fontconfig.conf');
  });
});

describe('installFallbackFont', () => {
  it('copies the face and writes the fontconfig file', () => {
    const source = path.join(tmp, 'Inter-Regular.ttf');
    fs.writeFileSync(source, 'fake-ttf');
    const layout = installFallbackFont(source, tmp);

    expect(fs.readFileSync(path.join(layout.fontDir, 'OpenBurnFallback.ttf'), 'utf-8')).toBe(
      'fake-ttf',
    );
    expect(fs.readFileSync(layout.configFile, 'utf-8')).toContain(
      `<dir>${layout.fontDir}</dir>`,
    );
    expect(fs.statSync(layout.cacheDir).isDirectory()).toBe(true);
  });

  it('overwrites a stale copy from a previous run', () => {
    const source = path.join(tmp, 'Inter-Regular.ttf');
    fs.writeFileSync(source, 'new');

    const first = installFallbackFont(source, tmp);
    fs.writeFileSync(path.join(first.fontDir, 'OpenBurnFallback.ttf'), 'old');

    const second = installFallbackFont(source, tmp);
    expect(fs.readFileSync(path.join(second.fontDir, 'OpenBurnFallback.ttf'), 'utf-8')).toBe(
      'new',
    );
  });
});

describe('countFcListFonts', () => {
  it('counts non-empty lines', () => {
    expect(countFcListFonts(() => 'a.ttf\n\nb.ttf\n')).toBe(2);
  });

  it('returns null when fc-list is missing', () => {
    expect(
      countFcListFonts(() => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
  });
});

describe('systemFontConfigDirs', () => {
  it('reads absolute <dir> entries from a fontconfig file', () => {
    const file = path.join(tmp, 'fonts.conf');
    fs.writeFileSync(
      file,
      '<fontconfig><dir>/usr/share/fonts</dir><dir prefix="xdg">fonts</dir>' +
        '<dir>/opt/fonts</dir></fontconfig>',
    );
    expect(systemFontConfigDirs(file)).toEqual(['/usr/share/fonts', '/opt/fonts']);
  });

  it('returns nothing when the file is missing', () => {
    expect(systemFontConfigDirs(path.join(tmp, 'nope.conf'))).toEqual([]);
  });
});

describe('dirsContainFonts', () => {
  it('finds a font file inside a directory', () => {
    const dir = path.join(tmp, 'fonts');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'Arial.TTF'), 'x');
    expect(dirsContainFonts([dir])).toBe(true);
  });

  it('ignores empty and missing directories', () => {
    const dir = path.join(tmp, 'empty');
    fs.mkdirSync(dir);
    expect(dirsContainFonts([dir, path.join(tmp, 'missing')])).toBe(false);
  });
});

describe('bundledFallbackFont', () => {
  it('finds the face in dist/ when packaged', () => {
    const appDir = path.join(tmp, 'app');
    fs.mkdirSync(path.join(appDir, 'dist', 'fonts'), { recursive: true });
    const file = path.join(appDir, 'dist', 'fonts', 'Inter-Regular.ttf');
    fs.writeFileSync(file, 'ttf');
    expect(bundledFallbackFont(appDir)).toBe(file);
  });

  it('falls back to public/ in development', () => {
    const appDir = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(appDir, 'public', 'fonts'), { recursive: true });
    const file = path.join(appDir, 'public', 'fonts', 'Inter-Regular.ttf');
    fs.writeFileSync(file, 'ttf');
    expect(bundledFallbackFont(appDir)).toBe(file);
  });

  it('returns null when there is no bundled face', () => {
    expect(bundledFallbackFont(path.join(tmp, 'nothing'))).toBeNull();
  });
});

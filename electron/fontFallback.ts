import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Startup font safety net.
 *
 * Chromium initialises fontconfig *before* running any app JavaScript, and when
 * that configuration exposes no face at all it aborts inside Skia
 * (`FATAL: SkFontMgr_FontConfigInterface.cpp: Not implemented`) — no window, no
 * dialog, no chance to explain anything. That kills OpenBurn in containers,
 * stripped distros, Flatpak runtimes without fonts and broken `fontconfig`
 * setups.
 *
 * Because the settings cannot be applied to the process that is already
 * starting, the fix is a single controlled restart:
 *
 *   boot A: detect that the system has no font, write a fontconfig file that
 *           adds the bundled Inter, then relaunch once with
 *           `FONTCONFIG_FILE` pointing at it;
 *   boot B: Chromium reads that file and starts normally.
 *
 * Machines with fonts never reach any of this: the detection returns early and
 * nothing in the environment changes. Everything here is pure (no Electron
 * import) so it can be unit tested.
 */

/** Marker set on the relaunch, so a failing fallback cannot loop forever. */
export const FONT_FALLBACK_ENV = 'OPENBURN_FONT_FALLBACK';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fontconfig file used on the relaunch.
 *
 * The cache is declared *before* the directory on purpose: fontconfig only sets
 * up the per-directory cache state when a directory is added after a cache is
 * known. The system config is included when present so generic families
 * (`sans-serif`, `monospace`) keep resolving for text rendering.
 */
export function buildFallbackFontConfig(
  dir: string,
  cacheDir: string,
  systemConfig = '/etc/fonts/fonts.conf',
): string {
  const include = fs.existsSync(systemConfig)
    ? [`  <include ignore_missing="yes">${escapeXml(systemConfig)}</include>`]
    : [];
  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
    '<fontconfig>',
    ...include,
    `  <cachedir>${escapeXml(cacheDir)}</cachedir>`,
    `  <dir>${escapeXml(dir)}</dir>`,
    '</fontconfig>',
    '',
  ].join('\n');
}

/**
 * Whether the system has no font at all, which is the only case the fallback
 * handles. `fc-list` may be missing on a working machine, so the configured
 * font directories get a say before answering "none".
 */
export function needsStartupFallback(
  platform: NodeJS.Platform,
  listCount: number,
  dirsWithFonts: boolean,
): boolean {
  if (platform !== 'linux') return false;
  return listCount === 0 && !dirsWithFonts;
}

/**
 * Whether the app should relaunch: the system has no fonts and this boot is not
 * already the fallback boot. Without the marker a broken fallback would relaunch
 * on every start.
 */
export function shouldRelaunchWithFallback(
  platform: NodeJS.Platform,
  listCount: number,
  dirsWithFonts: boolean,
  markers: { retried: boolean },
): boolean {
  if (markers.retried) return false;
  return needsStartupFallback(platform, listCount, dirsWithFonts);
}

export interface FallbackLayout {
  /** Directory fontconfig is pointed at (contains only our face). */
  fontDir: string;
  /** Writable cache, kept away from the user's cache layout. */
  cacheDir: string;
  /** `FONTCONFIG_FILE` value for the relaunch. */
  configFile: string;
}

/** Where the fallback lives under `tmpRoot` (`app.getPath('temp')`). */
export function fallbackLayout(tmpRoot: string): FallbackLayout {
  return {
    fontDir: path.join(tmpRoot, 'openburn-fonts'),
    cacheDir: path.join(tmpRoot, 'openburn-fontconfig-cache'),
    configFile: path.join(tmpRoot, 'openburn-fontconfig.conf'),
  };
}

/**
 * Copy `source` into the fallback directory and write the fontconfig file.
 * Idempotent: rewrites both every time, so a font update in the bundle wins
 * over a stale copy from a previous run.
 */
export function installFallbackFont(
  source: string,
  tmpRoot: string,
  fileName = 'OpenBurnFallback.ttf',
): FallbackLayout {
  const layout = fallbackLayout(tmpRoot);
  fs.mkdirSync(layout.fontDir, { recursive: true });
  fs.mkdirSync(layout.cacheDir, { recursive: true });
  fs.copyFileSync(source, path.join(layout.fontDir, fileName));
  fs.writeFileSync(layout.configFile, buildFallbackFontConfig(layout.fontDir, layout.cacheDir));
  return layout;
}

/**
 * Absolute font directories declared by a fontconfig file. Only read when
 * `fc-list` reports nothing, to tell "really no fonts" from "broken helper".
 */
export function systemFontConfigDirs(configFile = '/etc/fonts/fonts.conf'): string[] {
  let xml: string;
  try {
    xml = fs.readFileSync(configFile, 'utf-8');
  } catch {
    return [];
  }
  const dirs: string[] = [];
  const re = /<dir(?:\s[^>]*)?>([^<]+)<\/dir>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const dir = match[1].trim();
    if (dir.startsWith('/')) dirs.push(dir);
  }
  return dirs;
}

/** Whether any of `dirs` holds a font file (one `readdir` each). */
export function dirsContainFonts(dirs: string[]): boolean {
  const extensions = new Set(['.ttf', '.otf', '.ttc', '.otc', '.pfb', '.pfa']);
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    if (entries.some((entry) => extensions.has(path.extname(entry).toLowerCase()))) {
      return true;
    }
  }
  return false;
}

/** Counts the lines `fc-list` prints; `null` when it cannot run. */
export function countFcListFonts(run: () => string = runFcList): number | null {
  try {
    return run().split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return null;
  }
}

/** Run `fc-list` and return its raw output. */
export function runFcList(): string {
  return execFileSync('fc-list', [], { encoding: 'utf-8', timeout: 5000 });
}

/**
 * Pick the bundled face to use. `appDir` is the real on-disk app directory: in
 * development it is the repository root, and a packaged build copies the public
 * folder into `dist/`.
 */
export function bundledFallbackFont(appDir: string): string | null {
  const candidates = [
    path.join(appDir, 'dist', 'fonts', 'Inter-Regular.ttf'),
    path.join(appDir, 'public', 'fonts', 'Inter-Regular.ttf'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

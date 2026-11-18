// @vitest-environment node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Font file extensions opentype.js can parse directly. */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

/** Collections are parseable by opentype.js only one face at a time; skip them. */
const SKIPPED_EXTENSIONS = new Set(['.ttc', '.otc', '.woff', '.woff2', '.dfont']);

export interface SystemFont {
  /** Family name as the OS reports it ("Arial Black", "Noto Sans", …). */
  family: string;
  /** Normalised style: regular / bold / italic / bold italic. */
  style: FontStyle;
  /** Absolute path to the `.ttf`/`.otf`. */
  file: string;
}

export type FontStyle = 'regular' | 'bold' | 'italic' | 'bold italic';

export interface FontsListResult {
  fonts: SystemFont[];
  /** Why the list is empty, when it is (`fc-list` missing, unreadable dirs…). */
  error?: string;
}

/**
 * Map a Fontconfig/Windows/macOS style string to the four styles the renderer
 * understands. Anything unknown counts as regular, which is what rasterisers
 * do when they cannot match a face.
 */
export function normaliseStyle(raw: string | undefined | null): FontStyle {
  const s = (raw ?? '').toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|extrabold|ultrabold/.test(s);
  const italic = /italic|oblique/.test(s);
  if (bold && italic) return 'bold italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/** Parse one `fc-list` line: `file<TAB>family[,family…]<TAB>style[,style…]`. */
export function parseFcListLine(line: string): SystemFont[] {
  const [file, families, styles] = line.split('\t');
  if (!file || !families) return [];
  const ext = path.extname(file).toLowerCase();
  if (!FONT_EXTENSIONS.has(ext) || SKIPPED_EXTENSIONS.has(ext)) return [];
  const family = families.split(',')[0]?.trim();
  if (!family) return [];
  const style = normaliseStyle(styles?.split(',')[0]);
  return [{ family, style, file }];
}

/** Parse the whole `fc-list --format` output. */
export function parseFcListOutput(stdout: string): SystemFont[] {
  return stdout
    .split('\n')
    .flatMap((line) => parseFcListLine(line));
}

/** De-duplicate on (file, family): `fc-list` repeats faces for some families. */
export function dedupeFonts(fonts: SystemFont[]): SystemFont[] {
  const seen = new Set<string>();
  const out: SystemFont[] = [];
  for (const font of fonts) {
    const key = `${font.file}\0${font.family}\0${font.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(font);
  }
  return out;
}

/**
 * Read a font file only when it is one we listed: the allow-list is the whole
 * point of this module, since the renderer must never be able to ask the main
 * process for an arbitrary path (see TODO.md §Seguridad).
 */
export function isKnownFontPath(file: string, known: Iterable<string>): boolean {
  for (const candidate of known) {
    if (candidate === file) return true;
  }
  return false;
}

/** Runs `fc-list`; injectable so the Linux scan can be tested without fonts. */
export type FcListRunner = () => Promise<{ stdout: string }>;

const defaultFcList: FcListRunner = () =>
  execFileAsync('fc-list', ['--format=%{file}\t%{family}\t%{style}\n']);

async function listLinux(run: FcListRunner = defaultFcList): Promise<SystemFont[]> {
  const { stdout } = await run();
  return dedupeFonts(parseFcListOutput(stdout));
}

/** macOS: users drop fonts in ~/Library/Fonts, the system keeps the rest here. */
function macOSFontDirs(): string[] {
  return [
    path.join(os.homedir(), 'Library', 'Fonts'),
    '/Library/Fonts',
    '/System/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/Network/Library/Fonts',
  ];
}

function windowsFontDirs(): string[] {
  const dirs = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'),
  ];
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  }
  return dirs;
}

/**
 * Directory scan for macOS/Windows, where there is no `fc-list`. The family and
 * style come from the file name (`Arial Black.ttf`, `arialbd.ttf`), which is the
 * only information available without parsing every face.
 */
export function fontsFromDirectoryScan(dirs: string[]): SystemFont[] {
  const fonts: SystemFont[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!FONT_EXTENSIONS.has(ext)) continue;
      const base = path.basename(entry, ext);
      const { family, style } = familyFromFileName(base);
      if (!family) continue;
      fonts.push({ family, style, file: path.join(dir, entry) });
    }
  }
  return dedupeFonts(fonts);
}

/**
 * Best-effort family/style guess from a font file name.
 *
 * Covers the usual patterns: `Arial Black.ttf`, `Noto Sans-BoldItalic.otf`,
 * `arialbd.ttf` (the Windows short names used for the core fonts).
 *
 * Weight-like words only count as a style when the family has something else
 * before them: "Arial Black" is a family, "NotoSans-Bold" is Noto Sans in bold.
 */
export function familyFromFileName(base: string): { family: string; style: FontStyle } {
  const shortNames: Record<string, { family: string; style: FontStyle }> = {
    arial: { family: 'Arial', style: 'regular' },
    arialbd: { family: 'Arial', style: 'bold' },
    ariali: { family: 'Arial', style: 'italic' },
    arialbi: { family: 'Arial', style: 'bold italic' },
    times: { family: 'Times New Roman', style: 'regular' },
    timesbd: { family: 'Times New Roman', style: 'bold' },
    timesi: { family: 'Times New Roman', style: 'italic' },
    timesbi: { family: 'Times New Roman', style: 'bold italic' },
    cour: { family: 'Courier New', style: 'regular' },
    courbd: { family: 'Courier New', style: 'bold' },
    couri: { family: 'Courier New', style: 'italic' },
    courbi: { family: 'Courier New', style: 'bold italic' },
    segoeui: { family: 'Segoe UI', style: 'regular' },
    segoeuib: { family: 'Segoe UI', style: 'bold' },
    segoeuii: { family: 'Segoe UI', style: 'italic' },
    segoeuiz: { family: 'Segoe UI', style: 'bold italic' },
  };
  const short = shortNames[base.toLowerCase()];
  if (short) return short;

  // `Family-Style` (macOS) or `Family Style` (Windows) or camel-case suffixes
  // like `NotoSans-BoldItalic`.
  const suffixes =
    'bold\\s*italic|bolditalic|italic|oblique|bold|regular|black|heavy|light|medium|semibold|extrabold|thin';
  const m = new RegExp(`^(.*?)[-_ ](${suffixes})$`, 'i').exec(base);
  if (m) {
    // "Arial Black" is a family name, not Arial in black weight; "Black" only
    // acts as a style when it does not name a well-known family.
    const isFamilyWeight = /^(black|heavy)$/i.test(m[2]) &&
      FAMILY_WEIGHT_NAMES.has(base.toLowerCase());
    if (isFamilyWeight) return { family: prettifyFamily(base), style: 'regular' };
    return { family: prettifyFamily(m[1]), style: normaliseStyle(m[2]) };
  }
  return { family: prettifyFamily(base), style: 'regular' };
}

/** File names where the trailing weight word belongs to the family. */
const FAMILY_WEIGHT_NAMES = new Set(['arial black', 'arial narrow', 'segoe ui black']);

/** `NotoSans` → `Noto Sans`, `DejaVuSansMono` → `DejaVu Sans Mono`. */
function prettifyFamily(raw: string): string {
  const spaced = raw.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return '';
  // Split camel case, but never inside an acronym like `CJK` or `UI`.
  return spaced
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** List every font the platform exposes, for the renderer's font picker. */
export async function listSystemFonts(
  platform: NodeJS.Platform = process.platform,
  runFcList: FcListRunner = defaultFcList,
): Promise<FontsListResult> {
  try {
    if (platform === 'linux') {
      const fonts = await listLinux(runFcList);
      return { fonts };
    }
    if (platform === 'darwin') {
      return { fonts: fontsFromDirectoryScan(macOSFontDirs()) };
    }
    if (platform === 'win32') {
      return { fonts: fontsFromDirectoryScan(windowsFontDirs()) };
    }
    return { fonts: [], error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { fonts: [], error: (err as Error).message };
  }
}

/** Read one font file, refusing anything that is not in `known`. */
export async function readSystemFont(file: string, known: Iterable<string>): Promise<Buffer> {
  if (!isKnownFontPath(file, known)) {
    throw new Error(`Refusing to read a font outside the system font list: ${file}`);
  }
  return fs.promises.readFile(file);
}

/**
 * The list is computed once per app run (scanning 3k `fc-list` rows is cheap
 * but repeated calls would be wasteful) and is the allow-list `fonts:read`
 * checks against.
 */
let fontsCache: SystemFont[] | null = null;

export function resetFontsCache(): void {
  fontsCache = null;
}

export async function getSystemFonts(
  list: () => Promise<FontsListResult> = () => listSystemFonts(),
): Promise<FontsListResult> {
  if (fontsCache) return { fonts: fontsCache };
  const result = await list();
  if (!result.error) fontsCache = result.fonts;
  return result;
}

/**
 * Register `fonts:list` and `fonts:read`. Kept out of `main.ts` so the logic
 * can be tested without booting Electron. `list` is injectable for tests.
 */
export function registerFontHandlers(
  ipc: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
  },
  list: () => Promise<FontsListResult> = getSystemFonts,
): void {
  ipc.handle('fonts:list', () => list());
  ipc.handle('fonts:read', async (_e, file: unknown) => {
    const { fonts } = await list();
    const buf = await readSystemFont(String(file ?? ''), fonts.map((f) => f.file));
    return buf.toString('base64');
  });
}

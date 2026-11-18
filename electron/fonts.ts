// @vitest-environment node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  extractAllFaces,
  extractFace,
  readNames,
  styleForWeight,
  variationAxes,
  weightAxis,
} from './fontCollection';

const execFileAsync = promisify(execFile);

/** Font file extensions opentype.js can parse directly. */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

/**
 * Formats opentype.js cannot parse at all. Collections (`ttc`/`otc`) are listed
 * too but handled separately: `explodeCollections` splits them into faces.
 */
const SKIPPED_EXTENSIONS = new Set(['.woff', '.woff2', '.dfont']);

/** Collections are split into single faces before they reach the renderer. */
const COLLECTION_EXTENSIONS = new Set(['.ttc', '.otc']);

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
  if ((!FONT_EXTENSIONS.has(ext) && !COLLECTION_EXTENSIONS.has(ext)) || SKIPPED_EXTENSIONS.has(ext)) {
    return [];
  }
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
  // A face is addressed as `path#index`, but any listed face of the same file
  // proves the file itself is allowed: the collection is what gets read.
  const container = collectionFacePath(file)?.file ?? file;
  for (const candidate of known) {
    if ((collectionFacePath(candidate)?.file ?? candidate) === container) return true;
  }
  return false;
}

/**
 * A face inside a collection is addressed as `path#index`. Nothing else in the
 * system uses `#` in a font path, so this stays unambiguous.
 */
export function collectionFacePath(file: string): { file: string; index: number } | null {
  const hash = file.lastIndexOf('#');
  if (hash <= 0) return null;
  const index = Number.parseInt(file.slice(hash + 1), 10);
  if (!Number.isInteger(index) || index < 0 || String(index) !== file.slice(hash + 1)) return null;
  return { file: file.slice(0, hash), index };
}

export interface FontNameReader {
  /** English family name of a single face, or `null` when it cannot be read. */
  family(data: Uint8Array): string | null;
  /** English subfamily ("Regular", "Bold Italic"…), or `null`. */
  subfamily(data: Uint8Array): string | null;
}

/**
 * Split every collection in `fonts` into one entry per face, named
 * `path#index` so `fonts:read` can hand out a single face.
 *
 * Collections pool faces that `fc-list` reports under one family, and recent
 * ones (Noto CJK, most Windows core fonts) are also *variable*: one face with a
 * `wght` range. In that case the face is listed once per style the range
 * covers, otherwise the picker would lose Bold entirely.
 */
export async function expandCollections(
  fonts: SystemFont[],
  readFile: (file: string) => Promise<Uint8Array> = (file) => fs.promises.readFile(file),
  names: FontNameReader | null = opentypeNameReader,
): Promise<SystemFont[]> {
  const out: SystemFont[] = [];
  // `fc-list` prints one line per face, so a collection appears once per face;
  // parse each file once.
  const expandedCollections = new Set<string>();

  for (const font of fonts) {
    const ext = path.extname(font.file).toLowerCase();
    if (!COLLECTION_EXTENSIONS.has(ext)) {
      out.push(font);
      continue;
    }
    if (expandedCollections.has(font.file)) continue;
    expandedCollections.add(font.file);
    // Deduplicate within this collection: several faces can report the same
    // family and style, and the picker only needs one of each.
    const seen = new Set<string>();
    for (const face of await collectionFaces(font.file, readFile)) {
      // `font.family` here is the collection's line for *this* face; the real
      // name below may be another face's, which is why dedupe happens per file.
      const family = names?.family(face.data) ?? font.family;
      const subfamily = names?.subfamily(face.data);
      const axes = variationAxes(face.data);
      const weight = weightAxis(axes);
      // A variable face paints at any weight in its range, so it shows up as
      // Bold too when the axis reaches it; the renderer picks the instance.
      const styles: SystemFont['style'][] = weight
        ? [...new Set([styleForWeight(weight.default), ...(weight.max >= 600 ? (['bold'] as const) : [])])]
        : [subfamily ? normaliseStyle(subfamily) : font.style];

      for (const style of styles) {
        const key = `${family}\u0000${style}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ family, style, file: `${font.file}#${face.index}` });
      }
    }
  }
  return out;
}

/** Runs `fc-list`; injectable so the Linux scan can be tested without fonts. */
export type FcListRunner = () => Promise<{ stdout: string }>;

const defaultFcList: FcListRunner = () =>
  execFileAsync('fc-list', ['--format=%{file}\t%{family}\t%{style}\n']);

async function listLinux(run: FcListRunner = defaultFcList): Promise<SystemFont[]> {
  const { stdout } = await run();
  // Not deduplicated yet: one collection yields many faces and `fc-list`
  // reports one line per face, so collapsing first would lose them.
  return parseFcListOutput(stdout);
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
      if (!FONT_EXTENSIONS.has(ext) && !COLLECTION_EXTENSIONS.has(ext)) continue;
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

/**
 * Read family/subfamily of a single face with opentype.js.
 *
 * `fc-list` reports a collection under one family, so the real names have to
 * come from the face itself; a face that fails to parse keeps the collection's
 * family so it is not lost.
 */
export const opentypeNameReader: FontNameReader = {
  family: (data) => readNames(data).family,
  subfamily: (data) => readNames(data).subfamily,
};

/** Faces of one collection, or `[]` when it cannot be read or parsed. */
async function collectionFaces(
  file: string,
  readFile: (file: string) => Promise<Uint8Array>,
): Promise<ReturnType<typeof extractAllFaces>> {
  try {
    return extractAllFaces(await readFile(file));
  } catch {
    return [];
  }
}

/** List every font the platform exposes, for the renderer's font picker. */
export async function listSystemFonts(
  platform: NodeJS.Platform = process.platform,
  runFcList: FcListRunner = defaultFcList,
): Promise<FontsListResult> {
  try {
    if (platform === 'linux') {
      const expanded = await expandCollections(await listLinux(runFcList), undefined, opentypeNameReader);
      return { fonts: dedupeFonts(expanded) };
    }
    if (platform === 'darwin') {
      return {
        fonts: dedupeFonts(
          await expandCollections(fontsFromDirectoryScan(macOSFontDirs()), undefined, opentypeNameReader),
        ),
      };
    }
    if (platform === 'win32') {
      return {
        fonts: dedupeFonts(
          await expandCollections(fontsFromDirectoryScan(windowsFontDirs()), undefined, opentypeNameReader),
        ),
      };
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
  const face = collectionFacePath(file);
  if (face) {
    const bytes = await fs.promises.readFile(face.file);
    const extracted = extractFace(bytes, face.index);
    if (!extracted) throw new Error(`Collection face ${file} could not be extracted`);
    return Buffer.from(extracted);
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

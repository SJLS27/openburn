import opentype from 'opentype.js';
import type { Textbox } from 'fabric';
import { loadBinaryAsset } from '@/core/fileApi';
import {
  BUNDLED_FAMILY,
  buildFontLibrary,
  loadBundledFont,
  parseFont,
  resolveFace,
  type FontLibrary,
  type FontStyle,
} from './fontLibrary';

/** Fraction of the em box that sits above the baseline in opentype paths. */
const FONT_SIZE_FRACTION = 0.222;

/** Map a Fabric weight/style pair to one of the four styles we handle. */
function faceStyle(weight: string | number | undefined, style: string | undefined): FontStyle {
  const numeric = Number.parseInt(String(weight ?? '400'), 10);
  const bold = String(weight) === 'bold' || (Number.isFinite(numeric) && numeric >= 600);
  const italic = String(style ?? 'normal') === 'italic';
  if (bold && italic) return 'bold italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/** Where the outline font actually came from, for the caller's warning. */
export interface ResolvedFontInfo {
  /** Family typed in the document ("Arial Black"). */
  requested: string;
  /** Family actually used to build the outlines. */
  used: string;
  /** File the used face was loaded from. */
  file: string;
  /** True when the requested family is not installed and Inter stood in. */
  substituted: boolean;
}

export interface TextOutline {
  pathData: string;
  fontFile: string;
  font: ResolvedFontInfo;
}

let library: FontLibrary | null = null;
let libraryLoading: Promise<FontLibrary> | null = null;

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Load the system font index once per session. Without Electron (browser dev,
 * tests) the list is empty and every text falls back to the bundled Inter.
 */
async function getLibrary(): Promise<FontLibrary> {
  if (library) return library;
  if (!libraryLoading) {
    libraryLoading = (async () => {
      const api = typeof window !== 'undefined' ? window.openburn?.fonts : undefined;
      if (!api) return buildFontLibrary([]);
      try {
        const { fonts } = await api.list();
        return buildFontLibrary(fonts ?? []);
      } catch {
        return buildFontLibrary([]);
      }
    })().then((lib) => {
      library = lib;
      return lib;
    });
  }
  return libraryLoading;
}

/** Forget the indexed fonts (after installing a typeface, in tests…). */
export function resetFontLibrary(): void {
  library = null;
  libraryLoading = null;
}

/** The index if it is already loaded, without waiting for IPC. */
export function getPrimedFontLibrary(): FontLibrary | null {
  return library;
}

/** Load the font index ahead of time so sync lookups (import) can use it. */
export async function primeFontLibrary(): Promise<void> {
  await getLibrary();
}

/** Load a system face through the allow-listed IPC, cached by file path. */
async function loadSystemFont(file: string): Promise<opentype.Font> {
  const api = window.openburn?.fonts;
  if (!api) throw new Error('system fonts are only available in the desktop app');
  const base64 = await api.read(file);
  return parseFont(`system:${file}`, base64ToBuffer(base64));
}

async function loadInter(style: FontStyle): Promise<opentype.Font> {
  return loadBundledFont(style, loadBinaryAsset);
}

function isInter(family: string): boolean {
  return new RegExp(`\\b${BUNDLED_FAMILY}\\b`, 'i').test(family);
}

function commandsToPathData(commands: opentype.PathCommand[], matrix: number[]): string {
  const [a, b, c, d, e, f] = matrix;
  const pt = (x: number, y: number) =>
    `${(a * x + c * y + e).toFixed(4)} ${(b * x + d * y + f).toFixed(4)}`;

  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        parts.push(`M${pt(cmd.x, cmd.y)}`);
        break;
      case 'L':
        parts.push(`L${pt(cmd.x, cmd.y)}`);
        break;
      case 'C':
        parts.push(`C${pt(cmd.x1, cmd.y1)} ${pt(cmd.x2, cmd.y2)} ${pt(cmd.x, cmd.y)}`);
        break;
      case 'Q':
        parts.push(`Q${pt(cmd.x1, cmd.y1)} ${pt(cmd.x, cmd.y)}`);
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}

/**
 * Convert a Fabric Text/Textbox into scene-space path data.
 *
 * The family in the document wins when it is installed on the machine; anything
 * else falls back to the bundled Inter, which keeps exports deterministic when
 * a file moves to another computer.
 */
export async function textToScenePath(text: Textbox): Promise<TextOutline | null> {
  const style = faceStyle(text.fontWeight, text.fontStyle);
  const requested = String(text.fontFamily ?? BUNDLED_FAMILY);
  const lib = await getLibrary();
  const face = resolveFace(lib, requested, text.fontWeight, text.fontStyle);

  let font: opentype.Font | null = null;
  let info: ResolvedFontInfo | null = null;

  if (face) {
    try {
      font = await loadSystemFont(face.file);
      info = { requested, used: face.family, file: face.file, substituted: false };
    } catch {
      // Face indexed but unreadable: treat it as missing.
      font = null;
      info = null;
    }
  }
  if (!font || !info) {
    font = await loadInter(style);
    info = {
      requested,
      used: BUNDLED_FAMILY,
      file: `fonts/${BUNDLED_FAMILY}-${style}.ttf`,
      substituted: !isInter(requested),
    };
  }
  return textToScenePathWithFont(text, font, info);
}

/** Pure outline generation, split out so the font choice can be tested. */
export function textToScenePathWithFont(
  text: Textbox,
  font: opentype.Font,
  info: ResolvedFontInfo,
): TextOutline | null {
  const lines = text.textLines ?? [];
  if (lines.length === 0) return null;

  const matrix = text.calcTransformMatrix() as unknown as number[];
  const boxWidth = text.width;
  const boxHeight = text.height;
  const fontSize = text.fontSize;
  const charSpacing = text.charSpacing ?? 0;
  const align = String(text.textAlign ?? 'left');
  const lineHeightFactor = (text as Textbox & { lineHeight?: number }).lineHeight ?? 1.16;

  const parts: string[] = [];
  let cumulative = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const implHeight =
      (text as unknown as { getHeightOfLineImpl: (i: number) => number }).getHeightOfLineImpl(i) ||
      fontSize * 1.13;
    const lineHeight = text.getHeightOfLine(i) || implHeight * lineHeightFactor;
    const baseline = -boxHeight / 2 + cumulative + implHeight * (1 - FONT_SIZE_FRACTION);

    const lineWidth = text.getLineWidth(i) || 0;
    let x = -boxWidth / 2;
    if (align.includes('center')) x += (boxWidth - lineWidth) / 2;
    else if (align.includes('right')) x += boxWidth - lineWidth;

    if (line.trim().length > 0) {
      const path = font.getPath(line, x, baseline, fontSize, {
        kerning: true,
        letterSpacing: charSpacing / 1000,
      });
      const data = commandsToPathData(path.commands, matrix);
      if (data) parts.push(data);
    }

    cumulative += lineHeight;
  }

  if (parts.length === 0) return null;
  return { pathData: parts.join(' '), fontFile: info.file, font: info };
}

import opentype from 'opentype.js';

export type FontStyle = 'regular' | 'bold' | 'italic' | 'bold italic';

export interface FontFace {
  family: string;
  style: FontStyle;
  file: string;
}

/** Faces available in the app, keyed by family (lower-cased). */
export type FontLibrary = Map<string, Map<FontStyle, FontFace>>;

const STYLE_FALLBACK: Record<FontStyle, FontStyle[]> = {
  regular: ['regular'],
  bold: ['bold', 'regular'],
  italic: ['italic', 'regular'],
  'bold italic': ['bold italic', 'bold', 'italic', 'regular'],
};

/**
 * Index a flat face list by lower-cased family, keeping one file per style.
 * The first face wins, so `fc-list` order decides ties deterministically.
 */
export function buildFontLibrary(faces: FontFace[]): FontLibrary {
  const library: FontLibrary = new Map();
  for (const face of faces) {
    const key = face.family.trim().toLowerCase();
    if (!key) continue;
    let styles = library.get(key);
    if (!styles) {
      styles = new Map();
      library.set(key, styles);
    }
    if (!styles.has(face.style)) styles.set(face.style, face);
  }
  return library;
}

/**
 * Resolve a Fabric `fontFamily` stack (`"Arial Black, sans-serif"`) and weight
 * to a concrete face, falling back through the style chain and returning
 * `null` when the family is not installed.
 */
export function resolveFace(
  library: FontLibrary,
  fontFamily: string | undefined,
  weight: string | number | undefined,
  style: string | undefined,
): FontFace | null {
  const numeric = Number.parseInt(String(weight ?? '400'), 10);
  const bold = String(weight) === 'bold' || (Number.isFinite(numeric) && numeric >= 600);
  const italic = String(style ?? 'normal') === 'italic';
  const wanted: FontStyle = bold && italic ? 'bold italic' : bold ? 'bold' : italic ? 'italic' : 'regular';

  const candidates = String(fontFamily ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);

  for (const family of candidates) {
    const styles = library.get(family);
    if (!styles) continue;
    for (const styleKey of STYLE_FALLBACK[wanted]) {
      const face = styles.get(styleKey);
      if (face) return face;
    }
  }
  return null;
}

/**
 * Whether a family (any style) is present in the indexed library.
 * Exported for the import heuristic and tests.
 */
export function hasFamily(library: FontLibrary, family: string): boolean {
  for (const candidate of String(family ?? '').split(',')) {
    const key = candidate.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    if (key && library.has(key)) return true;
  }
  return false;
}

/** Fonts bundled with the app; used whenever the system has no match. */
export const BUNDLED_FAMILY = 'Inter';

const STYLE_FILE: Record<FontStyle, string> = {
  regular: 'Inter-Regular.ttf',
  bold: 'Inter-Bold.ttf',
  italic: 'Inter-Italic.ttf',
  'bold italic': 'Inter-BoldItalic.ttf',
};

const parsed = new Map<string, opentype.Font>();

/** Parse a font from an ArrayBuffer, caching by file key. */
export function parseFont(key: string, buffer: ArrayBuffer | Uint8Array): opentype.Font {
  const cached = parsed.get(key);
  if (cached) return cached;
  const font = opentype.parse(
    buffer instanceof Uint8Array ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer,
  );
  parsed.set(key, font);
  return font;
}

export function clearFontCache(): void {
  parsed.clear();
}

/**
 * Load the bundled Inter face for a style. Kept separate so the renderer can
 * fall back without knowing where the assets live.
 */
export async function loadBundledFont(
  style: FontStyle,
  read: (relativePath: string) => Promise<ArrayBuffer>,
): Promise<opentype.Font> {
  const file = STYLE_FILE[style];
  return parseFont(`bundled:${file}`, await read(`fonts/${file}`));
}

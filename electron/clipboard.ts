/**
 * System clipboard reader for the main process.
 *
 * Inkscape (and other vector editors) place several representations on the
 * clipboard at once: a raster snapshot (`image/png`), HTML, plain text and the
 * actual vector document as SVG. The SVG is what we want to paste as editable
 * paths — the raster snapshot is only a fallback.
 *
 * Electron 45 rearchitected the clipboard around the W3C API, and non-standard
 * formats can surface under several different names depending on the platform:
 *
 *  - `image/svg+xml`                                   (plain MIME)
 *  - `image/x-inkscape-compressed-svg`                 (plain MIME, gzip)
 *  - `web image/x-inkscape-compressed-svg`             (W3C web custom format)
 *  - `electron application/osclipboard;format="..."`   (raw OS format)
 *  - `public.svg-image` / `image/x-inkscape-svg` / `SVG Image` (macOS/Windows)
 *
 * Rather than guessing the name, we sniff the *content* of every non-raster
 * payload: if it decodes to an SVG document it wins over the raster snapshot.
 * That makes the paste path work across Linux, macOS and Windows.
 *
 * Compression and text encodings differ per platform:
 *  - Linux/X11: gzip-compressed UTF-8 SVG
 *  - macOS: sometimes plain UTF-8 behind a SVG UTI
 *  - Windows: often UTF-16LE clipboard text
 *
 * This module has no Electron import so it can be unit-tested in isolation.
 */
import zlib from 'node:zlib';

export interface ClipboardPayload {
  text: string;
  html: string;
  image: string | null;
  svg: string | null;
}

/** Minimal shape of `Electron.ClipboardItem` that we depend on. */
export interface ClipboardItemLike {
  types: string[];
  getType(type: string): Promise<unknown>;
}

/** Minimal shape of the async `Electron.clipboard` API (Electron 45+). */
export interface ClipboardLike {
  readText(): Promise<string>;
  read(): Promise<ClipboardItemLike[]>;
}

const SVG_ROOT = /<svg[\s>]/i;
/** Only a prolog (XML declaration, DOCTYPE, comments, whitespace) may precede `<svg>`. */
const PROLOG_ONLY = /^(?:\s*(?:<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->))*\s*$/i;
const BASE64_DATA_URI = /^data:image\/svg\+xml(?:;[^,]*)?;base64,([\s\S]*)$/i;
const TEXT_DATA_URI = /^data:image\/svg\+xml(?:;[^,]*)?,([\s\S]*)$/i;

const OS_FORMAT_PREFIX = 'electron application/osclipboard;format=';
const WEB_FORMAT_PREFIX = 'web ';
const RASTER_MIME = /^image\/(?:png|jpe?g|gif|bmp|webp|avif|tiff?)$/i;

/** Strip the Electron wrapper around a non-standard format name. */
export function formatName(type: string): string {
  const lower = type.toLowerCase();
  if (lower.startsWith(OS_FORMAT_PREFIX)) {
    return type
      .slice(OS_FORMAT_PREFIX.length)
      .replace(/^"|"$/g, '')
      .trim();
  }
  if (lower.startsWith(WEB_FORMAT_PREFIX)) {
    return type.slice(WEB_FORMAT_PREFIX.length).trim();
  }
  return type;
}

/** True when a clipboard type name suggests it carries SVG. */
export function isSvgType(type: string): boolean {
  return /svg/i.test(formatName(type));
}

/** True when a clipboard type name is a raster image (never the vector payload). */
export function isRasterType(type: string): boolean {
  return RASTER_MIME.test(formatName(type));
}

/** True for payloads that may contain markup but are not themselves an SVG. */
function isHtmlLikeType(type: string): boolean {
  return /html/i.test(formatName(type));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Return the SVG document when `text` is an SVG root (optionally preceded by an
 * XML declaration, DOCTYPE or comments), otherwise `null`. Rejects HTML that
 * merely embeds an `<svg>` somewhere in the middle.
 */
function svgFromText(text: string): string | null {
  const trimmed = stripBom(text).trim();
  const dataUri = BASE64_DATA_URI.exec(trimmed);
  if (dataUri) {
    try {
      const decoded = Buffer.from(dataUri[1], 'base64').toString('utf-8');
      return svgFromText(decoded);
    } catch {
      return null;
    }
  }
  const textUri = TEXT_DATA_URI.exec(trimmed);
  if (textUri) {
    try {
      const decoded = decodeURIComponent(textUri[1]);
      return svgFromText(decoded);
    } catch {
      return null;
    }
  }

  const match = SVG_ROOT.exec(trimmed);
  if (!match) return null;
  const prefix = trimmed.slice(0, match.index);
  if (!PROLOG_ONLY.test(prefix)) return null;
  return trimmed;
}

/**
 * Decode a clipboard buffer into SVG text, tolerating the encodings and
 * compression schemes used by Inkscape across platforms.
 */
export function decodeSvgBuffer(buffer: Buffer): string | null {
  // Plain text first: UTF-8 (Linux/macOS) and UTF-16LE (Windows clipboard).
  for (const encoding of ['utf-8', 'utf16le'] as const) {
    const svg = svgFromText(buffer.toString(encoding));
    if (svg) return svg;
  }

  // Then the compressed variants: gzip, zlib and raw deflate.
  const attempts = [
    () => zlib.gunzipSync(buffer),
    () => zlib.inflateSync(buffer),
    () => zlib.inflateRawSync(buffer),
  ];
  for (const attempt of attempts) {
    try {
      const svg = svgFromText(attempt().toString('utf-8'));
      if (svg) return svg;
    } catch {
      /* try the next compression variant */
    }
  }
  return null;
}

/**
 * Normalise whatever `ClipboardItem.getType()` resolves to into raw bytes.
 * Electron documents a `Blob`, but accepting the other shapes keeps the read
 * path working if a platform hands over a Buffer/ArrayBuffer/typed array.
 */
export async function payloadBytes(value: unknown): Promise<Buffer | null> {
  if (value == null) return null;
  if (typeof value === 'string') return Buffer.from(value, 'utf-8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  // Duck-typed blob (e.g. from another realm) — but not a ClipboardBookmark.
  const candidate = value as { arrayBuffer?: unknown };
  if (typeof candidate.arrayBuffer === 'function') {
    return Buffer.from(await (candidate.arrayBuffer as () => Promise<ArrayBuffer>)());
  }
  return null;
}

async function bytesOf(item: ClipboardItemLike, type: string): Promise<Buffer | null> {
  try {
    return await payloadBytes(await item.getType(type));
  } catch {
    return null;
  }
}

function toDataUrl(type: string, bytes: Buffer): string {
  const mime = formatName(type).toLowerCase() || 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * Read the system clipboard, preferring the SVG vector payload over the raster
 * snapshot. Detection is content-based, so it does not depend on how Electron
 * happens to name Inkscape's format on a given platform. Never throws.
 */
export async function readClipboardPayload(
  clipboard: ClipboardLike,
): Promise<ClipboardPayload> {
  let text = '';
  try {
    text = await clipboard.readText();
  } catch {
    /* clipboard unavailable */
  }

  let html = '';
  let image: string | null = null;
  let svg: string | null = null;

  try {
    const items = await clipboard.read();
    if (process.env.OPENBURN_DEBUG_CLIPBOARD === '1') {
      console.info('[OpenBurn] clipboard types:', items.map((item) => item.types));
    }

    for (const item of items) {
      if (!html && item.types.includes('text/html')) {
        const bytes = await bytesOf(item, 'text/html');
        if (bytes) html = bytes.toString('utf-8');
      }

      for (const type of item.types) {
        if (isRasterType(type)) {
          if (image) continue;
          const bytes = await bytesOf(item, type);
          if (bytes) image = toDataUrl(type, bytes);
          continue;
        }

        // HTML may embed an <svg>; it is handled by the renderer, not here.
        if (isHtmlLikeType(type)) continue;

        // Keep the first SVG found; no need to decode further payloads.
        if (svg) continue;

        const bytes = await bytesOf(item, type);
        if (!bytes) continue;

        // Known SVG formats accept the payload as-is; anything else is sniffed
        // by content, which is what makes the unknown Electron wrappers work.
        const decoded = decodeSvgBuffer(bytes);
        if (decoded) svg = decoded;
      }
    }
  } catch {
    /* clipboard format not readable on this platform */
  }

  // Last resort: the plain-text representation may itself be the SVG source.
  if (!svg && text) {
    const decoded = decodeSvgBuffer(Buffer.from(text, 'utf-8'));
    if (decoded) svg = decoded;
  }

  return { text, html, image, svg };
}

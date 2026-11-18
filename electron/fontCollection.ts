/**
 * OpenType collections (`.ttc` / `.otc`).
 *
 * `opentype.js` rejects the `ttcf` signature, so a collection has to be split
 * into single-face `sfnt` buffers before it can be parsed. On Windows and macOS
 * most core families (Arial, Times New Roman, MS Gothic…) live in collections,
 * which is why they were missing from the font picker.
 *
 * A collection stores N sfnt headers (one per face) whose table records point
 * into one shared table pool. Extracting a face means copying its directory and
 * the tables it references into a fresh, self-consistent font.
 *
 * Kept free of DOM and Electron so it can be unit tested with real files.
 */

export interface CollectionFace {
  /** Zero-based index of the face inside the collection. */
  index: number;
  /** Standalone sfnt buffer for this face. */
  data: Uint8Array;
}

const TTCF = 0x74746366; // 'ttcf'
const SFNT_VERSIONS = new Set([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO', CFF outlines
]);

const TAG_TTCF = 'ttcf';

/** `true` when the buffer starts with the collection signature. */
export function isCollection(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  return tagAt(data, 0) === TAG_TTCF;
}

function tagAt(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function u32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

/** Number of faces in the collection, or 0 when the header is malformed. */
export function collectionFaceCount(data: Uint8Array): number {
  if (!isCollection(data)) return 0;
  if (u32(data, 0) !== TTCF) return 0;
  const count = u32(data, 8);
  // A sane collection never has more faces than the header can index.
  if (count === 0 || count > 4096) return 0;
  if (12 + count * 4 > data.length) return 0;
  return count;
}

interface TableRecord {
  tag: string;
  /** Offset inside the source file. */
  offset: number;
  length: number;
}

function tableRecords(data: Uint8Array, sfntOffset: number): TableRecord[] | null {
  if (sfntOffset + 12 > data.length) return null;
  const numTables = u16(data, sfntOffset + 4);
  if (numTables === 0 || numTables > 512) return null;
  const end = sfntOffset + 12 + numTables * 16;
  if (end > data.length) return null;
  const records: TableRecord[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = sfntOffset + 12 + i * 16;
    records.push({
      tag: tagAt(data, rec),
      offset: u32(data, rec + 8),
      length: u32(data, rec + 12),
    });
  }
  return records;
}

/** Power-of-two search values required by the sfnt header. */
function searchRange(numTables: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  let selector = 1;
  while (selector * 2 <= numTables) selector *= 2;
  return {
    searchRange: selector * 16,
    entrySelector: Math.log2(selector),
    rangeShift: numTables * 16 - selector * 16,
  };
}

/**
 * Extract one face as a standalone `sfnt` buffer.
 *
 * Returns `null` when the collection, the face index or any table is out of
 * bounds: a truncated or hostile file must not produce a half-parsed font.
 */
export function extractFace(data: Uint8Array, index: number): Uint8Array | null {
  const count = collectionFaceCount(data);
  if (index < 0 || index >= count) return null;

  const sfntOffset = u32(data, 12 + index * 4);
  if (sfntOffset + 4 > data.length) return null;
  const version = u32(data, sfntOffset);
  if (!SFNT_VERSIONS.has(version)) return null;

  const records = tableRecords(data, sfntOffset);
  if (!records || records.length === 0) return null;

  // Table offsets in a TTC are absolute to the file, so a face extracted as a
  // slice would point at the wrong place. Rebuild the sfnt: header, directory,
  // then each table copied in order with rewritten offsets.
  const headerSize = 12 + records.length * 16;
  let cursor = headerSize;
  const placed: { record: TableRecord; offset: number }[] = [];
  for (const record of records) {
    if (record.offset + record.length > data.length) return null;
    const padding = (4 - (record.length % 4)) % 4;
    placed.push({ record, offset: cursor });
    cursor += record.length + padding;
  }

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, version);
  view.setUint16(4, records.length);
  const range = searchRange(records.length);
  view.setUint16(6, range.searchRange);
  view.setUint16(8, range.entrySelector);
  view.setUint16(10, range.rangeShift);

  placed.forEach(({ record, offset }, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k += 1) out[rec + k] = record.tag.charCodeAt(k);
    // The checksum is not used by opentype.js; leaving it at 0 keeps the copy
    // cheap and is allowed by the spec for checked-by-nobody fonts.
    view.setUint32(rec + 4, 0);
    view.setUint32(rec + 8, offset);
    view.setUint32(rec + 12, record.length);
    out.set(data.subarray(record.offset, record.offset + record.length), offset);
  });

  return out;
}

/** Extract every face that can be parsed; malformed faces are skipped. */
export function extractAllFaces(data: Uint8Array): CollectionFace[] {
  const count = collectionFaceCount(data);
  const faces: CollectionFace[] = [];
  for (let index = 0; index < count; index += 1) {
    const face = extractFace(data, index);
    if (face) faces.push({ index, data: face });
  }
  return faces;
}

// ---------------------------------------------------------------------------
// Variable fonts
// ---------------------------------------------------------------------------

export interface VariationAxis {
  /** Four-character axis tag, e.g. `wght`. */
  tag: string;
  min: number;
  default: number;
  max: number;
}

/**
 * `fvar` axes of a font, or `[]` when it is static.
 *
 * A variable font reports one family in the font table but paints at any weight
 * in its range; the renderer needs the range to pick the instance that matches
 * the requested style instead of the default.
 */
export function variationAxes(data: Uint8Array, sfntOffset = 0): VariationAxis[] {
  const records = tableRecords(data, sfntOffset);
  if (!records) return [];
  const fvar = records.find((r) => r.tag === 'fvar');
  if (!fvar || fvar.length < 16 || fvar.offset + fvar.length > data.length) return [];

  const base = fvar.offset;
  const axesArrayOffset = u16(data, base + 4);
  const axisCount = u16(data, base + 8);
  const axisSize = u16(data, base + 10);
  if (axisCount === 0 || axisCount > 64 || axisSize < 20) return [];

  const axes: VariationAxis[] = [];
  for (let i = 0; i < axisCount; i += 1) {
    const at = base + axesArrayOffset + i * axisSize;
    if (at + 20 > data.length) break;
    const axis: VariationAxis = {
      tag: tagAt(data, at),
      min: fixed16_16(data, at + 4),
      default: fixed16_16(data, at + 8),
      max: fixed16_16(data, at + 12),
    };
    if (axis.max > axis.min) axes.push(axis);
  }
  return axes;
}

/** Signed 16.16 fixed-point value. */
function fixed16_16(data: Uint8Array, offset: number): number {
  const raw = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) | 0;
  return raw / 65536;
}

/**
 * Style of a variable face from its weight axis, so `Inter[wght]` shows up as a
 * regular face instead of being dropped for "having no style".
 */
export function styleForWeight(weight: number): 'regular' | 'bold' {
  return weight >= 600 ? 'bold' : 'regular';
}

/** Weight axis of a variable font, or `null` for a static one. */
export function weightAxis(axes: readonly VariationAxis[]): VariationAxis | null {
  return axes.find((axis) => axis.tag === 'wght') ?? null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAME_FAMILY = 1;
const NAME_SUBFAMILY = 2;

/** Decode a `name` table string (platform 0/3 are UTF-16BE, 1 is Latin-1). */
function decodeNameString(data: Uint8Array, offset: number, length: number, platformId: number): string {
  if (offset + length > data.length) return '';
  let out = '';
  if (platformId === 0 || platformId === 3) {
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode((data[offset + i] << 8) | data[offset + i + 1]);
  } else {
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(data[offset + i]);
  }
  return out.replace(/\u0000/g, '').trim();
}

/**
 * Read the `name` table without parsing outlines: CFF2 variable collections
 * (Noto CJK, many Windows fonts) list their faces correctly but opentype.js
 * refuses to parse them, so their names would otherwise be lost.
 *
 * Prefers English (language 0x0409) names, then platform 3, then anything.
 */
export function readNames(data: Uint8Array): { family: string | null; subfamily: string | null } {
  const records = tableRecords(data, 0);
  const name = records?.find((r) => r.tag === 'name');
  if (!name || name.length < 6 || name.offset + name.length > data.length) {
    return { family: null, subfamily: null };
  }

  const base = name.offset;
  const count = u16(data, base + 2);
  const stringOffset = u16(data, base + 4);
  if (count === 0 || count > 512) return { family: null, subfamily: null };

  const best = new Map<number, { score: number; value: string }>();
  for (let i = 0; i < count; i += 1) {
    const rec = base + 6 + i * 12;
    if (rec + 12 > base + name.length) break;
    const platformId = u16(data, rec);
    const nameId = u16(data, rec + 6);
    if (nameId !== NAME_FAMILY && nameId !== NAME_SUBFAMILY) continue;
    const length = u16(data, rec + 8);
    const offset = base + stringOffset + u16(data, rec + 10);
    const value = decodeNameString(data, offset, length, platformId);
    if (!value) continue;
    const language = u16(data, rec + 4);
    // English (0x0409) on Windows/macOS, then any UTF-16 (platform 0).
    const score = language === 0x0409 ? 3 : platformId === 0 ? 2 : platformId === 3 ? 1 : 0;
    const current = best.get(nameId);
    if (!current || score > current.score) best.set(nameId, { score, value });
  }

  return {
    family: best.get(NAME_FAMILY)?.value ?? null,
    subfamily: best.get(NAME_SUBFAMILY)?.value ?? null,
  };
}

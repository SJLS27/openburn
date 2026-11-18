// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import opentype from 'opentype.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectionFaceCount,
  extractAllFaces,
  extractFace,
  isCollection,
  readNames,
  styleForWeight,
  variationAxes,
  weightAxis,
  type CollectionFace,
} from './fontCollection';
import { collectionFacePath, expandCollections, isKnownFontPath, readSystemFont } from './fonts';

/**
 * Fixtures are real fonts written by opentype.js and then packed into a
 * collection by `packCollection`. Building the container by hand was
 * error-prone; writing actual sfnts means the splitter is exercised against
 * data another implementation produced.
 */

/** A tiny font with one "A" glyph, enough to be a valid sfnt. */
function makeSfnt(family: string, subfamily: string): Uint8Array {
  const notdef = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 500,
    path: new opentype.Path(),
  });
  const glyph = new opentype.Glyph({
    name: 'A',
    unicode: 65,
    advanceWidth: 600,
    path: new opentype.Path(),
  });
  glyph.path.moveTo(0, 0);
  glyph.path.lineTo(300, 700);
  glyph.path.lineTo(600, 0);
  glyph.path.close();

  const font = new opentype.Font({
    familyName: family,
    styleName: subfamily,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, glyph],
  });
  return new Uint8Array(font.toArrayBuffer());
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function tableDirectory(sfnt: Uint8Array): { tag: string; offset: number; length: number }[] {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = dv.getUint16(4);
  const out = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(sfnt[rec], sfnt[rec + 1], sfnt[rec + 2], sfnt[rec + 3]);
    out.push({ tag, offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) });
  }
  return out;
}

/** Rewrite the table offsets of an sfnt by `delta` (on a copy). */
function shiftOffsets(sfnt: Uint8Array, delta: number): Uint8Array {
  const copy = new Uint8Array(sfnt);
  const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const numTables = dv.getUint16(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    dv.setUint32(rec + 8, dv.getUint32(rec + 8) + delta);
  }
  return copy;
}

/**
 * Pack standalone fonts into a `.ttc`: the collection header, then each font's
 * header/directory, then its tables at absolute offsets.
 */
function packCollection(fonts: Uint8Array[]): Uint8Array {
  const headerSize = 12 + fonts.length * 4;
  let cursor = headerSize;
  const sfntOffsets: number[] = [];
  for (const font of fonts) {
    sfntOffsets.push(cursor);
    cursor += font.byteLength;
  }

  const bytes: number[] = [
    ...Array.from('ttcf', (ch) => ch.charCodeAt(0)),
    ...u32(0x00010000),
    ...u32(fonts.length),
    ...sfntOffsets.flatMap((off) => u32(off)),
  ];
  for (let i = 0; i < fonts.length; i += 1) {
    // `opentype.js` writes table offsets relative to the start of its own
    // buffer; in a collection they must be absolute to the file.
    const shifted = shiftOffsets(fonts[i], sfntOffsets[i]);
    for (const b of shifted) bytes.push(b);
  }
  return Uint8Array.from(bytes);
}

function packedFonts(entries: [string, string][]): Uint8Array {
  return packCollection(entries.map(([family, subfamily]) => makeSfnt(family, subfamily)));
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-collection-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('fontCollection', () => {
  it('recognises the collection signature', () => {
    expect(isCollection(packedFonts([['Arial', 'Regular']]))).toBe(true);
    expect(isCollection(makeSfnt('Arial', 'Regular'))).toBe(false);
    expect(isCollection(new Uint8Array(4))).toBe(false);
  });

  it('counts the faces of a collection', () => {
    const data = packedFonts([
      ['Arial', 'Regular'],
      ['Arial', 'Bold'],
      ['Times New Roman', 'Regular'],
    ]);
    expect(collectionFaceCount(data)).toBe(3);
  });

  it('extracts every face as a standalone font', () => {
    const data = packedFonts([
      ['Arial', 'Regular'],
      ['Arial', 'Bold'],
      ['Times New Roman', 'Regular'],
    ]);
    const faces = extractAllFaces(data);
    expect(faces.map((f) => f.index)).toEqual([0, 1, 2]);

    // Each face parses on its own, which is what the renderer does.
    const parsed = faces.map((face: CollectionFace) => opentype.parse(
      face.data.buffer.slice(face.data.byteOffset, face.data.byteOffset + face.data.byteLength) as ArrayBuffer,
    ));
    expect(parsed.map((f) => f.names.fontFamily?.en)).toEqual([
      'Arial',
      'Arial',
      'Times New Roman',
    ]);
    expect(parsed.map((f) => f.names.fontSubfamily?.en)).toEqual(['Regular', 'Bold', 'Regular']);
  });

  it('keeps the table data of each face intact', () => {
    const data = packedFonts([
      ['Arial', 'Regular'],
      ['Arial', 'Bold'],
    ]);
    const second = extractFace(data, 1);
    expect(second).not.toBeNull();
    const parsed = opentype.parse(
      second!.buffer.slice(second!.byteOffset, second!.byteOffset + second!.byteLength) as ArrayBuffer,
    );
    // `names.fontSubfamily` is what the picker reads; `styleName` is not set by
    // every writer.
    expect(parsed.names.fontSubfamily?.en).toBe('Bold');
    expect(parsed.glyphs.length).toBe(2);
  });

  it('refuses out-of-range faces and truncated files', () => {
    const data = packedFonts([['Arial', 'Regular']]);
    expect(extractFace(data, 5)).toBeNull();
    expect(extractFace(data, -1)).toBeNull();
    expect(extractFace(data.subarray(0, 40), 0)).toBeNull();
    expect(collectionFaceCount(data.subarray(0, 10))).toBe(0);
  });

  it('reports no faces for something that is not a collection', () => {
    expect(collectionFaceCount(makeSfnt('Arial', 'Regular'))).toBe(0);
  });

  it('reads the name table without parsing outlines', () => {
    const data = packedFonts([
      ['MS Gothic', 'Regular'],
      ['MS PGothic', 'Bold'],
    ]);
    expect(extractAllFaces(data).map((f) => readNames(f.data))).toEqual([
      { family: 'MS Gothic', subfamily: 'Regular' },
      { family: 'MS PGothic', subfamily: 'Bold' },
    ]);
  });

  it('returns null names for a font without a name table', () => {
    expect(readNames(new Uint8Array(40))).toEqual({ family: null, subfamily: null });
  });

  describe('variable fonts', () => {
    it('returns no axes for a static face', () => {
      const [face] = extractAllFaces(packedFonts([['Arial', 'Regular']]));
      expect(variationAxes(face.data)).toEqual([]);
      expect(weightAxis([])).toBeNull();
    });

    it('maps weights onto styles', () => {
      expect(styleForWeight(400)).toBe('regular');
      expect(styleForWeight(700)).toBe('bold');
    });
  });
});

describe('expandCollections', () => {
  it('splits a collection into one entry per face', async () => {
    const data = packedFonts([
      ['Arial', 'Regular'],
      ['Arial', 'Bold'],
    ]);
    const fonts = await expandCollections(
      [{ family: 'Arial', style: 'regular', file: '/fonts/arial.ttc' }],
      async () => data,
    );
    expect(fonts).toEqual([
      { family: 'Arial', style: 'regular', file: '/fonts/arial.ttc#0' },
      { family: 'Arial', style: 'bold', file: '/fonts/arial.ttc#1' },
    ]);
  });

  it('uses the real family of each face, not the collection label', async () => {
    const data = packedFonts([
      ['Noto Sans CJK JP', 'Regular'],
      ['Noto Sans CJK SC', 'Regular'],
    ]);
    const fonts = await expandCollections(
      // fc-list reports the collection under the first face's family only.
      [{ family: 'Noto Sans CJK JP', style: 'regular', file: '/fonts/Noto.ttc' }],
      async () => data,
    );
    expect(fonts.map((f) => f.family)).toEqual(['Noto Sans CJK JP', 'Noto Sans CJK SC']);
  });

  it('parses each collection once even when fc-list repeats it per face', async () => {
    const data = packedFonts([['Arial', 'Regular']]);
    const read = vi.fn(async () => data);
    const fonts = await expandCollections(
      [
        { family: 'Arial', style: 'regular', file: '/fonts/a.ttc' },
        { family: 'Arial', style: 'bold', file: '/fonts/a.ttc' },
        { family: 'Arial', style: 'italic', file: '/fonts/a.ttc' },
      ],
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(fonts).toHaveLength(1);
  });

  it('keeps plain fonts untouched', async () => {
    const fonts = await expandCollections([
      { family: 'Inter', style: 'regular', file: '/fonts/Inter.ttf' },
    ]);
    expect(fonts).toEqual([{ family: 'Inter', style: 'regular', file: '/fonts/Inter.ttf' }]);
  });

  it('drops a collection that cannot be read', async () => {
    const fonts = await expandCollections(
      [{ family: 'Broken', style: 'regular', file: '/fonts/broken.ttc' }],
      async () => {
        throw new Error('EACCES');
      },
    );
    expect(fonts).toEqual([]);
  });

  it('drops a collection that cannot be parsed', async () => {
    const fonts = await expandCollections(
      [{ family: 'Broken', style: 'regular', file: '/fonts/broken.ttc' }],
      async () => new Uint8Array(8),
    );
    expect(fonts).toEqual([]);
  });
});

describe('collection face paths', () => {
  it('splits path#index', () => {
    expect(collectionFacePath('/f/a.ttc#3')).toEqual({ file: '/f/a.ttc', index: 3 });
  });

  it('ignores a plain path or a malformed index', () => {
    expect(collectionFacePath('/f/a.ttc')).toBeNull();
    expect(collectionFacePath('/f/a.ttc#')).toBeNull();
    expect(collectionFacePath('/f/a.ttc#x')).toBeNull();
    expect(collectionFacePath('/f/a.ttc#-1')).toBeNull();
  });

  it('treats the face and its container as the same font for the allow-list', () => {
    expect(isKnownFontPath('/f/a.ttc#1', ['/f/a.ttc#0', '/f/a.ttc#2'])).toBe(true);
    expect(isKnownFontPath('/f/a.ttc#1', ['/f/b.ttc#1'])).toBe(false);
  });
});

describe('readSystemFont with collections', () => {
  it('returns only the requested face', async () => {
    const file = path.join(tmp, 'arial.ttc');
    fs.writeFileSync(
      file,
      packedFonts([
        ['Arial', 'Regular'],
        ['Arial', 'Bold'],
      ]),
    );

    const face = await readSystemFont(`${file}#1`, [`${file}#1`]);
    expect(readNames(face).subfamily).toBe('Bold');
  });

  it('refuses a face that is not in the list', async () => {
    const file = path.join(tmp, 'other.ttc');
    fs.writeFileSync(file, packedFonts([['Arial', 'Regular']]));
    await expect(readSystemFont(`${file}#0`, ['/elsewhere/a.ttc#0'])).rejects.toThrow(
      /outside the system font list/,
    );
  });

  it('refuses an index the collection does not have', async () => {
    const file = path.join(tmp, 'single.ttc');
    fs.writeFileSync(file, packedFonts([['Arial', 'Regular']]));
    await expect(readSystemFont(`${file}#9`, [`${file}#9`])).rejects.toThrow(/could not be extracted/);
  });
});

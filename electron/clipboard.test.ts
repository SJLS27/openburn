// @vitest-environment node
import { gzipSync, deflateSync, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodeSvgBuffer,
  formatName,
  isRasterType,
  isSvgType,
  payloadBytes,
  readClipboardPayload,
  type ClipboardItemLike,
} from './clipboard';

const SVG =
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="10" height="10"/></svg>';
const INKSCAPE_RAW =
  'electron application/osclipboard;format="image/x-inkscape-compressed-svg"';

/** Build a fake Electron 45 clipboard item that returns values per type. */
function item(payloads: Record<string, unknown>): ClipboardItemLike {
  return {
    types: Object.keys(payloads),
    async getType(type: string) {
      const value = payloads[type];
      if (value === undefined) throw new Error(`missing ${type}`);
      return value;
    },
  };
}

function clipboardOf(items: ClipboardItemLike[], text = '') {
  return {
    async readText() {
      return text;
    },
    async read() {
      return items;
    },
  };
}

describe('formatName / isSvgType / isRasterType', () => {
  it('unwraps every Electron non-standard format prefix', () => {
    expect(formatName('image/svg+xml')).toBe('image/svg+xml');
    expect(formatName('web image/x-inkscape-compressed-svg')).toBe(
      'image/x-inkscape-compressed-svg',
    );
    expect(formatName(INKSCAPE_RAW)).toBe('image/x-inkscape-compressed-svg');
    expect(formatName('electron application/osclipboard;format=SVG Image')).toBe('SVG Image');
  });

  it('recognises SVG names from all platforms', () => {
    for (const type of [
      'image/svg+xml',
      'image/x-inkscape-compressed-svg',
      'web image/x-inkscape-compressed-svg',
      INKSCAPE_RAW,
      'electron application/osclipboard;format="public.svg-image"',
      'electron application/osclipboard;format=SVG Image',
      'electron application/osclipboard;format="image/x-inkscape-svg"',
    ]) {
      expect(isSvgType(type), type).toBe(true);
    }
  });

  it('classifies raster MIME types (including wrapped ones)', () => {
    for (const type of ['image/png', 'image/jpeg', 'web image/png', 'image/webp']) {
      expect(isRasterType(type), type).toBe(true);
    }
    expect(isRasterType('image/svg+xml')).toBe(false);
    expect(isRasterType('text/plain')).toBe(false);
  });
});

describe('payloadBytes', () => {
  it('accepts every shape getType may resolve to', async () => {
    const bytes = Buffer.from(SVG);
    expect((await payloadBytes(new Blob([bytes])))?.toString()).toBe(SVG);
    expect((await payloadBytes(bytes))?.toString()).toBe(SVG);
    expect((await payloadBytes(new Uint8Array(bytes)))?.toString()).toBe(SVG);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect((await payloadBytes(ab))?.toString()).toBe(SVG);
    expect((await payloadBytes(SVG))?.toString()).toBe(SVG);
  });

  it('ignores bookmarks and empty values', async () => {
    expect(await payloadBytes(null)).toBeNull();
    expect(await payloadBytes({ title: 'x', url: 'https://example.com' })).toBeNull();
  });
});

describe('decodeSvgBuffer', () => {
  it('reads plain UTF-8 and UTF-16LE SVG', () => {
    expect(decodeSvgBuffer(Buffer.from(SVG, 'utf-8'))).toContain('<svg');
    expect(decodeSvgBuffer(Buffer.from(SVG, 'utf16le'))).toContain('<svg');
  });

  it('strips a UTF-8 BOM', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SVG)]);
    expect(decodeSvgBuffer(withBom)?.startsWith('<')).toBe(true);
  });

  it('decodes the gzip payload Inkscape uses on Linux', () => {
    expect(decodeSvgBuffer(gzipSync(Buffer.from(SVG)))).toContain('<svg');
  });

  it('decodes zlib and raw deflate variants', () => {
    expect(decodeSvgBuffer(deflateSync(Buffer.from(SVG)))).toContain('<svg');
    expect(decodeSvgBuffer(deflateRawSync(Buffer.from(SVG)))).toContain('<svg');
  });

  it('decodes base64 and URL-encoded SVG data URIs', () => {
    const b64 = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;
    expect(decodeSvgBuffer(Buffer.from(b64))).toContain('<svg');
    const url = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
    expect(decodeSvgBuffer(Buffer.from(url))).toContain('<svg');
  });

  it('rejects HTML that merely embeds an <svg>', () => {
    const html = '<html><body><svg><rect/></svg></body></html>';
    expect(decodeSvgBuffer(Buffer.from(html))).toBeNull();
  });

  it('returns null for non-SVG payloads', () => {
    expect(decodeSvgBuffer(Buffer.from('not an svg'))).toBeNull();
    expect(decodeSvgBuffer(gzipSync(Buffer.from('hello')))).toBeNull();
  });
});

describe('readClipboardPayload', () => {
  it('reads Inkscape gzip SVG from the raw OS format and keeps the raster as fallback', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const clipboard = clipboardOf(
      [item({ [INKSCAPE_RAW]: new Blob([gzipSync(Buffer.from(SVG))]), 'image/png': new Blob([png]) })],
      SVG,
    );
    const payload = await readClipboardPayload(clipboard);
    expect(payload.svg).toContain('<svg');
    expect(payload.image).toMatch(/^data:image\/png;base64,/);
  });

  it('reads the W3C web custom format variant', async () => {
    const clipboard = clipboardOf([
      item({ 'web image/x-inkscape-compressed-svg': new Blob([gzipSync(Buffer.from(SVG))]) }),
    ]);
    expect((await readClipboardPayload(clipboard)).svg).toContain('<svg');
  });

  it('sniffs SVG content when the type name is unexpected', async () => {
    // An unknown wrapper name that does not contain "svg" must still work.
    const type = 'electron application/osclipboard;format="Some Vector Payload"';
    const clipboard = clipboardOf([item({ [type]: new Blob([gzipSync(Buffer.from(SVG))]) })]);
    expect((await readClipboardPayload(clipboard)).svg).toContain('<svg');
  });

  it('works when getType returns a Buffer/ArrayBuffer instead of a Blob', async () => {
    const gz = gzipSync(Buffer.from(SVG));
    for (const value of [gz, new Uint8Array(gz), gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)]) {
      const clipboard = clipboardOf([item({ [INKSCAPE_RAW]: value })]);
      expect((await readClipboardPayload(clipboard)).svg).toContain('<svg');
    }
  });

  it('reads a plain image/svg+xml payload', async () => {
    const clipboard = clipboardOf([item({ 'image/svg+xml': new Blob([SVG]) })]);
    expect((await readClipboardPayload(clipboard)).svg).toContain('<svg');
  });

  it('falls back to the plain-text representation when it is the SVG source', async () => {
    const clipboard = clipboardOf([item({ 'text/plain': new Blob([SVG]) })], SVG);
    expect((await readClipboardPayload(clipboard)).svg).toContain('<svg');
  });

  it('never throws when clipboard formats are unreadable', async () => {
    const clipboard = {
      async readText() {
        throw new Error('unavailable');
      },
      async read() {
        throw new Error('unavailable');
      },
    };
    await expect(readClipboardPayload(clipboard)).resolves.toEqual({
      text: '',
      html: '',
      image: null,
      svg: null,
    });
  });
});

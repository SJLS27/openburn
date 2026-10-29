import { describe, expect, it } from 'vitest';
import {
  buildDocument,
  looksLikeProject,
  parseDocument,
  serializeDocument,
} from '@/core/serialize';
import { DEFAULT_CUT_SETTINGS, createEmptyDocument, createLayer } from '@/types/document';

function sampleDocument() {
  const base = createEmptyDocument('Sample');
  return buildDocument({
    name: 'Sample',
    units: 'in',
    bed: { ...base.bed, width: 600, height: 300 },
    layers: [createLayer(0), createLayer(2)],
    canvas: { version: '6', objects: [{ type: 'Rect' }] },
    createdAt: '2026-01-02T03:04:05.000Z',
  });
}

describe('core/serialize (.obrn)', () => {
  it('builds a versioned document envelope', () => {
    const doc = sampleDocument();

    expect(doc.format).toBe('openburn');
    expect(doc.version).toBe(1);
    expect(doc.units).toBe('in');
    expect(doc.meta.name).toBe('Sample');
    expect(doc.meta.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(doc.meta.updatedAt).toBeTruthy();
    expect(doc.layers).toHaveLength(2);
  });

  it('round-trips through serialize + parse', () => {
    const doc = sampleDocument();
    const parsed = parseDocument(serializeDocument(doc));

    expect(parsed.units).toBe(doc.units);
    expect(parsed.bed).toEqual(doc.bed);
    expect(parsed.layers).toEqual(doc.layers);
    expect(parsed.canvas).toEqual(doc.canvas);
    expect(parsed.meta.name).toBe('Sample');
  });

  it('fills missing cut settings with the defaults', () => {
    const parsed = parseDocument(
      JSON.stringify({
        format: 'openburn',
        units: 'mm',
        layers: [
          {
            id: 'layer-FF0000',
            name: 'C00',
            color: '#ff0000',
            settings: { power: 42 },
          },
        ],
      }),
    );

    expect(parsed.layers[0].settings.power).toBe(42);
    expect(parsed.layers[0].settings.speed).toBe(DEFAULT_CUT_SETTINGS.speed);
    expect(parsed.layers[0].settings.mode).toBe(DEFAULT_CUT_SETTINGS.mode);
  });

  it('rejects malformed or foreign files', () => {
    expect(() => parseDocument('{not json')).toThrow('File is not valid JSON');
    expect(() => parseDocument('"a string"')).toThrow('Invalid project file');
    expect(() => parseDocument(JSON.stringify({ format: 'other' }))).toThrow(
      'Not an OpenBurn project',
    );
  });

  it('normalizes legacy units to mm or in', () => {
    const parsed = parseDocument(
      JSON.stringify({ format: 'openburn', units: 'furlong', layers: [] }),
    );
    expect(parsed.units).toBe('mm');
  });

  it('detects project files by extension', () => {
    expect(looksLikeProject('part.obrn')).toBe(true);
    expect(looksLikeProject('LEGACY.OVBRN')).toBe(true);
    expect(looksLikeProject('design.json')).toBe(true);
    expect(looksLikeProject('part.svg')).toBe(false);
  });
});

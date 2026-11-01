import { describe, expect, it } from 'vitest';
import { dropKindForFile, fileExtension, isTextDrop } from './dropRouting';

describe('core/dropRouting', () => {
  it('extracts extensions case-insensitively', () => {
    expect(fileExtension('Design.OBRN')).toBe('obrn');
    expect(fileExtension('/tmp/my.part.LBRN2')).toBe('lbrn2');
    expect(fileExtension('no-extension')).toBe('');
  });

  it('routes project and LightBurn files', () => {
    expect(dropKindForFile('plate.obrn')).toBe('project');
    expect(dropKindForFile('legacy.ovbrn')).toBe('project');
    expect(dropKindForFile('laser.lbrn')).toBe('lightburn');
    expect(dropKindForFile('laser.lbrn2')).toBe('lightburn');
  });

  it('routes vector and image artwork', () => {
    expect(dropKindForFile('logo.svg')).toBe('svg');
    expect(dropKindForFile('bracket.DXF')).toBe('dxf');
    expect(dropKindForFile('photo.jpeg')).toBe('image');
    expect(dropKindForFile('scan.webp')).toBe('image');
  });

  it('rejects unknown files', () => {
    expect(dropKindForFile('notes.txt')).toBe('unsupported');
    expect(dropKindForFile('archive.zip')).toBe('unsupported');
    expect(dropKindForFile('README')).toBe('unsupported');
  });

  it('marks project and vector files as text', () => {
    expect(isTextDrop('a.obrn')).toBe(true);
    expect(isTextDrop('a.lbrn2')).toBe(true);
    expect(isTextDrop('a.svg')).toBe(true);
    expect(isTextDrop('a.dxf')).toBe(true);
    expect(isTextDrop('a.png')).toBe(false);
  });
});

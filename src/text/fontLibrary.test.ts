import { describe, expect, it } from 'vitest';
import { buildFontLibrary, resolveFace, type FontFace } from './fontLibrary';

const faces: FontFace[] = [
  { family: 'Inter', style: 'regular', file: '/f/Inter-Regular.ttf' },
  { family: 'Inter', style: 'bold', file: '/f/Inter-Bold.ttf' },
  { family: 'Arial Black', style: 'regular', file: '/f/Arial Black.ttf' },
  { family: 'Liberation Sans', style: 'regular', file: '/f/LiberationSans-Regular.ttf' },
  { family: 'Liberation Sans', style: 'bold', file: '/f/LiberationSans-Bold.ttf' },
  { family: 'Liberation Sans', style: 'italic', file: '/f/LiberationSans-Italic.ttf' },
  { family: 'Liberation Sans', style: 'bold italic', file: '/f/LiberationSans-BoldItalic.ttf' },
];

describe('text/fontLibrary', () => {
  describe('buildFontLibrary', () => {
    it('indexes faces by lower-cased family and style', () => {
      const lib = buildFontLibrary(faces);
      expect(lib.get('liberation sans')?.get('bold')?.file).toBe('/f/LiberationSans-Bold.ttf');
      expect(lib.get('arial black')?.get('regular')?.file).toBe('/f/Arial Black.ttf');
    });

    it('keeps the first face when the list repeats a style', () => {
      const lib = buildFontLibrary([
        { family: 'Dup', style: 'regular', file: '/first.ttf' },
        { family: 'Dup', style: 'regular', file: '/second.ttf' },
      ]);
      expect(lib.get('dup')?.get('regular')?.file).toBe('/first.ttf');
    });
  });

  describe('resolveFace', () => {
    const lib = buildFontLibrary(faces);

    it('matches family and weight', () => {
      expect(resolveFace(lib, 'Liberation Sans', '700', 'normal')?.file).toBe(
        '/f/LiberationSans-Bold.ttf',
      );
      expect(resolveFace(lib, 'Liberation Sans', 400, 'normal')?.file).toBe(
        '/f/LiberationSans-Regular.ttf',
      );
    });

    it('maps numeric and keyword weights to bold', () => {
      expect(resolveFace(lib, 'Liberation Sans', 'bold', undefined)?.style).toBe('bold');
      expect(resolveFace(lib, 'Liberation Sans', '600', undefined)?.style).toBe('bold');
      expect(resolveFace(lib, 'Liberation Sans', '500', undefined)?.style).toBe('regular');
    });

    it('falls back through the style chain (bold italic → bold → regular)', () => {
      const partial = buildFontLibrary([{ family: 'Only Regular', style: 'regular', file: '/r.ttf' }]);
      expect(resolveFace(partial, 'Only Regular', '700', 'italic')?.file).toBe('/r.ttf');
    });

    it('walks a font stack in order and strips quotes', () => {
      expect(resolveFace(lib, '"Missing", Liberation Sans', '400', undefined)?.file).toBe(
        '/f/LiberationSans-Regular.ttf',
      );
      expect(resolveFace(lib, "'Arial Black', sans-serif", '400', undefined)?.family).toBe(
        'Arial Black',
      );
    });

    it('returns null when no family is installed', () => {
      expect(resolveFace(lib, 'Comic Sans MS', '400', undefined)).toBeNull();
      expect(resolveFace(lib, '', '400', undefined)).toBeNull();
      expect(resolveFace(lib, undefined, undefined, undefined)).toBeNull();
    });
  });
});

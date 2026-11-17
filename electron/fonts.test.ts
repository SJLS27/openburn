// @vitest-environment node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dedupeFonts,
  familyFromFileName,
  fontsFromDirectoryScan,
  isKnownFontPath,
  listSystemFonts,
  normaliseStyle,
  parseFcListLine,
  parseFcListOutput,
  readSystemFont,
  registerFontHandlers,
  resetFontsCache,
} from './fonts';

const FC_LIST_SAMPLE = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf\tLiberation Sans\tRegular',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf\tLiberation Sans\tBold',
  '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf\tLiberation Sans\tBoldItalic',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf\tLiberation Sans\tItalic',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc\tNoto Sans CJK SC\tRegular',
  '/usr/share/fonts/variable/Inter[wght].ttf\tInter,Inter Display\tRegular',
  '',
].join('\n');

describe('electron/fonts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normaliseStyle', () => {
    it('maps the usual style strings to the four renderer styles', () => {
      expect(normaliseStyle('Regular')).toBe('regular');
      expect(normaliseStyle('Bold')).toBe('bold');
      expect(normaliseStyle('Bold Italic')).toBe('bold italic');
      expect(normaliseStyle('Italic')).toBe('italic');
      expect(normaliseStyle('Oblique')).toBe('italic');
      expect(normaliseStyle('Black')).toBe('bold');
      expect(normaliseStyle('SemiBold')).toBe('bold');
      expect(normaliseStyle('')).toBe('regular');
      expect(normaliseStyle(undefined)).toBe('regular');
    });
  });

  describe('parseFcListLine', () => {
    it('parses file, first family and first style', () => {
      const [font] = parseFcListLine(
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf\tLiberation Sans\tBold',
      );
      expect(font).toEqual({
        family: 'Liberation Sans',
        style: 'bold',
        file: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      });
    });

    it('keeps the first family when fc-list reports aliases', () => {
      const [font] = parseFcListLine('/f/Inter.ttf\tInter,Inter Display\tRegular');
      expect(font.family).toBe('Inter');
    });

    it('skips collections and unsupported containers', () => {
      expect(parseFcListLine('/f/NotoSansCJK.ttc\tNoto Sans CJK\tRegular')).toEqual([]);
      expect(parseFcListLine('/f/Font.woff2\tWeb Font\tRegular')).toEqual([]);
      expect(parseFcListLine('/f/Font.pfb\tType1\tRegular')).toEqual([]);
    });

    it('ignores blank lines and malformed rows', () => {
      expect(parseFcListLine('')).toEqual([]);
      expect(parseFcListLine('/only/a/path.ttf')).toEqual([]);
    });
  });

  describe('parseFcListOutput', () => {
    it('parses every usable row and drops .ttc faces', () => {
      const fonts = parseFcListOutput(FC_LIST_SAMPLE);
      expect(fonts).toHaveLength(5);
      expect(fonts.map((f) => f.style)).toEqual([
        'regular',
        'bold',
        'bold italic',
        'italic',
        'regular',
      ]);
      expect(fonts.some((f) => f.file.endsWith('.ttc'))).toBe(false);
    });
  });

  describe('dedupeFonts', () => {
    it('drops repeated file/family/style triples but keeps distinct faces', () => {
      const font = { family: 'A', style: 'regular' as const, file: '/a.ttf' };
      expect(dedupeFonts([font, { ...font }, { ...font, style: 'bold' }])).toHaveLength(2);
    });
  });

  describe('familyFromFileName', () => {
    it.each([
      // "Black" is part of the family name on macOS/Windows, not a style.
      ['Arial Black', { family: 'Arial Black', style: 'regular' }],
      ['NotoSans-BoldItalic', { family: 'Noto Sans', style: 'bold italic' }],
      ['DejaVuSansMono', { family: 'Deja Vu Sans Mono', style: 'regular' }],
      ['Liberation Sans Bold', { family: 'Liberation Sans', style: 'bold' }],
      ['arialbd', { family: 'Arial', style: 'bold' }],
      ['timesbi', { family: 'Times New Roman', style: 'bold italic' }],
    ])('guesses %s', (base, expected) => {
      expect(familyFromFileName(base)).toEqual(expected);
    });
  });

  describe('fontsFromDirectoryScan', () => {
    it('reads directories that exist and ignores the rest', () => {
      const readdir = vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: string) => {
        if (String(dir).endsWith('/missing')) throw new Error('ENOENT');
        return ['Arial Black.ttf', 'notes.txt', 'Collection.ttc'];
      }) as never);

      const fonts = fontsFromDirectoryScan(['/fonts', '/missing']);
      expect(fonts).toEqual([
        { family: 'Arial Black', style: 'regular', file: '/fonts/Arial Black.ttf' },
      ]);
      expect(readdir).toHaveBeenCalledTimes(2);
    });
  });

  describe('listSystemFonts', () => {
    it('uses fc-list on Linux', async () => {
      const fonts = await listSystemFonts('linux');
      // The CI containers may have no fontconfig; either way the shape holds.
      if (fonts.error) {
        expect(fonts.fonts).toEqual([]);
      } else {
        expect(Array.isArray(fonts.fonts)).toBe(true);
      }
    });

    it('reads the font directories on macOS', async () => {
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['Arial Black.ttf'] as never);
      const result = await listSystemFonts('darwin');
      expect(result.error).toBeUndefined();
      expect(result.fonts.some((f) => f.family === 'Arial Black')).toBe(true);
    });

    it('reports unsupported platforms instead of throwing', async () => {
      const result = await listSystemFonts('aix');
      expect(result).toEqual({ fonts: [], error: 'Unsupported platform: aix' });
    });
  });

  describe('readSystemFont', () => {    it('refuses paths outside the listed fonts (security)', async () => {
      const known = ['/usr/share/fonts/x.ttf'];
      await expect(readSystemFont('/etc/passwd', known)).rejects.toThrow(
        /outside the system font list/,
      );
      expect(isKnownFontPath('/etc/passwd', known)).toBe(false);
      expect(isKnownFontPath('/usr/share/fonts/x.ttf', known)).toBe(true);
    });

    it('reads a listed file', async () => {
      const read = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('font'));
      const buf = await readSystemFont('/fonts/a.ttf', ['/fonts/a.ttf']);
      expect(buf.toString()).toBe('font');
      expect(read).toHaveBeenCalledWith('/fonts/a.ttf');
    });
  });
});

describe('registerFontHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetFontsCache();
  });

  function fakeIpc() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    return {
      handlers,
      ipc: {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
          handlers.set(channel, listener);
        },
      },
    };
  }

  it('exposes the list through fonts:list', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['Arial Black.ttf'] as never);
    const { handlers, ipc } = fakeIpc();
    registerFontHandlers(ipc);

    const result = (await handlers.get('fonts:list')?.()) as {
      fonts: Array<{ family: string }>;
    };
    expect(result.fonts.map((f) => f.family)).toContain('Arial Black');
  });

  it('reads only listed files through fonts:read', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['Arial Black.ttf'] as never);
    const read = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('ABC'));
    const { handlers, ipc } = fakeIpc();
    registerFontHandlers(ipc);

    const listed = (await handlers.get('fonts:list')?.()) as {
      fonts: Array<{ file: string }>;
    };
    const listedFile = listed.fonts[0].file;

    await expect(handlers.get('fonts:read')?.(null, listedFile)).resolves.toBe('QUJD');
    await expect(handlers.get('fonts:read')?.(null, '/etc/passwd')).rejects.toThrow(
      /outside the system font list/,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('caches the list between calls', async () => {
    const readdir = vi.spyOn(fs, 'readdirSync').mockReturnValue(['Arial Black.ttf'] as never);
    const { handlers, ipc } = fakeIpc();
    registerFontHandlers(ipc);

    await handlers.get('fonts:list')?.();
    const calls = readdir.mock.calls.length;
    await handlers.get('fonts:list')?.();

    expect(readdir.mock.calls.length).toBe(calls);
  });
});

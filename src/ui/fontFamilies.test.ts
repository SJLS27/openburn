import { describe, expect, it } from 'vitest';
import { FALLBACK_FAMILIES, filterFamilies, toFamilies } from './fontFamilies';

describe('ui/fontFamilies', () => {
  describe('toFamilies', () => {
    it('groups faces by family with sorted styles', () => {
      const families = toFamilies([
        { family: 'Liberation Sans', style: 'bold' },
        { family: 'Liberation Sans', style: 'regular' },
        { family: 'Arial Black', style: 'regular' },
      ]);
      expect(families.map((f) => f.family)).toEqual(['Arial Black', 'Liberation Sans']);
      expect(families[1].styles).toEqual(['bold', 'regular']);
    });

    it('drops blank families and repeats', () => {
      const families = toFamilies([
        { family: '  ', style: 'regular' },
        { family: 'A', style: 'regular' },
        { family: 'A', style: 'regular' },
      ]);
      expect(families).toEqual([{ family: 'A', styles: ['regular'] }]);
    });
  });

  describe('filterFamilies', () => {
    const families = toFamilies(
      ['Inter', 'Arial', 'Arial Black', 'Noto Sans', 'Deja Vu Sans'].map((family) => ({
        family,
        style: 'regular',
      })),
    );

    it('always pins Inter first', () => {
      expect(filterFamilies(families, '')[0].family).toBe('Inter');
      expect(filterFamilies(families, 'arial')[0].family).toBe('Inter');
    });

    it('matches anywhere in the name, case-insensitively', () => {
      const names = filterFamilies(families, 'arial').map((f) => f.family);
      expect(names).toContain('Arial');
      expect(names).toContain('Arial Black');
      expect(names).not.toContain('Noto Sans');
    });

    it('caps the result so a 3000-family list stays usable', () => {
      const many = toFamilies(
        Array.from({ length: 500 }, (_, i) => ({ family: `Font ${i}`, style: 'regular' })),
      );
      expect(filterFamilies(many, '', 50)).toHaveLength(50);
    });
  });

  it('exposes a usable browser fallback list', () => {
    expect(FALLBACK_FAMILIES).toContain('Inter');
    expect(new Set(FALLBACK_FAMILIES).size).toBe(FALLBACK_FAMILIES.length);
  });
});

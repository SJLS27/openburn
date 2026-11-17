import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './icons';

function svgOf(name: Parameters<typeof Icon>[0]['name']): SVGSVGElement {
  const { container } = render(<Icon name={name} />);
  return container.querySelector('svg')!;
}

describe('icons', () => {
  describe('settings', () => {
    it('is a cog, not the eight-ray sun that reads as a theme toggle', () => {
      const svg = svgOf('settings');
      const paths = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');

      // The old icon drew eight equidistant rays around the centre.
      const rays = [
        'M12 2.5v3',
        'M12 18.5v3',
        'M2.5 12h3',
        'M18.5 12h3',
        'M5.2 5.2l2.1 2.1',
        'M16.7 16.7l2.1 2.1',
        'M18.8 5.2l-2.1 2.1',
        'M7.3 16.7l-2.1 2.1',
      ];
      for (const ray of rays) {
        expect(paths.some((d) => d.includes(ray))).toBe(false);
      }

      // A gear body plus a hub, with the outline closing on itself.
      expect(paths).toHaveLength(2);
      expect(paths.some((d) => d.includes('a3.6 3.6'))).toBe(true);
      expect(paths.some((d) => d.includes('a1.7 1.7'))).toBe(true);
    });

    it('fits inside the 24px viewBox', () => {
      const svg = svgOf('settings');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');

      // Absolute point (the first M/L coordinate pair) must sit on canvas.
      const absolute = [...svg.querySelectorAll('path')].flatMap((p) => {
        const d = p.getAttribute('d') ?? '';
        return [...d.matchAll(/\b[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]);
      });
      expect(absolute.length).toBeGreaterThan(0);
      for (const [x, y] of absolute) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(24);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(24);
      }
    });
  });
});

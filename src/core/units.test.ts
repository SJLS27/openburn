import { describe, expect, it } from 'vitest';
import {
  MM_PER_INCH,
  defaultGridSize,
  displayToMm,
  formatLength,
  formatNumber,
  mmToDisplay,
  unitsPerMm,
} from '@/core/units';

describe('core/units', () => {
  it('uses the exact inch definition', () => {
    expect(MM_PER_INCH).toBe(25.4);
  });

  it('treats millimeters as the identity unit', () => {
    expect(unitsPerMm('mm')).toBe(1);
    expect(mmToDisplay(12.5, 'mm')).toBe(12.5);
    expect(displayToMm(12.5, 'mm')).toBe(12.5);
  });

  it('converts inches in both directions', () => {
    expect(mmToDisplay(25.4, 'in')).toBeCloseTo(1, 10);
    expect(displayToMm(1, 'in')).toBeCloseTo(25.4, 10);
    expect(displayToMm(mmToDisplay(42, 'in'), 'in')).toBeCloseTo(42, 10);
  });

  it('formats lengths and numbers for display', () => {
    expect(formatLength(25.4, 'in')).toBe('1.00 in');
    expect(formatLength(10, 'mm', 1)).toBe('10.0 mm');
    expect(formatNumber(25.4, 'in')).toBe('1.00');
    expect(formatNumber(25.4, 'mm', 0)).toBe('25');
  });

  it('picks a sensible default grid per unit system', () => {
    expect(defaultGridSize('mm')).toBe(10);
    expect(defaultGridSize('in')).toBe(0.5);
  });
});

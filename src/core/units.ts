import type { Units } from '@/types/document';

export const MM_PER_INCH = 25.4;

export function unitsPerMm(units: Units): number {
  return units === 'mm' ? 1 : 1 / MM_PER_INCH;
}

export function mmToDisplay(mm: number, units: Units): number {
  return mm * unitsPerMm(units);
}

export function displayToMm(value: number, units: Units): number {
  return value / unitsPerMm(units);
}

export function formatLength(mm: number, units: Units, decimals = 2): string {
  const v = mmToDisplay(mm, units);
  return `${v.toFixed(decimals)} ${units}`;
}

export function formatNumber(mm: number, units: Units, decimals = 2): string {
  return mmToDisplay(mm, units).toFixed(decimals);
}

/** Sensible grid spacing for the current unit system. */
export function defaultGridSize(units: Units): number {
  return units === 'mm' ? 10 : 0.5;
}

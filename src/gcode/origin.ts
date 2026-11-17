import type { BedOrigin, Pt } from './types';

/**
 * Device origin corners. LightBurn lets the user pick where machine zero sits
 * relative to the artwork, so a project can map to any of the four corners of
 * the bed (GitHub #5).
 */
export const BED_ORIGINS: readonly BedOrigin[] = [
  'bottom-left',
  'top-left',
  'bottom-right',
  'top-right',
];

export interface BedOriginOption {
  value: BedOrigin;
  label: string;
}

/** Shared by the device settings dialog and the laser panel. */
export const BED_ORIGIN_OPTIONS: readonly BedOriginOption[] = [
  { value: 'bottom-left', label: 'Bottom-left (typical GRBL)' },
  { value: 'top-left', label: 'Top-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
  { value: 'top-right', label: 'Top-right' },
];

export function isBedOrigin(value: unknown): value is BedOrigin {
  return typeof value === 'string' && (BED_ORIGINS as readonly string[]).includes(value);
}

function flipsX(origin: BedOrigin): boolean {
  return origin === 'bottom-right' || origin === 'top-right';
}

function flipsY(origin: BedOrigin): boolean {
  return origin === 'bottom-left' || origin === 'bottom-right';
}

/**
 * Map a document point (Y down, bed top-left) to machine coordinates.
 *
 * `bed` only carries the extent; the design always starts at 0,0. When the
 * controller zero sits on the right, X is mirrored; when it sits at the
 * bottom, Y is mirrored.
 */
export function mapBedPoint(p: Pt, bed: { width: number; height: number }, origin: BedOrigin): Pt {
  return {
    x: flipsX(origin) ? bed.width - p.x : p.x,
    y: flipsY(origin) ? bed.height - p.y : p.y,
  };
}

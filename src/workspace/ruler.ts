import type { Units } from '@/types/document';

/** Candidates in document units (mm or inch). */
const STEPS: Record<Units, number[]> = {
  mm: [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000],
  in: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 20],
};

export interface RulerTick {
  /** Position along the ruler, in screen pixels. */
  screen: number;
  /** Value in document units. */
  value: number;
  label: string;
  major: boolean;
}

/**
 * Ticks for a ruler that scrolls with the canvas.
 *
 * @param length   Ruler length in screen pixels.
 * @param offset   Screen position (px) of the document origin.
 * @param zoom     Canvas zoom (px per document unit).
 * @param units    Document units; the axis is expressed in the same unit.
 * @param minPx    Minimum spacing between labelled ticks.
 */
export function rulerTicks(
  length: number,
  offset: number,
  zoom: number,
  units: Units,
  minPx = 56,
): RulerTick[] {
  if (!(length > 0) || !(zoom > 0)) return [];
  const steps = STEPS[units] ?? STEPS.mm;
  const major = steps.find((s) => s * zoom >= minPx) ?? steps[steps.length - 1];
  const minor = major / 5;

  const startValue = Math.floor(-offset / zoom / minor) * minor;
  const endValue = Math.ceil((length - offset) / zoom / minor) * minor;
  const ticks: RulerTick[] = [];
  const decimals = major >= 1 ? 0 : major >= 0.1 ? 1 : 2;

  // Guard against absurd loops when zoomed far out.
  const count = (endValue - startValue) / minor;
  if (!Number.isFinite(count) || count > 20000) return ticks;

  for (let value = startValue; value <= endValue + 1e-9; value += minor) {
    const rounded = Math.round(value / minor) * minor;
    const isMajor = Math.abs(rounded / major - Math.round(rounded / major)) < 1e-6;
    ticks.push({
      screen: offset + rounded * zoom,
      value: rounded,
      label: isMajor ? formatTick(rounded, decimals) : '',
      major: isMajor,
    });
  }
  return ticks;
}

/** Avoid "-0", trailing zeros and float noise in ruler labels. */
export function formatTick(value: number, decimals: number): string {
  const v = Math.abs(value) < 1e-9 ? 0 : value;
  if (decimals === 0) return String(Math.round(v));
  return v.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

/** Highlight position of the pointer on a ruler, or null when off-screen. */
export function rulerCursor(
  length: number,
  offset: number,
  zoom: number,
  sceneValue: number,
): number | null {
  const screen = offset + sceneValue * zoom;
  if (screen < 0 || screen > length) return null;
  return screen;
}

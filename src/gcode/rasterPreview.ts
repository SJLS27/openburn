import type { PlanSegment, Pt } from './types';

/**
 * A run of consecutive points of a raster scan line that share an effective
 * (non-zero) power. `power` is the average power over the run, 0 - 100.
 */
export interface RasterRun {
  points: Pt[];
  power: number;
}

function clampPower(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Power that `emitGcode` actually applies when moving into point `i`.
 *
 * Raster segments carry one power value per point, but the laser is only set
 * for moves (points 1..n-1): the move into point `i` uses the power of the
 * *previous* point, matching GRBL's M4 behaviour. Point 0 therefore never
 * lights up on its own. Keeping this in one place means the preview and the
 * generated G-code always agree.
 */
export function powerForMove(powers: number[] | undefined, index: number): number {
  if (!powers || index <= 0) return 0;
  return clampPower(powers[Math.min(index - 1, powers.length - 1)] ?? 0);
}

/**
 * Split a raster segment into visible runs (consecutive moves that share a
 * non-zero power). A dashed segment contributes one run per lit stretch; a
 * plain segment contributes a single run. Zero-power moves are dropped so the
 * preview never paints a whole scan line just because it exists.
 */
export function rasterRuns(segment: Pick<PlanSegment, 'points' | 'powers'>): RasterRun[] {
  const { points, powers } = segment;
  if (!powers || points.length < 2) return [];

  const runs: RasterRun[] = [];
  let runPoints: Pt[] = [];
  let powerSum = 0;
  let powerCount = 0;

  const flush = () => {
    if (powerCount > 0 && runPoints.length > 1) {
      runs.push({ points: [...runPoints], power: powerSum / powerCount });
    }
    runPoints = [];
    powerSum = 0;
    powerCount = 0;
  };

  for (let i = 1; i < points.length; i += 1) {
    const power = powerForMove(powers, i);
    if (power <= 0) {
      flush();
      continue;
    }
    if (runPoints.length === 0) runPoints.push(points[i - 1]);
    runPoints.push(points[i]);
    powerSum += power;
    powerCount += 1;
  }
  flush();

  return runs;
}

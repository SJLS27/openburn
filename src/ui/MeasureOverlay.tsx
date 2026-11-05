import type { LiveMeasure } from '@/workspace/measure';
import type { Units } from '@/types/document';
import { mmToDisplay } from '@/core/units';

interface Props {
  measure: LiveMeasure;
  units: Units;
}

function n(mm: number, units: Units, decimals = 1): string {
  return mmToDisplay(mm, units).toFixed(decimals);
}

function signed(mm: number, units: Units, decimals = 1): string {
  const v = mmToDisplay(mm, units);
  const text = Math.abs(v).toFixed(decimals);
  return `${v >= 0 ? '+' : '−'}${text}`;
}

/**
 * Compact readout shown next to the selection while it is moved, scaled or
 * rotated. It is pointer-transparent so it never blocks the canvas.
 */
export function MeasureOverlay({ measure, units }: Props) {
  return (
    <div className="measure-overlay" data-testid="measure-overlay">
      <span className="measure-value">
        {n(measure.width, units)} × {n(measure.height, units)} {units}
      </span>
      <span className="measure-sep" />
      <span className="measure-delta">
        ΔX {signed(measure.dx, units)} · ΔY {signed(measure.dy, units)}
      </span>
      {Math.abs(measure.angle) > 1e-6 && (
        <>
          <span className="measure-sep" />
          <span>{measure.angle.toFixed(1)}°</span>
        </>
      )}
      {measure.length !== undefined && (
        <>
          <span className="measure-sep" />
          <span>L {n(measure.length, units)}</span>
        </>
      )}
    </div>
  );
}

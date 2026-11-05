import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeasureOverlay } from './MeasureOverlay';
import { liveMeasure } from '@/workspace/measure';

const start = { left: 0, top: 0, width: 100, height: 50 };

describe('MeasureOverlay', () => {
  it('shows the size and the movement delta', () => {
    render(
      <MeasureOverlay
        measure={liveMeasure(start, { left: 20, top: -10, width: 120, height: 60 }, 0)}
        units="mm"
      />,
    );

    expect(screen.getByText('120.0 × 60.0 mm')).toBeInTheDocument();
    expect(screen.getByText(/ΔX \+20\.0/)).toBeInTheDocument();
    expect(screen.getByText(/ΔY −10\.0/)).toBeInTheDocument();
  });

  it('converts to inches', () => {
    render(
      <MeasureOverlay
        measure={liveMeasure(start, { left: 0, top: 0, width: 25.4, height: 50.8 }, 0)}
        units="in"
      />,
    );
    expect(screen.getByText('1.0 × 2.0 in')).toBeInTheDocument();
  });

  it('shows the angle and line length when available', () => {
    render(
      <MeasureOverlay
        measure={liveMeasure(start, { left: 0, top: 0, width: 10, height: 10 }, 45, 14.142)}
        units="mm"
      />,
    );
    expect(screen.getByText('45.0°')).toBeInTheDocument();
    expect(screen.getByText('L 14.1')).toBeInTheDocument();
  });

  it('hides the angle when the object is not rotated', () => {
    render(<MeasureOverlay measure={liveMeasure(start, start, 0)} units="mm" />);
    expect(screen.queryByText(/°/)).toBeNull();
  });
});

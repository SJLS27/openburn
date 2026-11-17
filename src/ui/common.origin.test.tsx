import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OriginSelect } from './common';

describe('OriginSelect', () => {
  it('offers the four bed corners with the full labels', () => {
    render(<OriginSelect value="bottom-left" onChange={() => {}} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(['bottom-left', 'top-left', 'bottom-right', 'top-right']);
    expect(select.selectedOptions[0].textContent).toBe('Bottom-left (typical GRBL)');
  });

  it('uses short labels in compact mode', () => {
    render(<OriginSelect compact value="top-right" onChange={() => {}} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Bottom-left',
      'Top-left',
      'Bottom-right',
      'Top-right',
    ]);
    expect(select.value).toBe('top-right');
  });

  it('reports the newly picked corner', async () => {
    const onChange = vi.fn();
    render(<OriginSelect value="bottom-left" onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'bottom-right');

    expect(onChange).toHaveBeenCalledWith('bottom-right');
  });
});

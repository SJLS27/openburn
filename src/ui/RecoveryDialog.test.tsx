import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecoveryDialog } from './RecoveryDialog';

const record = {
  document: { format: 'openburn' },
  filePath: '/home/user/designs/plate.obrn',
  savedAt: '2026-11-01T10:15:00.000Z',
};

describe('ui/RecoveryDialog', () => {
  it('shows the draft date and file name', () => {
    render(<RecoveryDialog record={record} onRecover={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByText('plate.obrn')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('recovers or discards the draft', async () => {
    const onRecover = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(
      <RecoveryDialog record={record} onRecover={onRecover} onDiscard={onDiscard} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    expect(onRecover).toHaveBeenCalled();

    rerender(<RecoveryDialog record={record} onRecover={onRecover} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalled();
  });
});

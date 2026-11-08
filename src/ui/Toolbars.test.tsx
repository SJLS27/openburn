import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/state/store';
import { TextToolbar } from './Toolbars';

// The toolbar only forwards patches to the workspace; mounting the real
// controller would drag Fabric in for no benefit.
const mocks = vi.hoisted(() => ({
  applyTextStyle: vi.fn(),
}));

vi.mock('@/ui/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/common')>();
  return {
    ...actual,
    useWorkspace: () => ({ applyTextStyle: mocks.applyTextStyle }),
  };
});

function selectText(count = 1) {
  store.setState({
    selection: {
      count,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      angle: 0,
      layerIds: ['layer-1'],
      overrideCount: 0,
      zOffset: 0,
      cutPriority: 0,
    },
  });
}

beforeEach(() => {
  mocks.applyTextStyle.mockReset();
  store.setState({ selection: null });
});

describe('TextToolbar alignment', () => {
  it('applies left, center and right alignment to the selection', async () => {
    selectText();
    render(<TextToolbar />);

    await userEvent.click(screen.getByTitle('Align text center'));
    expect(mocks.applyTextStyle).toHaveBeenLastCalledWith({ textAlign: 'center' });

    await userEvent.click(screen.getByTitle('Align text right'));
    expect(mocks.applyTextStyle).toHaveBeenLastCalledWith({ textAlign: 'right' });

    await userEvent.click(screen.getByTitle('Align text left'));
    expect(mocks.applyTextStyle).toHaveBeenLastCalledWith({ textAlign: 'left' });
  });

  it('highlights the active alignment', async () => {
    selectText();
    render(<TextToolbar />);

    await userEvent.click(screen.getByTitle('Align text right'));

    expect(screen.getByTitle('Align text right').className).toContain('active');
    expect(screen.getByTitle('Align text left').className).not.toContain('active');
  });

  it('disables the alignment buttons without a selection', () => {
    render(<TextToolbar />);

    expect(screen.getByTitle('Align text left')).toBeDisabled();
    expect(screen.getByTitle('Align text center')).toBeDisabled();
    expect(screen.getByTitle('Align text right')).toBeDisabled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceContext } from './common';
import { WelcomeDialog } from './WelcomeDialog';
import type { WorkspaceApi } from '@/state/store';

const recent = vi.hoisted(() => ({
  items: [
    { path: '/home/user/designs/plate.obrn', name: 'plate.obrn', openedAt: '2026-11-01T10:00:00.000Z' },
    { path: '/tmp/bracket.obrn', name: 'bracket.obrn', openedAt: '2026-10-30T10:00:00.000Z' },
  ],
}));

vi.mock('@/state/recentStore', () => ({
  useRecentFiles: () => recent.items,
}));

function renderWelcome(ws: Partial<WorkspaceApi>) {
  const onClose = vi.fn();
  const api = {
    newDocument: vi.fn(),
    openDocument: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    ...ws,
  } as unknown as WorkspaceApi;
  render(
    <WorkspaceContext.Provider value={api}>
      <WelcomeDialog onClose={onClose} />
    </WorkspaceContext.Provider>,
  );
  return { api, onClose };
}

describe('ui/WelcomeDialog', () => {
  it('lists recent files and opens one', async () => {
    const { api, onClose } = renderWelcome({});

    expect(screen.getByText('plate.obrn')).toBeInTheDocument();
    expect(screen.getByText('bracket.obrn')).toBeInTheDocument();

    await userEvent.click(screen.getByText('plate.obrn'));
    expect(api.openPath).toHaveBeenCalledWith('/home/user/designs/plate.obrn');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts a new design', async () => {
    const { api, onClose } = renderWelcome({});

    await userEvent.click(screen.getByRole('button', { name: 'New Design' }));
    expect(api.newDocument).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the file picker', async () => {
    const { api } = renderWelcome({});

    await userEvent.click(screen.getByRole('button', { name: 'Open Project…' }));
    expect(api.openDocument).toHaveBeenCalled();
  });
});

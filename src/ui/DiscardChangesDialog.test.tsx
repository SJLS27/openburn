import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import {
  registerWorkspaceApi,
  store,
  type WorkspaceApi,
} from '@/state/store';
import {
  requestDiscardConfirmation,
  resetDiscardGuard,
} from '@/state/discardGuard';

function fakeWorkspace(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    newDocument: vi.fn(),
    saveDocument: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as WorkspaceApi;
}

beforeEach(() => {
  store.setState({ dirty: true });
});

afterEach(() => {
  resetDiscardGuard();
  act(() => store.setState({ dirty: false }));
});

describe('ui/DiscardChangesDialog', () => {
  it('resolves the request when the user discards', async () => {
    const pending = requestDiscardConfirmation();
    const onClose = vi.fn();
    render(<DiscardChangesDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await expect(pending).resolves.toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('cancels the request', async () => {
    const pending = requestDiscardConfirmation();
    const onClose = vi.fn();
    render(<DiscardChangesDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(pending).resolves.toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('saves before continuing', async () => {
    const saveDocument = vi.fn(async () => {
      store.setState({ dirty: false });
    });
    registerWorkspaceApi(fakeWorkspace({ saveDocument }));
    const pending = requestDiscardConfirmation();
    const onClose = vi.fn();
    render(<DiscardChangesDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(pending).resolves.toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveDocument).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when saving is cancelled in the native dialog', async () => {
    registerWorkspaceApi(fakeWorkspace({ saveDocument: vi.fn(async () => undefined) }));
    const pending = requestDiscardConfirmation();
    const onClose = vi.fn();
    render(<DiscardChangesDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(onClose).not.toHaveBeenCalled();
    resetDiscardGuard();
    await expect(pending).resolves.toBe(false);
  });
});

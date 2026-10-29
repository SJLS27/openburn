import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  state: {
    current: { status: 'idle', currentVersion: '1.2.3' } as Record<string, unknown>,
  },
  checkForUpdates: vi.fn(async () => undefined),
  installUpdate: vi.fn(async () => undefined),
}));

vi.mock('@/state/updateStore', () => ({
  useUpdateState: () => mocks.state.current,
  checkForUpdates: mocks.checkForUpdates,
  installUpdate: mocks.installUpdate,
  downloadUpdate: vi.fn(),
}));

import { UpdateBanner, UpdateDialog } from '@/ui/UpdateDialog';

beforeEach(() => {
  mocks.state.current = { status: 'idle', currentVersion: '1.2.3' };
  mocks.checkForUpdates.mockClear();
  mocks.installUpdate.mockClear();
});

describe('UpdateBanner', () => {
  it('stays hidden when there is no pending update', () => {
    const { container } = render(<UpdateBanner onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the download progress', () => {
    mocks.state.current = {
      status: 'downloading',
      currentVersion: '1.2.3',
      version: '1.3.0',
      percent: 55,
    };
    render(<UpdateBanner onOpen={() => {}} />);

    expect(screen.getByText(/Downloading OpenBurn/)).toBeInTheDocument();
    expect(screen.getByText(/1\.3\.0/)).toBeInTheDocument();
    expect(screen.getByText(/55%/)).toBeInTheDocument();
  });

  it('offers a restart once the update is downloaded', async () => {
    mocks.state.current = {
      status: 'downloaded',
      currentVersion: '1.2.3',
      version: '1.3.0',
    };
    render(<UpdateBanner onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /Restart & install/ }));
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateDialog', () => {
  it('reports that the app is up to date', () => {
    mocks.state.current = { status: 'not-available', currentVersion: '1.2.3' };
    render(<UpdateDialog onClose={() => {}} />);

    expect(screen.getByText(/You are up to date/)).toBeInTheDocument();
    expect(screen.getByText(/Current version: 1\.2\.3/)).toBeInTheDocument();
  });

  it('explains why updates are disabled in this build', () => {
    mocks.state.current = {
      status: 'disabled',
      currentVersion: '1.2.3',
      message: 'Automatic updates are only available in packaged builds.',
    };
    render(<UpdateDialog onClose={() => {}} />);

    expect(
      screen.getByText(/only available in packaged builds/),
    ).toBeInTheDocument();
  });

  it('shows the error and retries the check', async () => {
    mocks.state.current = {
      status: 'error',
      currentVersion: '1.2.3',
      message: 'network unavailable',
    };
    render(<UpdateDialog onClose={() => {}} />);

    expect(screen.getByText('network unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
  });

  it('offers restart & install when downloaded', async () => {
    mocks.state.current = {
      status: 'downloaded',
      currentVersion: '1.2.3',
      version: '1.3.0',
    };
    render(<UpdateDialog onClose={() => {}} />);

    expect(screen.getByText(/ready to/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Restart & install/ }));
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
  });
});

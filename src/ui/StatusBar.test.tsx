import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/state/store';
import { DEFAULT_SNAP_SETTINGS } from '@/state/snapSettings';
import { SNAP_RADIUS_OPTIONS, StatusBar, snapKindLabel, snapSummary } from './StatusBar';

vi.mock('@/serial/machine', () => ({
  useMachine: () => ({
    connected: false,
    status: 'idle',
    jobActive: false,
    progress: 0,
    jobPaused: false,
    remaining: 0,
    transportName: 'none',
  }),
}));

describe('ui/StatusBar — snap controls', () => {
  beforeEach(() => {
    store.setSnapSettings({ ...DEFAULT_SNAP_SETTINGS });
    store.setState({ snapHint: null });
  });

  afterEach(() => {
    cleanup();
    store.setSnapSettings({ ...DEFAULT_SNAP_SETTINGS });
  });

  it('opens the options popover from the caret button', async () => {
    render(<StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Snap settings' }));
    expect(screen.getByRole('dialog', { name: 'Snap settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Enable snapping')).toBeInTheDocument();
  });

  it('toggles snapping from the main button', async () => {
    render(<StatusBar />);
    const snapButton = screen.getByRole('button', { name: 'Snap', pressed: false });
    await userEvent.click(snapButton);
    expect(store.getState().snapSettings.enabled).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Snap settings' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Snap', pressed: true }));
    expect(store.getState().snapSettings.enabled).toBe(false);
  });

  it('opens the options from the caret and right-click', async () => {
    render(<StatusBar />);
    const snapButton = screen.getByRole('button', { name: 'Snap', pressed: false });
    await userEvent.pointer({ keys: '[MouseRight]', target: snapButton });
    expect(screen.getByRole('dialog', { name: 'Snap settings' })).toBeInTheDocument();
  });

  it('updates the stored settings from the checkboxes', async () => {
    render(<StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Snap settings' }));
    await userEvent.click(screen.getByLabelText('Enable snapping'));
    expect(store.getState().snapSettings.enabled).toBe(true);
    await userEvent.click(screen.getByLabelText('Objects (vertices, centres)'));
    expect(store.getState().snapSettings.objects).toBe(false);
    // The legacy flag mirrors "enabled and grid".
    expect(store.getState().snapToGrid).toBe(true);
  });

  it('lets the capture radius be changed', async () => {
    render(<StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Snap settings' }));
    const select = screen.getByLabelText('Snap radius') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => Number(o.value))).toEqual(SNAP_RADIUS_OPTIONS);
    await userEvent.selectOptions(select, '12');
    expect(store.getState().snapSettings.radiusPx).toBe(12);
  });

  it('shows the active snap kind in the status bar', () => {
    store.setState({ snapHint: { kind: 'vertex', x: 1, y: 2 } });
    render(<StatusBar />);
    expect(screen.getByTestId('snap-hint')).toHaveTextContent('Vertex');
    store.setState({ snapHint: { kind: 'intersection', x: 1, y: 2 } });
    cleanup();
    render(<StatusBar />);
    expect(screen.getByTestId('snap-hint')).toHaveTextContent('Intersection');
  });

  it('closes the popover when clicking outside', async () => {
    render(<StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Snap settings' }));
    expect(screen.getByRole('dialog', { name: 'Snap settings' })).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Snap settings' })).not.toBeInTheDocument();
  });

  it('labels every snap kind', () => {
    expect(snapKindLabel('grid')).toBe('Grid');
    expect(snapKindLabel('midpoint')).toBe('Midpoint');
    expect(snapKindLabel('guide')).toBe('Guide');
    expect(snapKindLabel('center')).toBe('Centre');
  });

  it('summarises the enabled kinds', () => {
    expect(snapSummary(false, { grid: true, objects: true, intersections: true })).toBe('Snapping off');
    expect(snapSummary(true, { grid: true, objects: false, intersections: true })).toBe('Snap: grid');
    expect(snapSummary(true, { grid: true, objects: true, intersections: true })).toBe('Snap: grid, objects, intersections');
    expect(snapSummary(true, { grid: false, objects: false, intersections: false })).toBe('Snap: nothing enabled');
  });
});

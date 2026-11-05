import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/state/store';
import { RightDock } from './RightDock';

// The panel only needs a selection snapshot and a workspace bridge; mounting
// the real controller would drag Fabric in for no benefit.
const mocks = vi.hoisted(() => ({
  applyNumeric: vi.fn(),
}));

vi.mock('@/ui/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/common')>();
  return {
    ...actual,
    useWorkspace: () => ({
      applyNumeric: mocks.applyNumeric,
      flip: vi.fn(),
      rotate: vi.fn(),
      setLayerOfSelection: vi.fn(),
      setSelectionCutPriority: vi.fn(),
      setSelectionZOffset: vi.fn(),
      clearCutOverride: vi.fn(),
    }),
  };
});

// Keep the other dock panels (cuts/layers, materials, laser…) out of the way.
vi.mock('./CutsLayersPanel', () => ({ CutsLayersPanel: () => null }));
vi.mock('./OptimizationDialog', () => ({ OptimizationDialog: () => null }));

function selectSomething(lockAspect = false) {
  const previous = store.getState();
  store.setState({
    lockAspect,
    selection: {
      count: 1,
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      angle: 0,
      layerIds: [previous.activeLayerId],
      overrideCount: 0,
      zOffset: 0,
      cutPriority: 0,
    },
  });
}

/** X, Y, W, H numeric fields of the Shape Properties panel. */
function inputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('#panel-shape .panel-body input.input'),
  );
}

beforeEach(() => {
  mocks.applyNumeric.mockClear();
  selectSomething(false);
});

describe('Shape Properties panel', () => {
  it('sends the numeric position to the workspace', async () => {
    render(<RightDock />);
    const x = inputs()[0];
    await userEvent.clear(x);
    await userEvent.type(x, '42{Enter}');
    expect(mocks.applyNumeric).toHaveBeenCalledWith({ x: 42 });
  });

  it('sends the numeric width to the workspace', async () => {
    render(<RightDock />);
    const w = inputs()[2];
    await userEvent.clear(w);
    await userEvent.type(w, '250{Enter}');
    expect(mocks.applyNumeric).toHaveBeenCalledWith({ width: 250 });
  });

  it('toggles the aspect lock from the W/H row', async () => {
    render(<RightDock />);
    const toggle = screen.getByRole('button', { name: 'Lock aspect ratio' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);

    expect(store.getState().lockAspect).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The lock is editable state, not a document change.
    expect(store.getState().dirty).toBe(false);
  });
});

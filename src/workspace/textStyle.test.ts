// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas, Group, Rect, Textbox } from 'fabric';
import { store } from '@/state/store';
import { WorkspaceController } from './WorkspaceController';

let controller: WorkspaceController;

function text(value = 'Hello') {
  return new Textbox(value, {
    left: 0,
    top: 0,
    width: 60,
    fontSize: 10,
    fontFamily: 'Inter',
    objectCaching: false,
  });
}

beforeEach(() => {
  // Rendering Fabric controls needs a real 2D context; the logic under test
  // only needs the object graph.
  vi.spyOn(Canvas.prototype, 'requestRenderAll').mockImplementation(() => {});
  const host = document.createElement('div');
  const fabricEl = document.createElement('canvas');
  const bgEl = document.createElement('canvas');
  document.body.append(host, fabricEl, bgEl);
  controller = new WorkspaceController(host, fabricEl, bgEl);
});

afterEach(() => {
  vi.restoreAllMocks();
  controller.dispose();
  document.body.innerHTML = '';
});

/** The canvas is private; reach it the same way the app and e2e do. */
function canvasOf(ctrl: WorkspaceController): Canvas {
  return (ctrl as unknown as { canvas: Canvas }).canvas;
}

function select(ctrl: WorkspaceController, ...objs: unknown[]) {
  const canvas = canvasOf(ctrl);
  canvas.setActiveObject(objs[0] as never);
  (canvas.getActiveObjects as unknown as () => unknown[]) = () => objs;
}

describe('WorkspaceController.applyTextStyle (text alignment)', () => {
  it('sets the horizontal alignment on the selected textbox', () => {
    const box = text();
    select(controller, box);

    controller.applyTextStyle({ textAlign: 'center' });
    expect(box.textAlign).toBe('center');

    controller.applyTextStyle({ textAlign: 'right' });
    expect(box.textAlign).toBe('right');

    controller.applyTextStyle({ textAlign: 'left' });
    expect(box.textAlign).toBe('left');
  });

  it('aligns text children of a group', () => {
    const a = text('one');
    const b = text('two');
    const group = new Group([a, b]);
    select(controller, group);

    controller.applyTextStyle({ textAlign: 'center' });
    expect(a.textAlign).toBe('center');
    expect(b.textAlign).toBe('center');
  });

  it('ignores non-text objects and leaves the document clean', () => {
    const rect = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    select(controller, rect);
    store.markDirty(false);

    controller.applyTextStyle({ textAlign: 'right' });

    expect((rect as unknown as { textAlign?: string }).textAlign).toBeUndefined();
    expect(store.getState().dirty).toBe(false);
  });

  it('marks the document dirty so the change is saved', () => {
    const box = text();
    select(controller, box);
    store.markDirty(false);

    controller.applyTextStyle({ textAlign: 'center' });

    expect(store.getState().dirty).toBe(true);
  });

  it('keeps the other style fields intact when only aligning', () => {
    const box = text();
    box.set({ fontSize: 18, fontFamily: 'Arial', fontWeight: '700' });
    select(controller, box);

    controller.applyTextStyle({ textAlign: 'right' });

    expect(box.fontSize).toBe(18);
    expect(box.fontFamily).toBe('Arial');
    expect(box.fontWeight).toBe('700');
    expect(box.textAlign).toBe('right');
  });
});

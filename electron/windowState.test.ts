// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  loadWindowState,
  sanitizeWindowState,
  saveWindowState,
  windowStatePath,
} from './windowState';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary = { x: 1920, y: 0, width: 1280, height: 1024 };

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-window-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('electron/windowState', () => {
  it('restores a window that is visible on a display', () => {
    expect(
      sanitizeWindowState(
        { x: 120, y: 80, width: 1500, height: 900, maximized: false },
        [primary],
      ),
    ).toEqual({ x: 120, y: 80, width: 1500, height: 900, maximized: false });
  });

  it('falls back to a centered default when the saved monitor is gone', () => {
    expect(
      sanitizeWindowState(
        { x: 4000, y: 2500, width: 1200, height: 800, maximized: true },
        [primary],
      ),
    ).toEqual({ ...DEFAULT_WINDOW_SIZE, maximized: true });
  });

  it('keeps a window that is only partially visible', () => {
    const state = sanitizeWindowState(
      { x: 1850, y: 20, width: 1200, height: 800, maximized: false },
      [primary, secondary],
    );
    expect(state.x).toBe(1850);
    expect(state.maximized).toBe(false);
  });

  it('enforces the minimum size', () => {
    const state = sanitizeWindowState(
      { x: 10, y: 10, width: 200, height: 100, maximized: false },
      [primary],
    );
    expect(state.width).toBe(MIN_WINDOW_WIDTH);
    expect(state.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it('shrinks windows larger than the work area', () => {
    const state = sanitizeWindowState(
      { x: 0, y: 0, width: 4000, height: 3000, maximized: false },
      [primary],
    );
    expect(state.width).toBe(primary.width);
    expect(state.height).toBe(primary.height);
  });

  it('ignores corrupted or missing state', () => {
    expect(sanitizeWindowState(null, [primary])).toEqual({
      ...DEFAULT_WINDOW_SIZE,
      maximized: false,
    });
    expect(
      sanitizeWindowState({ x: 'nope', y: NaN, width: -5, height: null }, [primary]),
    ).toEqual({ ...DEFAULT_WINDOW_SIZE, maximized: false });
  });

  it('round-trips through disk and survives a corrupt file', () => {
    const dir = tempDir();
    const file = windowStatePath(dir);
    expect(loadWindowState(file)).toBeNull();

    const state = { x: 10, y: 20, width: 1300, height: 700, maximized: true };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);

    fs.writeFileSync(file, '{not json');
    expect(loadWindowState(file)).toBeNull();
  });
});

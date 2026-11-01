import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_INTERVAL_MS,
  AutosaveScheduler,
} from './autosave';

describe('state/autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid edits into one save', () => {
    const save = vi.fn();
    const scheduler = new AutosaveScheduler(save, { debounceMs: 100, maxIntervalMs: 1000 });

    scheduler.notify();
    vi.advanceTimersByTime(50);
    scheduler.notify();
    vi.advanceTimersByTime(50);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
  });

  it('saves continuously edited documents at the max interval', () => {
    const save = vi.fn();
    const scheduler = new AutosaveScheduler(save, { debounceMs: 100, maxIntervalMs: 500 });

    scheduler.notify();
    // Keep postponing the debounce without waiting for it.
    for (let i = 0; i < 9; i += 1) {
      vi.advanceTimersByTime(50);
      scheduler.notify();
    }
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately when asked', () => {
    const save = vi.fn();
    const scheduler = new AutosaveScheduler(save, { debounceMs: 100, maxIntervalMs: 1000 });
    scheduler.notify();

    scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(9999);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancels pending saves after a manual save', () => {
    const save = vi.fn();
    const scheduler = new AutosaveScheduler(save, { debounceMs: 100, maxIntervalMs: 1000 });
    scheduler.notify();
    scheduler.cancel();

    expect(scheduler.pending).toBe(false);
    vi.advanceTimersByTime(9999);
    expect(save).not.toHaveBeenCalled();
  });

  it('ignores notifications after disposal', () => {
    const save = vi.fn();
    const scheduler = new AutosaveScheduler(save, { debounceMs: 100, maxIntervalMs: 1000 });
    scheduler.dispose();
    scheduler.notify();
    scheduler.flush();

    vi.advanceTimersByTime(9999);
    expect(save).not.toHaveBeenCalled();
  });

  it('exposes defaults that match the documented cadence', () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(2000);
    expect(AUTOSAVE_MAX_INTERVAL_MS).toBe(30000);
  });
});

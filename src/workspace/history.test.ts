import { describe, expect, it } from 'vitest';
import { HistoryBuffer } from './history';

describe('workspace/history', () => {
  it('walks undo and redo stacks', () => {
    const history = new HistoryBuffer();
    expect(history.canUndo).toBe(false);
    expect(history.undo('a')).toBeNull();

    history.push('a');
    history.push('b');
    expect(history.canUndo).toBe(true);
    expect(history.undoCount).toBe(2);

    expect(history.undo('c')).toBe('b');
    expect(history.redoCount).toBe(1);
    expect(history.undo('b')).toBe('a');
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeNull();
  });

  it('drops the redo stack on a new edit', () => {
    const history = new HistoryBuffer();
    history.push('a');
    history.undo('b');
    expect(history.canRedo).toBe(true);

    history.push('x');
    expect(history.canRedo).toBe(false);
    expect(history.redo('y')).toBeNull();
  });

  it('caps the number of entries', () => {
    const history = new HistoryBuffer({ maxEntries: 3, maxBytes: Infinity });
    for (const snap of ['a', 'b', 'c', 'd', 'e']) history.push(snap);

    expect(history.undoCount).toBe(3);
    expect(history.undo('current')).toBe('e');
    expect(history.undo('e')).toBe('d');
    expect(history.undo('d')).toBe('c');
    expect(history.undo('c')).toBeNull();
  });

  it('drops the oldest snapshots when the byte budget is exceeded', () => {
    // Each snapshot is 10 code units → 20 bytes.
    const big = 'x'.repeat(10);
    const history = new HistoryBuffer({ maxBytes: 50, maxEntries: 100 });
    for (const n of ['a', 'b', 'c', 'd', 'e']) history.push(big + n);

    expect(history.bytesUsed).toBeLessThanOrEqual(44);
    expect(history.undoCount).toBe(2);
    expect(history.undo('next')).toBe(big + 'e');
  });

  it('keeps a single snapshot that is larger than the budget', () => {
    const huge = 'x'.repeat(1000);
    const history = new HistoryBuffer({ maxBytes: 100 });
    history.push(huge);

    expect(history.undoCount).toBe(1);
    expect(history.bytesUsed).toBe(huge.length * 2);
    expect(history.undo('next')).toBe(huge);
  });

  it('tracks memory across undo and redo', () => {
    const history = new HistoryBuffer();
    history.push('aaaa');
    expect(history.bytesUsed).toBe(8);

    history.undo('bbbbbb');
    expect(history.bytesUsed).toBe(12);

    history.clear();
    expect(history.bytesUsed).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

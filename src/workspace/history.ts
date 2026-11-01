/**
 * Undo/redo snapshots with a memory budget.
 *
 * Fabric snapshots include embedded images as data URLs, so a handful of
 * edits can easily add up to hundreds of megabytes. Capping the number of
 * entries alone is not enough: this buffer also drops the oldest entries once
 * the approximate UTF-16 payload exceeds `maxBytes`.
 */
export interface HistoryBufferOptions {
  /** Approximate payload budget in bytes (UTF-16, 2 bytes per code unit). */
  maxBytes?: number;
  /** Hard cap on entries per stack. */
  maxEntries?: number;
}

export const DEFAULT_HISTORY_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_HISTORY_MAX_ENTRIES = 100;

function bytesOf(snapshot: string): number {
  return snapshot.length * 2;
}

export class HistoryBuffer {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private undoBytes = 0;
  private redoBytes = 0;

  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(options: HistoryBufferOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_HISTORY_MAX_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES;
  }

  /** Record the snapshot that existed before the current change. */
  push(previous: string): void {
    this.undoStack.push(previous);
    this.undoBytes += bytesOf(previous);
    this.clearRedo();
    this.trimUndo();
  }

  /** Pop the previous snapshot, storing `current` for redo. */
  undo(current: string): string | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.undoBytes -= bytesOf(previous);
    this.redoStack.push(current);
    this.redoBytes += bytesOf(current);
    this.trimRedo();
    return previous;
  }

  /** Pop the next snapshot, storing `current` for undo. */
  redo(current: string): string | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.redoBytes -= bytesOf(next);
    this.undoStack.push(current);
    this.undoBytes += bytesOf(current);
    this.trimUndo();
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.redoBytes = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  /** Approximate payload held by both stacks, in bytes. */
  get bytesUsed(): number {
    return this.undoBytes + this.redoBytes;
  }

  private clearRedo(): void {
    this.redoStack = [];
    this.redoBytes = 0;
  }

  private trimUndo(): void {
    // Always keep the most recent entry, even if it alone exceeds the budget.
    while (
      this.undoStack.length > this.maxEntries ||
      (this.undoBytes > this.maxBytes && this.undoStack.length > 1)
    ) {
      const dropped = this.undoStack.shift()!;
      this.undoBytes -= bytesOf(dropped);
    }
  }

  private trimRedo(): void {
    while (
      this.redoStack.length > this.maxEntries ||
      (this.redoBytes > this.maxBytes && this.redoStack.length > 1)
    ) {
      const dropped = this.redoStack.shift()!;
      this.redoBytes -= bytesOf(dropped);
    }
  }
}

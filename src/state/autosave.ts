/**
 * Debounced autosave timer.
 *
 * Edits are coalesced for `debounceMs`; `maxIntervalMs` guarantees that a
 * document that is edited continuously still reaches disk without waiting for
 * the user to pause.
 */
export interface AutosaveOptions {
  debounceMs?: number;
  maxIntervalMs?: number;
}

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const AUTOSAVE_MAX_INTERVAL_MS = 30000;

export class AutosaveScheduler {
  private debounceTimer: number | null = null;
  private maxTimer: number | null = null;
  private disposed = false;

  private readonly debounceMs: number;
  private readonly maxIntervalMs: number;

  constructor(
    private readonly save: () => void | Promise<void>,
    options: AutosaveOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.maxIntervalMs = options.maxIntervalMs ?? AUTOSAVE_MAX_INTERVAL_MS;
  }

  /** Register another edit; starts the debounce and the long-stop timer. */
  notify(): void {
    if (this.disposed) return;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.flush(), this.debounceMs);
    if (this.maxTimer === null) {
      this.maxTimer = window.setTimeout(() => this.flush(), this.maxIntervalMs);
    }
  }

  /** Save now and reset both timers. */
  flush(): void {
    this.clearTimers();
    if (this.disposed) return;
    void this.save();
  }

  /** Drop pending saves (the document was saved or discarded). */
  cancel(): void {
    this.clearTimers();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  get pending(): boolean {
    return this.debounceTimer !== null || this.maxTimer !== null;
  }

  private clearTimers(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxTimer !== null) {
      window.clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }
}

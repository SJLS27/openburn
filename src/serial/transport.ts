export interface Transport {
  readonly name: string;
  readonly isMock: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: string): Promise<void>;
  onData(handler: (chunk: string) => void): () => void;
  onClose(handler: () => void): () => void;
}

export class WebSerialTransport implements Transport {
  readonly isMock = false;
  readonly name = 'Serial';
  private port: SerialPort;
  private baudRate: number;
  private dataHandlers = new Set<(chunk: string) => void>();
  private closeHandlers = new Set<() => void>();
  private closed = false;
  private readTask: Promise<void> | null = null;

  constructor(port: SerialPort, baudRate: number) {
    this.port = port;
    this.baudRate = baudRate;
  }

  async connect(): Promise<void> {
    await this.port.open({ baudRate: this.baudRate, bufferSize: 2048 });
    this.closed = false;
    this.readTask = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    while (!this.closed && this.port.readable) {
      const reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            const text = decoder.decode(value, { stream: true });
            this.dataHandlers.forEach((h) => h(text));
          }
        }
      } catch {
        // Device unplugged or stream cancelled
      } finally {
        reader.releaseLock();
      }
      if (this.closed) break;
      // Port might remain readable after an error; yield briefly.
      await new Promise((r) => setTimeout(r, 50));
    }
    this.emitClose();
  }

  async write(data: string): Promise<void> {
    if (!this.port.writable) throw new Error('Serial port is not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(data));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    try {
      await this.readTask;
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
    this.emitClose();
  }

  onData(handler: (chunk: string) => void): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private emitClose(): void {
    this.closeHandlers.forEach((h) => h());
  }
}

/**
 * GRBL simulator used when no hardware (or Web Serial) is available. It speaks
 * enough of the protocol to exercise the connection, jog, framing and job
 * streaming UI. Motion is timed (scaled down) so pause/resume behaves like a
 * real controller.
 */
export class MockTransport implements Transport {
  readonly isMock = true;
  readonly name = 'GRBL simulator';
  private dataHandlers = new Set<(chunk: string) => void>();
  private closeHandlers = new Set<() => void>();
  private buffer = '';
  private pollTimer: number | null = null;
  private queueTimer: number | null = null;
  private connected = false;
  private status = 'Idle';
  private paused = false;
  private pos = { x: 0, y: 0, z: 0 };
  private feed = 0;
  private spindle = 0;
  private pending: { at: number; text: string; target?: { x: number; y: number } }[] = [];
  private timeScale = 0.08;

  async connect(): Promise<void> {
    this.connected = true;
    this.pollTimer = window.setInterval(() => this.tick(), 250);
    window.setTimeout(() => this.emit("Grbl 1.1h ['$' for help]\r\n"), 60);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    if (this.queueTimer) window.clearInterval(this.queueTimer);
    this.pollTimer = null;
    this.queueTimer = null;
    this.closeHandlers.forEach((h) => h());
  }

  private tick(): void {
    // Status is answered on demand; nothing to do periodically.
  }

  private emit(text: string): void {
    this.dataHandlers.forEach((h) => h(text));
  }

  private statusLine(): string {
    const x = this.pos.x.toFixed(3);
    const y = this.pos.y.toFixed(3);
    const z = this.pos.z.toFixed(3);
    return `<${this.status}|MPos:${x},${y},${z}|FS:${Math.round(this.feed)},${Math.round(this.spindle)}>\r\n`;
  }

  private scheduleOk(delayMs: number, target?: { x: number; y: number }): void {
    this.status = 'Run';
    this.pending.push({ at: performance.now() + delayMs, text: 'ok\r\n', target });
    this.ensureQueue();
  }

  private ensureQueue(): void {
    if (this.queueTimer) return;
    this.queueTimer = window.setInterval(() => {
      if (this.paused) return;
      const now = performance.now();
      while (this.pending.length > 0 && this.pending[0].at <= now) {
        const entry = this.pending.shift()!;
        if (entry.target) this.pos = { x: entry.target.x, y: entry.target.y, z: this.pos.z };
        this.emit(entry.text);
      }
      if (this.pending.length === 0) {
        if (this.queueTimer) window.clearInterval(this.queueTimer);
        this.queueTimer = null;
        if (this.status === 'Run' || this.status === 'Home') this.status = 'Idle';
      }
    }, 5);
  }

  async write(data: string): Promise<void> {
    if (!this.connected) return;
    for (const byte of data) {
      if (byte === '\x18') {
        this.status = 'Idle';
        this.spindle = 0;
        this.feed = 0;
        this.paused = false;
        this.buffer = '';
        this.pending = [];
        this.emit("Grbl 1.1h ['$' for help]\r\n");
        continue;
      }
      if (byte === '?') {
        this.emit(this.statusLine());
        continue;
      }
      if (byte === '!') {
        this.paused = true;
        this.status = 'Hold';
        continue;
      }
      if (byte === '~') {
        this.paused = false;
        if (this.pending.length > 0) this.status = 'Run';
        this.ensureQueue();
        continue;
      }
      if (byte === '\n' || byte === '\r') {
        const line = this.buffer.trim();
        this.buffer = '';
        if (line) this.handleLine(line);
      } else {
        this.buffer += byte;
      }
    }
  }

  private handleLine(line: string): void {
    if (line.startsWith('$H')) {
      this.status = 'Home';
      window.setTimeout(() => {
        this.pos = { x: 0, y: 0, z: 0 };
        this.status = this.pending.length > 0 ? 'Run' : 'Idle';
        this.emit('ok\r\n');
      }, 220);
      return;
    }
    if (line.startsWith('$X')) {
      this.status = 'Idle';
      this.scheduleOk(3);
      return;
    }
    if (line === '$$') {
      const settings = ['$0=10', '$1=25', '$2=0', '$3=0', '$100=80', '$110=800', '$111=800', '$120=10', '$130=200'];
      window.setTimeout(() => this.emit(`${settings.join('\r\n')}\r\nok\r\n`), 20);
      return;
    }
    if (line === '$G') {
      this.emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\nok\r\n');
      return;
    }
    if (line.startsWith('$J=')) {
      const target = this.moveTarget(line);
      this.scheduleOk(this.motionDelay(target), target);
      return;
    }

    if (/^M5\b/.test(line)) this.spindle = 0;
    if (/^M[34]\b/.test(line)) {
      const m = line.match(/S([\d.]+)/);
      if (m) this.spindle = Number(m[1]);
    }
    if (/^M2\b/.test(line)) {
      this.spindle = 0;
    }

    if (/^(G0|G1|G2|G3)\b/.test(line)) {
      const target = this.moveTarget(line);
      this.scheduleOk(this.motionDelay(target), target);
      return;
    }

    this.scheduleOk(2);
  }

  private moveTarget(line: string): { x: number; y: number } | undefined {
    const x = line.match(/X(-?[\d.]+)/);
    const y = line.match(/Y(-?[\d.]+)/);
    const f = line.match(/F([\d.]+)/);
    if (f) this.feed = Number(f[1]);
    if (!x && !y) return undefined;
    return {
      x: x ? Number(x[1]) : this.pos.x,
      y: y ? Number(y[1]) : this.pos.y,
    };
  }

  private motionDelay(target?: { x: number; y: number }): number {
    if (!target) return 3;
    const dist = Math.hypot(target.x - this.pos.x, target.y - this.pos.y);
    const feed = Math.max(60, this.feed || 3000);
    const ms = (dist / feed) * 60000 * this.timeScale;
    return Math.min(80, Math.max(2, ms));
  }

  onData(handler: (chunk: string) => void): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
}

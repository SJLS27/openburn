import { useSyncExternalStore } from 'react';
import type { JobPlan } from '@/gcode/types';
import {
  IDENTIFY_COMMAND,
  IDENTIFY_TIMEOUT_MS,
  dialectFromLine,
  isChatter,
  jogLines,
  statusPoll,
  type Dialect,
  type FirmwareSetting,
} from './dialect';
import { MockTransport, WebSerialTransport, type Transport } from './transport';
import { portChooser } from './portChooser';

export type MachineStatus =
  | 'disconnected'
  | 'idle'
  | 'run'
  | 'hold'
  | 'jog'
  | 'home'
  | 'alarm'
  | 'door'
  | 'check';

export type LogDirection = 'in' | 'out' | 'info' | 'error';

export interface LogLine {
  id: number;
  dir: LogDirection;
  text: string;
  time: number;
}

export interface PortInfo {
  index: number;
  label: string;
}

export interface JobSummary {
  kind: 'job' | 'frame' | 'macro';
  lines: number;
  seconds: number;
  at: number;
  completed: boolean;
}

export interface MachineState {
  connected: boolean;
  transportName: string;
  isMock: boolean;
  status: MachineStatus;
  mpos: { x: number; y: number; z: number };
  wpos: { x: number; y: number; z: number };
  feed: number;
  spindle: number;
  jobActive: boolean;
  jobPaused: boolean;
  jobKind: 'job' | 'frame' | 'macro' | null;
  jobTotal: number;
  progress: number;
  elapsed: number;
  remaining: number;
  logs: LogLine[];
  lastError: string | null;
  ports: PortInfo[];
  lastJob: JobSummary | null;
}

interface ActiveJob {
  lines: string[];
  total: number;
  sent: number;
  acked: number;
  startedAt: number;
  paused: boolean;
  kind: 'job' | 'frame' | 'macro';
  plan?: JobPlan;
}

const MAX_LOG = 800;
const RX_BUFFER = 120;

function initialLogs(): LogLine[] {
  return [
    {
      id: 0,
      dir: 'info',
      // Build version injected by Vite; never hardcode it here.
      text: `OpenBurn ${__APP_VERSION__} — GRBL console ready`,
      time: Date.now(),
    },
  ];
}

function initialState(): MachineState {
  return {
    connected: false,
    transportName: '',
    isMock: false,
    status: 'disconnected',
    mpos: { x: 0, y: 0, z: 0 },
    wpos: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
    jobActive: false,
    jobPaused: false,
    jobKind: null,
    jobTotal: 0,
    progress: 0,
    elapsed: 0,
    remaining: 0,
    logs: initialLogs(),
    lastError: null,
    ports: [],
    lastJob: null,
  };
}

function mapStatus(raw: string): MachineStatus {
  switch (raw) {
    case 'Run':
      return 'run';
    case 'Hold':
      return 'hold';
    case 'Jog':
      return 'jog';
    case 'Home':
      return 'home';
    case 'Alarm':
      return 'alarm';
    case 'Door':
      return 'door';
    case 'Check':
      return 'check';
    default:
      return 'idle';
  }
}

class Machine {
  private state: MachineState = initialState();
  private listeners = new Set<() => void>();
  private transport: Transport | null = null;
  private serialPorts: SerialPort[] = [];
  /** OS names (/dev/ttyUSB0, COM3) of ports picked in the desktop chooser. */
  private portNames = new WeakMap<SerialPort, string>();
  private buffer = '';
  private job: ActiveJob | null = null;
  private pendingBytes: number[] = [];
  private sentBytes = 0;
  private ackedBytes = 0;
  private pollTimer: number | null = null;
  private progressTimer: number | null = null;
  private logBuffer: LogLine[] = [];
  private logTimer: number | null = null;
  private logCounter = 1;
  /** See serial/dialect.ts. Polling waits until the dialect is known. */
  private firmware: FirmwareSetting = 'auto';
  private dialect: Dialect = 'grbl';
  private dialectKnown = false;
  private identifyTimer: number | null = null;

  getState = (): MachineState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<MachineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------

  private pushLog(dir: LogDirection, text: string): void {
    this.logBuffer.push({ id: this.logCounter++, dir, text, time: Date.now() });
    if (this.logBuffer.length > 400) this.logBuffer.splice(0, this.logBuffer.length - 400);
    if (this.logTimer) return;
    this.logTimer = window.setTimeout(() => {
      this.logTimer = null;
      if (this.logBuffer.length === 0) return;
      const logs = [...this.state.logs, ...this.logBuffer].slice(-MAX_LOG);
      this.logBuffer = [];
      this.setState({ logs });
    }, 120);
  }

  flushLogs(): void {
    if (this.logTimer) {
      window.clearTimeout(this.logTimer);
      this.logTimer = null;
    }
    if (this.logBuffer.length === 0) return;
    const logs = [...this.state.logs, ...this.logBuffer].slice(-MAX_LOG);
    this.logBuffer = [];
    this.setState({ logs });
  }

  clearLogs(): void {
    this.logBuffer = [];
    this.setState({ logs: [] });
  }

  logInfo(text: string): void {
    this.pushLog('info', text);
  }

  // ---------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------

  async refreshPorts(): Promise<void> {
    if (!navigator.serial) {
      this.setState({ ports: [] });
      return;
    }
    try {
      this.serialPorts = await navigator.serial.getPorts();
      const ports = this.serialPorts.map((port, index) => {
        const info = port.getInfo?.() ?? {};
        const vid = info.usbVendorId?.toString(16).padStart(4, '0');
        const pid = info.usbProductId?.toString(16).padStart(4, '0');
        const name = this.portNames.get(port);
        return {
          index,
          label: name ?? (vid && pid ? `USB ${vid}:${pid}` : `Serial port ${index + 1}`),
        };
      });
      this.setState({ ports });
    } catch {
      this.setState({ ports: [] });
    }
  }

  async connectSerial(
    baudRate: number,
    portIndex?: number,
    firmware: FirmwareSetting = 'auto',
  ): Promise<void> {
    if (!navigator.serial) {
      throw new Error('Web Serial is not available in this environment');
    }
    let port: SerialPort;
    if (portIndex !== undefined && this.serialPorts[portIndex]) {
      port = this.serialPorts[portIndex];
    } else {
      port = await this.askForPort();
    }
    const transport = new WebSerialTransport(port, baudRate, this.portNames.get(port));
    this.firmware = firmware;
    await this.attach(transport);
    await this.refreshPorts();
  }

  async requestPort(): Promise<void> {
    if (!navigator.serial) throw new Error('Web Serial is not available');
    const port = await this.askForPort();
    this.serialPorts = [...this.serialPorts.filter((p) => p !== port), port];
    await this.refreshPorts();
  }

  private async askForPort(): Promise<SerialPort> {
    const port = await navigator.serial!.requestPort();
    const choice = portChooser.takeLastChoice();
    if (choice) this.portNames.set(port, choice.name);
    return port;
  }

  async connectMock(): Promise<void> {
    this.firmware = 'grbl';
    await this.attach(new MockTransport());
  }

  private async attach(transport: Transport): Promise<void> {
    await this.disconnect(false);
    this.transport = transport;
    transport.onData(this.handleData);
    transport.onClose(() => this.handleTransportClosed());
    await transport.connect();
    this.setState({
      connected: true,
      transportName: transport.name,
      isMock: transport.isMock,
      status: 'idle',
      lastError: null,
    });
    this.pushLog('info', `Connected to ${transport.name}`);
    this.identify();
    this.startPolling();
  }

  /** Settle the dialect: forced by the device setting, or asked with $I. */
  private identify(): void {
    this.dialect = 'grbl';
    this.dialectKnown = false;
    if (this.firmware !== 'auto') {
      this.setDialect(this.firmware);
      return;
    }
    // A board that resets on open (Arduino) misses the $I and stays GRBL.
    this.identifyTimer = window.setTimeout(() => {
      this.identifyTimer = null;
      this.dialectKnown = true;
    }, IDENTIFY_TIMEOUT_MS);
    void this.writeRaw(IDENTIFY_COMMAND);
  }

  private setDialect(dialect: Dialect): void {
    if (this.identifyTimer) window.clearTimeout(this.identifyTimer);
    this.identifyTimer = null;
    this.dialectKnown = true;
    if (dialect === this.dialect) return;
    this.dialect = dialect;
    if (dialect === 'xtool') this.pushLog('info', 'Using xTool command set');
  }

  async disconnect(log = true): Promise<void> {
    this.stopJob(false);
    this.stopPolling();
    if (this.identifyTimer) window.clearTimeout(this.identifyTimer);
    this.identifyTimer = null;
    if (this.transport) {
      try {
        await this.transport.disconnect();
      } catch {
        /* ignore */
      }
      this.transport = null;
      if (log) this.pushLog('info', 'Disconnected');
    }
    this.setState({
      connected: false,
      transportName: '',
      isMock: false,
      status: 'disconnected',
      feed: 0,
      spindle: 0,
    });
  }

  private handleTransportClosed(): void {
    if (!this.transport) return;
    this.transport = null;
    this.stopPolling();
    this.job = null;
    this.setState({
      connected: false,
      transportName: '',
      isMock: false,
      status: 'disconnected',
      jobActive: false,
      jobPaused: false,
      jobKind: null,
    });
    this.pushLog('error', 'Device disconnected');
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      if (!this.transport || !this.dialectKnown) return;
      const poll = statusPoll(this.dialect, this.job !== null);
      if (poll) void this.writeRaw(poll);
    }, 250);
  }

  private stopPolling(): void {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // ---------------------------------------------------------------------
  // Incoming data
  // ---------------------------------------------------------------------

  private handleData = (chunk: string): void => {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const raw = this.buffer.slice(0, index).replace(/\r/g, '').trim();
      this.buffer = this.buffer.slice(index + 1);
      if (raw) this.handleLine(raw);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > 4096) this.buffer = '';
  };

  private handleLine(line: string): void {
    if (isChatter(line)) return;
    const dialect = dialectFromLine(line);
    if (dialect && this.firmware === 'auto' && !this.dialectKnown) this.setDialect(dialect);
    if (line.startsWith('<')) {
      this.parseStatus(line);
      return;
    }
    if (line === 'ok') {
      this.handleOk();
      return;
    }
    if (line.toLowerCase().startsWith('error')) {
      this.pushLog('error', line);
      this.setState({ lastError: line });
      if (this.job) {
        this.pushLog('error', 'Job aborted due to controller error');
        this.stopJob(false);
      }
      return;
    }
    if (line.startsWith('ALARM')) {
      this.pushLog('error', line);
      this.setState({ status: 'alarm', lastError: line });
      if (this.job) this.stopJob(false);
      return;
    }
    if (line.startsWith('[MSG:')) {
      this.pushLog('info', line);
      return;
    }
    this.pushLog('in', line);
  }

  private parseStatus(line: string): void {
    const body = line.replace(/^</, '').replace(/>.*$/, '');
    const parts = body.split('|');
    // xTool reports '<MPos:…>' with no state word; keep the current status.
    const hasState = !(parts[0] ?? '').includes(':');
    const status = hasState ? mapStatus(parts[0] ?? 'Idle') : this.state.status;
    let mpos = this.state.mpos;
    let wpos = this.state.wpos;
    let feed = this.state.feed;
    let spindle = this.state.spindle;

    for (const part of hasState ? parts.slice(1) : parts) {
      if (part.startsWith('MPos:')) {
        const [x, y, z] = part.slice(5).split(',').map(Number);
        mpos = { x: x || 0, y: y || 0, z: z || 0 };
      } else if (part.startsWith('WPos:')) {
        const [x, y, z] = part.slice(5).split(',').map(Number);
        wpos = { x: x || 0, y: y || 0, z: z || 0 };
      } else if (part.startsWith('FS:')) {
        const [f, s] = part.slice(3).split(',').map(Number);
        feed = f || 0;
        spindle = s || 0;
      }
    }

    this.setState({ status, mpos, wpos, feed, spindle });
    if (status === 'run' && this.job) {
      // keep paused flag in sync if the controller resumes externally
    }
  }

  private handleOk(): void {
    if (this.pendingBytes.length > 0) {
      this.ackedBytes += this.pendingBytes.shift()!;
    }
    if (this.job) {
      this.job.acked += 1;
      if (this.job.acked >= this.job.total) {
        this.finishJob();
        return;
      }
    }
    this.pump();
  }

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------

  private async writeRaw(data: string): Promise<void> {
    if (!this.transport) return;
    try {
      await this.transport.write(data);
    } catch (err) {
      this.pushLog('error', `Write failed: ${(err as Error).message}`);
      this.handleTransportClosed();
    }
  }

  sendCommand(line: string): void {
    if (!this.transport) {
      this.pushLog('error', 'Not connected');
      return;
    }
    if (this.job) {
      this.pushLog('error', 'Wait for the current job to finish (use Pause/Stop)');
      return;
    }
    this.pushLog('out', line);
    void this.writeRaw(`${line}\n`);
  }

  jog(dx: number, dy: number, feed = 1000): void {
    this.sendLines(jogLines(this.dialect, dx, dy, feed));
  }

  /** Like sendCommand for a short program, written in one go. */
  private sendLines(lines: string[]): void {
    if (!this.transport) {
      this.pushLog('error', 'Not connected');
      return;
    }
    if (this.job) {
      this.pushLog('error', 'Wait for the current job to finish (use Pause/Stop)');
      return;
    }
    lines.forEach((line) => this.pushLog('out', line));
    void this.writeRaw(lines.map((line) => `${line}\n`).join(''));
  }

  home(): void {
    this.sendCommand('$H');
  }

  unlock(): void {
    this.sendCommand('$X');
  }

  setWorkOrigin(): void {
    this.sendCommand('G10 L20 P1 X0 Y0');
  }

  laserOn(power: number, mode: 'M3' | 'M4' = 'M3'): void {
    this.sendCommand(`${mode} S${Math.max(0, Math.round(power))}`);
  }

  laserOff(): void {
    this.sendCommand('M5');
  }

  // ---------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------

  startPlan(plan: JobPlan, kind: 'job' | 'frame' = 'job'): void {
    this.runLines(plan.gcode, kind, plan);
  }

  runMacro(lines: string[]): void {
    this.runLines(lines, 'macro');
  }

  private runLines(lines: string[], kind: 'job' | 'frame' | 'macro', plan?: JobPlan): void {
    if (!this.transport) {
      this.pushLog('error', 'Connect a device before running a job');
      return;
    }
    if (this.job) {
      this.pushLog('error', 'A job is already running');
      return;
    }

    this.job = {
      lines,
      total: lines.length,
      sent: 0,
      acked: 0,
      startedAt: Date.now(),
      paused: false,
      kind,
      plan,
    };
    this.pendingBytes = [];
    this.sentBytes = 0;
    this.ackedBytes = 0;

    this.setState({
      jobActive: true,
      jobPaused: false,
      jobKind: kind,
      jobTotal: lines.length,
      progress: 0,
      elapsed: 0,
      remaining: plan?.timeSeconds ?? 0,
      lastError: null,
    });
    this.pushLog('info', `${kind === 'frame' ? 'Framing' : kind === 'macro' ? 'Macro' : 'Job'} started (${lines.length} lines)`);
    this.startProgressTimer();
    this.pump();
  }

  private pump(): void {
    const job = this.job;
    if (!job || !this.transport || job.paused) return;

    while (
      this.sentBytes - this.ackedBytes < RX_BUFFER &&
      job.sent < job.total
    ) {
      const line = job.lines[job.sent];
      job.sent += 1;
      const size = line.length + 1;
      this.pendingBytes.push(size);
      this.sentBytes += size;
      if (job.sent <= 20 || job.sent % 50 === 0) {
        this.pushLog('out', line);
      }
      void this.writeRaw(`${line}\n`);
    }

    if (job.acked >= job.total) this.finishJob();
  }

  private startProgressTimer(): void {
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    this.progressTimer = window.setInterval(() => this.updateProgress(), 180);
  }

  private updateProgress(): void {
    const job = this.job;
    if (!job) return;
    const elapsed = (Date.now() - job.startedAt) / 1000;
    const progress = job.total > 0 ? job.acked / job.total : 0;
    const planned = job.plan?.timeSeconds ?? 0;
    const remaining =
      progress > 0.02 ? Math.max(0, elapsed * (1 - progress) / progress) : Math.max(0, planned);
    this.setState({
      progress,
      elapsed,
      remaining,
      jobPaused: job.paused,
    });
  }

  private finishJob(): void {
    const job = this.job;
    if (!job) return;
    const seconds = (Date.now() - job.startedAt) / 1000;
    this.job = null;
    this.pendingBytes = [];
    this.sentBytes = 0;
    this.ackedBytes = 0;
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    this.progressTimer = null;
    this.setState({
      jobActive: false,
      jobPaused: false,
      jobKind: null,
      progress: 1,
      elapsed: seconds,
      remaining: 0,
      lastJob: {
        kind: job.kind,
        lines: job.total,
        seconds,
        at: Date.now(),
        completed: true,
      },
    });
    this.pushLog('info', `Job complete in ${seconds.toFixed(1)}s`);
  }

  pauseJob(): void {
    if (!this.job || this.job.paused) return;
    this.job.paused = true;
    void this.writeRaw('!');
    this.setState({ jobPaused: true, status: 'hold' });
    this.pushLog('info', 'Feed hold');
  }

  resumeJob(): void {
    if (!this.job || !this.job.paused) return;
    this.job.paused = false;
    void this.writeRaw('~');
    this.setState({ jobPaused: false });
    this.pushLog('info', 'Resume');
    this.pump();
  }

  stopJob(log = true): void {
    if (!this.job) return;
    const job = this.job;
    this.job = null;
    this.pendingBytes = [];
    this.sentBytes = 0;
    this.ackedBytes = 0;
    void this.writeRaw('!');
    window.setTimeout(() => void this.writeRaw('\x18'), 120);
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    this.progressTimer = null;
    this.setState({
      jobActive: false,
      jobPaused: false,
      jobKind: null,
      progress: 0,
      elapsed: 0,
      remaining: 0,
      status: 'idle',
      lastJob: {
        kind: job.kind,
        lines: job.total,
        seconds: (Date.now() - job.startedAt) / 1000,
        at: Date.now(),
        completed: false,
      },
    });
    if (log) this.pushLog('info', 'Job stopped');
  }
}

export const machine = new Machine();

export function useMachine(): MachineState {
  return useSyncExternalStore(machine.subscribe, machine.getState, machine.getState);
}

/** Subscribe to a derived value; avoids re-rendering on unrelated machine updates. */
export function useMachineSelector<T>(selector: (state: MachineState) => T): T {
  return useSyncExternalStore(
    machine.subscribe,
    () => selector(machine.getState()),
    () => selector(machine.getState()),
  );
}

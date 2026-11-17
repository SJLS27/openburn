import { describe, expect, it } from 'vitest';
import { machine } from './machine';

describe('machine console', () => {
  it('greets with the build version, not a hardcoded one (regression)', () => {
    const first = machine.getState().logs[0];
    expect(first?.dir).toBe('info');
    expect(first?.text).toContain(`OpenBurn ${__APP_VERSION__}`);
    expect(first?.text).toContain('GRBL console ready');
    // The old literal stayed at 0.6.1 while the app moved on.
    expect(first?.text).not.toContain('0.6.1');
  });
});

import { afterEach, beforeEach, vi } from 'vitest';
import type { FirmwareSetting } from './dialect';
import type { Transport } from './transport';

/** Records writes and lets a test play controller replies. */
class FakeTransport implements Transport {
  readonly name = 'Fake';
  readonly isMock = false;
  writes: string[] = [];
  private data = new Set<(chunk: string) => void>();
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async write(data: string): Promise<void> {
    this.writes.push(data);
  }
  onData(h: (chunk: string) => void) {
    this.data.add(h);
    return () => this.data.delete(h);
  }
  onClose() {
    return () => undefined;
  }
  reply(text: string): void {
    this.data.forEach((h) => h(text));
  }
}

async function connect(firmware: FirmwareSetting = 'auto'): Promise<FakeTransport> {
  const t = new FakeTransport();
  const m = machine as unknown as { firmware: FirmwareSetting; attach(t: Transport): Promise<void> };
  m.firmware = firmware;
  await m.attach(t);
  return t;
}

describe('machine controller dialects', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    await machine.disconnect(false);
    vi.useRealTimers();
  });

  it('asks the controller to identify itself before polling', async () => {
    const t = await connect();
    expect(t.writes).toEqual(['\n$I\n']);
    vi.advanceTimersByTime(1000);
    expect(t.writes).toEqual(['\n$I\n']);
  });

  it('keeps stock GRBL behaviour once identified', async () => {
    const t = await connect();
    t.reply('[VER:1.1h.20190825:]\n[OPT:V,15,128]\nok\n');
    t.writes = [];
    vi.advanceTimersByTime(260);
    expect(t.writes).toEqual(['?']);
    t.writes = [];
    machine.jog(10, 0, 600);
    expect(t.writes).toEqual(['$J=G91 X10 F600\n']);
  });

  it('falls back to stock GRBL when nothing answers (board still resetting)', async () => {
    const t = await connect();
    vi.advanceTimersByTime(1800);
    expect(t.writes.at(-1)).toBe('?');
  });

  it('switches to the xTool command set when the controller says so', async () => {
    const t = await connect();
    t.reply('ok\nok\n[XTool D1:ver 40.30.002.01 B1]\n');
    t.writes = [];
    vi.advanceTimersByTime(260);
    expect(t.writes).toEqual(['?\n']);

    t.reply('ok\n<MPos:-15.000000,4.500000,0.000000,0.000000>\nok:IDLE\n');
    expect(machine.getState().mpos).toEqual({ x: -15, y: 4.5, z: 0 });
    expect(machine.getState().status).toBe('idle');

    t.writes = [];
    machine.jog(0, -10, 6000);
    expect(t.writes).toEqual(['G91\nG1 Y-10 F6000 S0\nG90\nM2\n']);
  });

  it('honours a forced firmware setting without asking', async () => {
    const t = await connect('xtool');
    vi.advanceTimersByTime(260);
    expect(t.writes).toEqual(['?\n']);
  });

  it('forced GRBL behaves exactly as before: no $I, bare ? polls', async () => {
    const t = await connect('grbl');
    vi.advanceTimersByTime(260);
    expect(t.writes).toEqual(['?']);
  });
});

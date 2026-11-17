// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { WebSerialTransport } from './transport';

/** A Web Serial port backed by real streams that never receives data. */
function idlePort() {
  const written: string[] = [];
  let open = false;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open() {
      open = true;
      // Like an idle controller: read() stays pending until cancelled.
      port.readable = new ReadableStream<Uint8Array>();
      port.writable = new WritableStream<Uint8Array>({
        async write(chunk) {
          await new Promise((r) => setTimeout(r, 5));
          written.push(new TextDecoder().decode(chunk));
        },
      });
    },
    async close() {
      if (port.readable?.locked) throw new Error('readable is locked');
      open = false;
    },
    getInfo: () => ({}),
  };
  return { port: port as unknown as SerialPort, written, isOpen: () => open };
}

describe('WebSerialTransport', () => {
  it('closes the port on disconnect even when no data is arriving (regression)', async () => {
    const { port, isOpen } = idlePort();
    const transport = new WebSerialTransport(port, 115200);
    await transport.connect();
    const result = await Promise.race([
      transport.disconnect().then(() => 'closed'),
      new Promise((r) => setTimeout(() => r('hung'), 500)),
    ]);
    expect(result).toBe('closed');
    expect(isOpen()).toBe(false);
  });

  it('queues overlapping writes instead of failing on the locked writer (regression)', async () => {
    const { port, written } = idlePort();
    const transport = new WebSerialTransport(port, 115200);
    await transport.connect();
    await Promise.all([transport.write('?'), transport.write('G0 X1\n'), transport.write('?')]);
    expect(written).toEqual(['?', 'G0 X1\n', '?']);
    await transport.disconnect();
  });

  it('names itself after the chosen port', () => {
    expect(new WebSerialTransport(idlePort().port, 115200, '/dev/ttyUSB0').name).toBe('/dev/ttyUSB0');
    expect(new WebSerialTransport(idlePort().port, 115200).name).toBe('Serial');
  });
});

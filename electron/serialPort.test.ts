// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SerialPortBroker, describeSerialPorts, describeUsbDevice, pickSerialPort } from './serialPort';

describe('pickSerialPort', () => {
  it('prefers a USB adapter over the motherboard serial port listed first (regression)', () => {
    const ports = [
      { portId: 'a', portName: 'ttyS0' },
      { portId: 'b', portName: 'ttyUSB0', vendorId: '6790', productId: '29987' },
    ];
    expect(pickSerialPort(ports)?.portId).toBe('b');
  });

  it('falls back to USB-looking names when vendor ids are missing', () => {
    const ports = [
      { portId: 'a', portName: 'ttyS0' },
      { portId: 'b', portName: 'ttyS1' },
      { portId: 'c', portName: 'ttyACM0' },
    ];
    expect(pickSerialPort(ports)?.portId).toBe('c');
  });

  it('accepts a Windows COM port', () => {
    expect(pickSerialPort([{ portId: 'a', portName: 'COM3' }])?.portId).toBe('a');
  });

  it('recommends nothing when only built-in UARTs exist', () => {
    expect(pickSerialPort([{ portId: 'a', portName: 'ttyS0' }])).toBeUndefined();
    expect(pickSerialPort([])).toBeUndefined();
  });
});

describe('describeSerialPorts', () => {
  it('lists USB ports first with full device paths on Linux', () => {
    const request = describeSerialPorts(
      7,
      [
        { portId: 'a', portName: 'ttyS0' },
        { portId: 'b', portName: 'ttyUSB0', displayName: 'USB Serial', vendorId: '6790', productId: '29987' },
      ],
      'linux',
    );
    expect(request).toEqual({
      requestId: 7,
      recommendedId: 'b',
      ports: [
        { portId: 'b', name: '/dev/ttyUSB0', description: 'CH340 USB serial (QinHeng) · 1a86:7523', usb: true },
        { portId: 'a', name: '/dev/ttyS0', description: '', usb: false },
      ],
    });
  });

  it('keeps Windows names as they are', () => {
    const request = describeSerialPorts(1, [{ portId: 'a', portName: 'COM3' }], 'win32');
    expect(request.ports[0]?.name).toBe('COM3');
  });
});

describe('SerialPortBroker', () => {
  it('routes the renderer answer to the matching callback', () => {
    const broker = new SerialPortBroker();
    const send = vi.fn();
    const callback = vi.fn();
    broker.open([{ portId: 'p1', portName: 'ttyUSB0' }], send, callback);
    const { requestId } = send.mock.calls[0]![0];
    broker.resolve(requestId + 1, 'p1');
    expect(callback).not.toHaveBeenCalled();
    broker.resolve(requestId, 'p1');
    expect(callback).toHaveBeenCalledWith('p1');
  });

  it('treats a dismissed chooser as a cancelled request', () => {
    const broker = new SerialPortBroker();
    const send = vi.fn();
    const callback = vi.fn();
    broker.open([], send, callback);
    broker.resolve(send.mock.calls[0]![0].requestId, null);
    expect(callback).toHaveBeenCalledWith('');
  });

  it('cancels an abandoned request when a new one opens', () => {
    const broker = new SerialPortBroker();
    const first = vi.fn();
    broker.open([], vi.fn(), first);
    broker.open([], vi.fn(), vi.fn());
    expect(first).toHaveBeenCalledWith('');
  });
});

describe('describeUsbDevice', () => {
  // Real values Electron reported for an xTool D1 (decimal ids).
  const d1 = { portId: 'x', portName: 'ttyUSB0', displayName: 'USB Serial', vendorId: '6790', productId: '29987' };

  it('names known USB serial chips like lsusb does', () => {
    expect(describeUsbDevice(d1)).toBe('CH340 USB serial (QinHeng) · 1a86:7523');
    expect(describeUsbDevice({ portId: 'y', vendorId: String(0x10c4), productId: String(0xea60) })).toBe(
      'CP210x USB serial (Silicon Labs) · 10c4:ea60',
    );
  });

  it('matches any product from vendors that only make boards', () => {
    expect(describeUsbDevice({ portId: 'z', vendorId: String(0x2341), productId: String(0x0043) })).toBe(
      'Arduino board (Arduino) · 2341:0043',
    );
  });

  it('falls back to the device name, then a generic label', () => {
    expect(describeUsbDevice({ ...d1, vendorId: '1', productId: '2' })).toBe('USB Serial · 0001:0002');
    expect(describeUsbDevice({ portId: 'q', portName: 'ttyACM0' })).toBe('USB serial device');
  });
});

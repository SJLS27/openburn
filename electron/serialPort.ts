/** Minimal shape of the ports Electron passes to 'select-serial-port'. */
export interface SerialPortCandidate {
  portId: string;
  portName?: string;
  displayName?: string;
  vendorId?: string;
  productId?: string;
}

/** A port as shown in the renderer's chooser. */
export interface SerialPortChoice {
  portId: string;
  /** OS name of the port: /dev/ttyUSB0, COM3, /dev/cu.usbserial-1410… */
  name: string;
  /** What the device is, e.g. "CH340 USB serial (QinHeng) · 1a86:7523". */
  description: string;
  usb: boolean;
}

export interface SerialPortRequest {
  requestId: number;
  ports: SerialPortChoice[];
  /** Port to preselect, or null when none looks like a laser. */
  recommendedId: string | null;
}

// USB serial chips and boards commonly found in GRBL lasers, keyed by
// hex vendor id, then product id ('*' = any product from that vendor).
const USB_DEVICES: Record<string, { vendor: string; products: Record<string, string> }> = {
  '1a86': {
    vendor: 'QinHeng',
    products: { '7523': 'CH340 USB serial', '5523': 'CH341 USB serial', '55d4': 'CH9102 USB serial' },
  },
  '0403': {
    vendor: 'FTDI',
    products: { '6001': 'FT232R USB serial', '6015': 'FT231X USB serial', '6010': 'FT2232 USB serial' },
  },
  '10c4': { vendor: 'Silicon Labs', products: { ea60: 'CP210x USB serial' } },
  '067b': { vendor: 'Prolific', products: { '2303': 'PL2303 USB serial' } },
  '2341': { vendor: 'Arduino', products: { '*': 'Arduino board' } },
  '2a03': { vendor: 'Arduino', products: { '*': 'Arduino board' } },
  '0483': { vendor: 'STMicroelectronics', products: { '5740': 'STM32 virtual COM port' } },
  '303a': { vendor: 'Espressif', products: { '*': 'ESP32 USB serial' } },
  '2e8a': { vendor: 'Raspberry Pi', products: { '*': 'RP2040 board' } },
  '1d50': { vendor: 'OpenMoko', products: { '6015': 'Smoothieboard' } },
};

/**
 * Electron reports USB ids as decimal strings ("6790"); turn one into the
 * 4-digit hex form lsusb and datasheets use ("1a86").
 */
function hexId(id: string | undefined): string | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return Number(id).toString(16).padStart(4, '0');
}

/** "CH340 USB serial (QinHeng) · 1a86:7523", or a generic fallback. */
export function describeUsbDevice(port: SerialPortCandidate): string {
  const vid = hexId(port.vendorId);
  const pid = hexId(port.productId);
  const ids = vid && pid ? ` · ${vid}:${pid}` : '';
  const known = vid ? USB_DEVICES[vid] : undefined;
  const product = known && pid ? (known.products[pid] ?? known.products['*']) : undefined;
  if (known && product) return `${product} (${known.vendor})${ids}`;
  // The device's own name is often just "USB Serial"; still better than nothing.
  if (port.displayName && port.displayName !== port.portName) return `${port.displayName}${ids}`;
  return `USB serial device${ids}`;
}

// USB-to-serial adapters and native USB CDC devices across platforms.
const USB_NAME = /ttyUSB|ttyACM|usbserial|usbmodem|cu\.wch|wchusbserial/i;
// Built-in UARTs that are never a laser (Linux /dev/ttyS*, macOS Bluetooth).
const BUILTIN_NAME = /^(\/dev\/)?ttyS\d+$|bluetooth|debug-console/i;

const rawName = (p: SerialPortCandidate) => p.portName ?? p.displayName ?? '';
const isUsb = (p: SerialPortCandidate) => Boolean(p.vendorId) || USB_NAME.test(rawName(p));

/**
 * Choose the port most likely to be a GRBL controller. USB devices win, and
 * motherboard UARTs (ttyS0) are never recommended: picking one connects
 * "successfully" but sends GCode nowhere.
 */
export function pickSerialPort<T extends SerialPortCandidate>(ports: T[]): T | undefined {
  return (
    ports.find((p) => p.vendorId) ??
    ports.find((p) => USB_NAME.test(rawName(p))) ??
    ports.find((p) => !BUILTIN_NAME.test(rawName(p)))
  );
}

/** Build the chooser payload: USB ports first, the recommended one preselected. */
export function describeSerialPorts(
  requestId: number,
  ports: SerialPortCandidate[],
  platform: string = process.platform,
): SerialPortRequest {
  const choices = ports.map((p): SerialPortChoice => {
    const raw = rawName(p) || p.portId;
    const name = platform === 'linux' && !raw.includes('/') ? `/dev/${raw}` : raw;
    const usb = isUsb(p);
    const description = usb
      ? describeUsbDevice(p)
      : p.displayName && p.displayName !== raw
        ? p.displayName
        : '';
    return { portId: p.portId, name, description, usb };
  });
  choices.sort((a, b) => Number(b.usb) - Number(a.usb));
  return { requestId, ports: choices, recommendedId: pickSerialPort(ports)?.portId ?? null };
}

/**
 * Tracks port requests between Electron's 'select-serial-port' event and the
 * renderer's chooser dialog, so each answer reaches the right callback.
 */
export class SerialPortBroker {
  private nextId = 1;
  private pending = new Map<number, (portId: string) => void>();

  open(
    ports: SerialPortCandidate[],
    send: (request: SerialPortRequest) => void,
    callback: (portId: string) => void,
  ): void {
    // Chromium only allows one chooser at a time; drop any abandoned one.
    this.cancelAll();
    const requestId = this.nextId++;
    this.pending.set(requestId, callback);
    send(describeSerialPorts(requestId, ports));
  }

  /** Answer a request; null or an unknown port cancels it. */
  resolve(requestId: number, portId: string | null): void {
    const callback = this.pending.get(requestId);
    if (!callback) return;
    this.pending.delete(requestId);
    callback(portId ?? '');
  }

  cancelAll(): void {
    for (const callback of this.pending.values()) callback('');
    this.pending.clear();
  }
}

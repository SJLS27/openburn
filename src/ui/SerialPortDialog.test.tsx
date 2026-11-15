import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portChooser } from '@/serial/portChooser';
import { SerialPortDialog } from './SerialPortDialog';

let emit: (request: OpenBurnSerialPortRequest) => void = () => undefined;
const choosePort = vi.fn();

const request: OpenBurnSerialPortRequest = {
  requestId: 3,
  recommendedId: 'usb',
  ports: [
    { portId: 'usb', name: '/dev/ttyUSB0', description: 'CH340 USB serial (QinHeng) · 1a86:7523', usb: true },
    // Linux lists /dev/ttyS0-31 on most PCs.
    ...Array.from({ length: 32 }, (_, i) => ({
      portId: `uart${i}`,
      name: `/dev/ttyS${i}`,
      description: '',
      usb: false,
    })),
  ],
};

beforeEach(() => {
  choosePort.mockReset();
  (window as unknown as { openburn: unknown }).openburn = {
    serial: {
      onChoosePort: (cb: typeof emit) => {
        emit = cb;
        return () => undefined;
      },
      choosePort,
    },
  };
});

afterEach(() => {
  portChooser.dispose();
  delete (window as unknown as { openburn?: unknown }).openburn;
});

describe('SerialPortDialog', () => {
  it('stays hidden until the app asks for a port', () => {
    render(<SerialPortDialog />);
    expect(screen.queryByText('Choose serial port')).toBeNull();
  });

  it('lists only the USB port, described, and preselected', async () => {
    render(<SerialPortDialog />);
    act(() => emit(request));
    expect(screen.getByText('/dev/ttyUSB0')).toBeTruthy();
    expect(screen.getByText('CH340 USB serial (QinHeng) · 1a86:7523')).toBeTruthy();
    expect(screen.queryByText('/dev/ttyS0')).toBeNull();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(1);
    expect(radios[0]!.checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(choosePort).toHaveBeenCalledWith(3, 'usb');
    expect(portChooser.takeLastChoice()?.name).toBe('/dev/ttyUSB0');
    expect(screen.queryByText('Choose serial port')).toBeNull();
  });

  it('can reveal and pick a built-in port', async () => {
    render(<SerialPortDialog />);
    act(() => emit(request));
    await userEvent.click(screen.getByRole('button', { name: 'Show 32 built-in ports' }));
    expect(screen.getAllByRole('radio')).toHaveLength(33);
    expect(screen.getAllByText('Built-in serial port, usually not a laser')).toHaveLength(32);
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(choosePort).toHaveBeenCalledWith(3, 'uart0');
  });

  it('shows every port when none of them is USB', () => {
    render(<SerialPortDialog />);
    act(() =>
      emit({ requestId: 5, recommendedId: null, ports: request.ports.filter((p) => !p.usb) }),
    );
    expect(screen.getByText(/No USB serial ports found/)).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(32);
    expect(screen.queryByRole('button', { name: /built-in ports/ })).toBeNull();
  });

  it('cancels the request when dismissed', async () => {
    render(<SerialPortDialog />);
    act(() => emit(request));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(choosePort).toHaveBeenCalledWith(3, null);
    expect(portChooser.takeLastChoice()).toBeNull();
  });

  it('explains an empty port list', () => {
    render(<SerialPortDialog />);
    act(() => emit({ requestId: 4, recommendedId: null, ports: [] }));
    expect(screen.getByText(/No serial ports found/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

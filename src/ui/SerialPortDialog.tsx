import { useEffect, useState } from 'react';
import { portChooser, usePortChooser } from '@/serial/portChooser';
import { Modal } from './common';

/** Lets the user see and pick the actual serial port before connecting. */
export function SerialPortDialog() {
  const { request } = usePortChooser();

  useEffect(() => {
    portChooser.init();
  }, []);

  if (!request) return null;
  return <PortList key={request.requestId} request={request} />;
}

function PortList({ request }: { request: OpenBurnSerialPortRequest }) {
  const [selected, setSelected] = useState<string | null>(
    request.recommendedId ?? request.ports[0]?.portId ?? null,
  );
  const [showAll, setShowAll] = useState(false);
  const cancel = () => portChooser.choose(null);

  // Linux exposes dozens of motherboard UARTs (/dev/ttyS0-31) that are never a
  // laser; only USB ports (and the recommendation) are listed by default.
  const relevant = request.ports.filter((p) => p.usb || p.portId === request.recommendedId);
  const hiddenCount = request.ports.length - relevant.length;
  const visible = showAll || relevant.length === 0 ? request.ports : relevant;

  return (
    <Modal
      title="Choose serial port"
      onClose={cancel}
      width={420}
      footer={
        <>
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!selected}
            onClick={() => portChooser.choose(selected)}
          >
            Connect
          </button>
        </>
      }
    >
      {request.ports.length === 0 ? (
        <p className="hint">
          No serial ports found. Check that the laser is plugged in and powered on, then try
          again.
        </p>
      ) : (
        <>
          {relevant.length === 0 && (
            <p className="hint" style={{ marginBottom: 8 }}>
              No USB serial ports found. Check that the laser is plugged in and powered on.
            </p>
          )}
          <div
            role="radiogroup"
            aria-label="Serial ports"
            style={{ maxHeight: 260, overflowY: 'auto' }}
          >
            {visible.map((port) => (
              <label
                key={port.portId}
                className="checkbox"
                style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8 }}
              >
                <input
                  type="radio"
                  name="serial-port"
                  checked={selected === port.portId}
                  onChange={() => setSelected(port.portId)}
                />
                <span>
                  <strong>{port.name}</strong>
                  <br />
                  <span className="hint">
                    {port.usb ? port.description : 'Built-in serial port, usually not a laser'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {hiddenCount > 0 && relevant.length > 0 && (
            <button
              className="btn"
              style={{ marginTop: 6 }}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Hide built-in ports' : `Show ${hiddenCount} built-in ports`}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

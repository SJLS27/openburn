import { useEffect, useRef, useState } from 'react';
import { DEFAULT_IMAGE_ADJUST, type ImageAdjust } from '@/types/document';
import { applyImageAdjust } from '@/image/adjust';
import type { TraceOptions } from '@/image/trace';
import { Modal, NumberField, useUnits, useWorkspace } from './common';

export function ImageAdjustDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [info] = useState(() => ws?.getSelectedImageInfo() ?? null);
  const [adjust, setAdjust] = useState<ImageAdjust>(info?.adjust ?? { ...DEFAULT_IMAGE_ADJUST });
  const [thresholdOn, setThresholdOn] = useState((info?.adjust.threshold ?? -1) >= 0);
  const [threshold, setThreshold] = useState(
    info && info.adjust.threshold >= 0 ? info.adjust.threshold : 128,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const renderPreview = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const maxW = 280;
    const maxH = 190;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) return;
    offCtx.drawImage(img, 0, 0, w, h);
    const imageData = offCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const effective: ImageAdjust = {
      ...adjust,
      threshold: thresholdOn ? threshold : -1,
    };

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = Math.round(applyImageAdjust(gray, effective));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }

    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(imageData, 0, 0);
  };

  useEffect(() => {
    if (!info) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      renderPreview();
    };
    img.src = info.dataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  useEffect(() => {
    renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust, thresholdOn, threshold]);

  const update = (patch: Partial<ImageAdjust>) => setAdjust((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      title="Adjust Image"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              setAdjust({ ...DEFAULT_IMAGE_ADJUST });
              setThresholdOn(false);
              setThreshold(128);
            }}
          >
            Reset
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!info}
            onClick={() => {
              ws?.applyImageAdjust({
                ...adjust,
                threshold: thresholdOn ? threshold : -1,
              });
              onClose();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      {!info ? (
        <p className="hint">Select an image on the workspace to adjust it.</p>
      ) : (
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: '0 0 280px' }}>
            <canvas
              ref={canvasRef}
              style={{
                width: '100%',
                maxWidth: 280,
                minHeight: 120,
                borderRadius: 3,
                border: '1px solid #1a1b1e',
                background: '#17181b',
                display: 'block',
              }}
            />
            <p className="hint" style={{ marginTop: 4 }}>
              Grayscale preview — this is exactly what the laser will see.
            </p>
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-row">
              <span className="field-label" style={{ minWidth: 62 }}>
                Brightness
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjust.brightness}
                onChange={(e) => update({ brightness: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ width: 34, textAlign: 'right' }}>
                {adjust.brightness}
              </span>
            </div>
            <div className="field-row">
              <span className="field-label" style={{ minWidth: 62 }}>
                Contrast
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjust.contrast}
                onChange={(e) => update({ contrast: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ width: 34, textAlign: 'right' }}>
                {adjust.contrast}
              </span>
            </div>
            <div className="field-row">
              <span className="field-label" style={{ minWidth: 62 }}>
                Gamma
              </span>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={adjust.gamma}
                onChange={(e) => update({ gamma: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ width: 34, textAlign: 'right' }}>
                {adjust.gamma.toFixed(2)}
              </span>
            </div>

            <div className="field-row" style={{ marginTop: 4 }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={thresholdOn}
                  onChange={(e) => setThresholdOn(e.target.checked)}
                />
                Threshold
              </label>
              <input
                type="range"
                min={0}
                max={255}
                value={threshold}
                disabled={!thresholdOn}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ width: 28, textAlign: 'right' }}>
                {threshold}
              </span>
            </div>

            <label className="checkbox" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={adjust.invert}
                onChange={(e) => update({ invert: e.target.checked })}
              />
              Invert (negative)
            </label>

            <p className="hint" style={{ marginTop: 10 }}>
              Adjustments are stored on the image object and applied during GCode generation and
              Preview. The source bitmap is not modified.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function TraceDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [info] = useState(() => ws?.getSelectedImageInfo() ?? null);
  const [mode, setMode] = useState<'mono' | 'color'>('mono');
  const [colors, setColors] = useState(6);
  const [threshold, setThreshold] = useState(128);
  const [pathomit, setPathomit] = useState(8);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    const options: TraceOptions = {
      mode,
      colors,
      threshold,
      pathomit,
      invert,
    };
    await ws?.traceSelectedImage(options);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title="Trace Image"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!info || busy} onClick={() => void apply()}>
            {busy ? 'Tracing…' : 'Trace'}
          </button>
        </>
      }
    >
      {!info ? (
        <p className="hint">Select an image on the workspace to vectorise it.</p>
      ) : (
        <>
          <div className="field-row">
            <span className="field-label" style={{ minWidth: 64 }}>
              Mode
            </span>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'mono' | 'color')}
            >
              <option value="mono">Monochrome (threshold)</option>
              <option value="color">Colour quantised</option>
            </select>
          </div>
          {mode === 'mono' ? (
            <div className="field-row">
              <span className="field-label" style={{ minWidth: 64 }}>
                Threshold
              </span>
              <input
                type="range"
                min={0}
                max={255}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span className="hint" style={{ width: 28, textAlign: 'right' }}>
                {threshold}
              </span>
            </div>
          ) : (
            <div className="field-row">
              <span className="field-label" style={{ minWidth: 64 }}>
                Colours
              </span>
              <input
                className="input narrow"
                type="number"
                min={2}
                max={24}
                value={colors}
                onChange={(e) => setColors(Number(e.target.value))}
              />
            </div>
          )}
          <div className="field-row">
            <span className="field-label" style={{ minWidth: 64 }}>
              Detail
            </span>
            <input
              className="input narrow"
              type="number"
              min={0}
              max={64}
              value={pathomit}
              title="Discard paths shorter than this (pixels)"
              onChange={(e) => setPathomit(Number(e.target.value))}
            />
            <span className="hint">path omit</span>
          </div>
          <label className="checkbox" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Invert
          </label>
          <p className="hint" style={{ marginTop: 10 }}>
            The traced paths are added on the active layer, fitted to the image rectangle. Keep the
            original image or delete it afterwards. If the result needs different settings, undo
            (Ctrl+Z) and try again.
          </p>
        </>
      )}
    </Modal>
  );
}

export function TabsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const units = useUnits();
  const [width, setWidth] = useState(2);
  const [spacing, setSpacing] = useState(20);

  return (
    <Modal
      title="Add Tabs"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              ws?.addTabs(width, spacing);
              onClose();
            }}
          >
            Add tabs
          </button>
        </>
      }
    >
      <div className="field-row">
        <span className="field-label">Width</span>
        <NumberField value={width} onChange={setWidth} units={units} />
        <span className="hint">{units}</span>
      </div>
      <div className="field-row">
        <span className="field-label">Spacing</span>
        <NumberField value={spacing} onChange={setSpacing} units={units} />
        <span className="hint">{units}</span>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Leaves uncut gaps every <strong>spacing</strong> mm along each closed contour, so parts stay
        attached to the sheet. The shape is converted to an open path.
      </p>
    </Modal>
  );
}

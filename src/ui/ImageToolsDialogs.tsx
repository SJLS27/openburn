import { useEffect, useRef, useState } from 'react';
import { DEFAULT_IMAGE_ADJUST, type CurvePoint, type ImageAdjust } from '@/types/document';
import { applyImageAdjust, buildCurveLUT, isIdentityCurve } from '@/image/adjust';
import type { TraceOptions } from '@/image/trace';
import { traceDataUrlToSvg } from '@/image/trace';
import { Modal, NumberField, useUnits, useWorkspace } from './common';

const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

function CurveEditor({
  points,
  onChange,
}: {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const W = 260;
  const H = 150;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#17181b';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const x = Math.round((W * i) / 4) + 0.5;
      const y = Math.round((H * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(W, 0);
    ctx.stroke();

    const lut = buildCurveLUT(points);
    ctx.strokeStyle = '#3f8fdd';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 256; i += 1) {
      const px = (i / 255) * W;
      const py = H - (lut[i] / 255) * H;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    for (const point of points) {
      const px = Math.max(0, Math.min(1, point.x)) * W;
      const py = H - Math.max(0, Math.min(1, point.y)) * H;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f5f6f7';
      ctx.fill();
      ctx.strokeStyle = '#3f8fdd';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [points]);

  const toCurve = (e: React.PointerEvent<HTMLCanvasElement>): CurvePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const nearestIndex = (target: HTMLCanvasElement, clientX: number, clientY: number): number => {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    let best = -1;
    let bestDist = 10;
    points.forEach((point, index) => {
      const px = point.x * W;
      const py = H - point.y * H;
      const dist = Math.hypot(px - x, py - y);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const target = e.currentTarget;
    const index = nearestIndex(target, e.clientX, e.clientY);
    if (index >= 0) {
      dragRef.current = index;
    } else {
      const point = toCurve(e);
      const next = [...points, point].sort((a, b) => a.x - b.x);
      dragRef.current = next.indexOf(point);
      onChange(next);
    }
    target.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const index = dragRef.current;
    if (index == null || index < 0 || index >= points.length) return;
    const target = toCurve(e);
    const next = points.map((p, i) => {
      if (i !== index) return p;
      const min = i > 0 ? points[i - 1].x + 0.01 : 0;
      const max = i < points.length - 1 ? points[i + 1].x - 0.01 : 1;
      return { x: Math.max(min, Math.min(max, target.x)), y: target.y };
    });
    onChange(next);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const index = nearestIndex(e.currentTarget, e.clientX, e.clientY);
    if (index > 0 && index < points.length - 1) {
      onChange(points.filter((_, i) => i !== index));
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{
        width: '100%',
        maxWidth: W,
        borderRadius: 3,
        border: '1px solid #1a1b1e',
        display: 'block',
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    />
  );
}

export function ImageAdjustDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [info] = useState(() => ws?.getSelectedImageInfo() ?? null);
  const [adjust, setAdjust] = useState<ImageAdjust>(info?.adjust ?? { ...DEFAULT_IMAGE_ADJUST });
  const [thresholdOn, setThresholdOn] = useState((info?.adjust.threshold ?? -1) >= 0);
  const [threshold, setThreshold] = useState(
    info && info.adjust.threshold >= 0 ? info.adjust.threshold : 128,
  );
  const [levelsOn, setLevelsOn] = useState(Boolean(info?.adjust.levels));
  const [blackPoint, setBlackPoint] = useState(info?.adjust.levels?.black ?? 0);
  const [whitePoint, setWhitePoint] = useState(info?.adjust.levels?.white ?? 255);
  const [curve, setCurve] = useState<CurvePoint[]>(
    info?.adjust.curve && info.adjust.curve.length >= 2 ? info.adjust.curve : IDENTITY_CURVE,
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
      levels: levelsOn ? { black: blackPoint, white: whitePoint } : null,
      curve: isIdentityCurve(curve) ? null : curve,
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
  }, [adjust, thresholdOn, threshold, levelsOn, blackPoint, whitePoint, curve]);

  const update = (patch: Partial<ImageAdjust>) => setAdjust((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      title="Adjust Image"
      onClose={onClose}
      width={720}
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              setAdjust({ ...DEFAULT_IMAGE_ADJUST });
              setThresholdOn(false);
              setThreshold(128);
              setLevelsOn(false);
              setBlackPoint(0);
              setWhitePoint(255);
              setCurve(IDENTITY_CURVE);
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
                levels: levelsOn ? { black: blackPoint, white: whitePoint } : null,
                curve: isIdentityCurve(curve) ? null : curve,
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
              <label className="checkbox" style={{ minWidth: 62 }}>
                <input
                  type="checkbox"
                  checked={levelsOn}
                  onChange={(e) => setLevelsOn(e.target.checked)}
                />
                Levels
              </label>
              <input
                className="input narrow"
                type="number"
                min={0}
                max={254}
                value={blackPoint}
                disabled={!levelsOn}
                title="Input black point"
                onChange={(e) => setBlackPoint(Number(e.target.value))}
              />
              <span className="hint">→</span>
              <input
                className="input narrow"
                type="number"
                min={1}
                max={255}
                value={whitePoint}
                disabled={!levelsOn}
                title="Input white point"
                onChange={(e) => setWhitePoint(Number(e.target.value))}
              />
              <span className="hint">shadows / highlights</span>
            </div>

            <div className="field-row" style={{ alignItems: 'flex-start', marginTop: 4 }}>
              <span className="field-label" style={{ minWidth: 62 }}>
                Curve
              </span>
              <div style={{ flex: 1 }}>
                <CurveEditor points={curve} onChange={setCurve} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="hint">Click to add · drag to move · double-click to remove</span>
                  <button className="btn" onClick={() => setCurve(IDENTITY_CURVE)}>
                    Reset curve
                  </button>
                </div>
              </div>
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
  const [separateColors, setSeparateColors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewEmpty, setPreviewEmpty] = useState(false);

  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    setPreviewBusy(true);
    setPreviewEmpty(false);
    const timer = window.setTimeout(() => {
      void traceDataUrlToSvg(info.dataUrl, { mode, colors, threshold, pathomit, invert }).then(
        (svg) => {
          if (cancelled) return;
          setPreview(svg);
          setPreviewEmpty(!svg);
          setPreviewBusy(false);
        },
      );
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [info, mode, colors, threshold, pathomit, invert]);

  const apply = async () => {
    setBusy(true);
    const options: TraceOptions = {
      mode,
      colors,
      threshold,
      pathomit,
      invert,
      separateColors: mode === 'color' && separateColors,
    };
    await ws?.traceSelectedImage(options);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title="Trace Image"
      onClose={onClose}
      width={520}
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
          {mode === 'color' && (
            <label className="checkbox" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={separateColors}
                onChange={(e) => setSeparateColors(e.target.checked)}
              />
              Split colours into separate layers
            </label>
          )}

          <div style={{ marginTop: 10 }}>
            <span className="field-label">Preview</span>
            <div
              style={{
                marginTop: 4,
                minHeight: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                border: '1px solid #1a1b1e',
                background: '#17181b',
                padding: 6,
              }}
            >
              {preview ? (
                <img
                  alt="Trace preview"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
                  style={{ maxWidth: '100%', maxHeight: 220, display: 'block' }}
                />
              ) : (
                <span className="hint">
                  {previewBusy ? 'Tracing…' : previewEmpty ? 'No contours — adjust the settings' : ''}
                </span>
              )}
            </div>
          </div>

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

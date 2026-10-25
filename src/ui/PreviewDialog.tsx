import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, type JobPlan, type PlanSegment, type Pt } from '@/gcode/types';
import { Icon } from './icons';
import { Modal } from './common';

interface Props {
  plan: JobPlan;
  bed: { width: number; height: number };
  onClose: () => void;
  onSend: (plan: JobPlan) => void;
  canSend: boolean;
  connectedName: string;
}

const W = 780;
const H = 500;
const MARGIN = 34;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 50;
const ZOOM_STEP = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function polyLength(points: Pt[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i += 1) {
    d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return d;
}

export function PreviewDialog({ plan, bed, onClose, onSend, canSend, connectedName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(10);
  const [showTravel, setShowTravel] = useState(false);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const startRef = useRef(0);

  const userZoom = view.zoom;
  const panX = view.panX;
  const panY = view.panY;

  const colorByLayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of plan.layerStats) map.set(s.layerId, s.color);
    return map;
  }, [plan]);

  const { cumulative, totalDistance } = useMemo(() => {
    const distances: number[] = [];
    let total = 0;
    for (const seg of plan.segments) {
      const d = polyLength(seg.points);
      distances.push(d);
      total += d;
    }
    return { cumulative: distances, totalDistance: total };
  }, [plan]);

  const baseScale = Math.min((W - MARGIN * 2) / bed.width, (H - MARGIN * 2) / bed.height);
  const scale = baseScale * userZoom;
  const offsetX = (W - bed.width * scale) / 2 + panX;
  const offsetY = (H - bed.height * scale) / 2 + panY;
  const toScreen = (p: Pt) => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale });

  /** Zoom keeping the given canvas point fixed under the cursor. */
  const applyZoomAt = useCallback(
    (nextZoomInput: number, cx: number, cy: number) => {
      const v = viewRef.current;
      const nextZoom = clamp(nextZoomInput, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZoom - v.zoom) < 1e-9) return;
      const bs = Math.min((W - MARGIN * 2) / bed.width, (H - MARGIN * 2) / bed.height);
      const prevScale = bs * v.zoom;
      const prevOffX = (W - bed.width * prevScale) / 2 + v.panX;
      const prevOffY = (H - bed.height * prevScale) / 2 + v.panY;
      const worldX = (cx - prevOffX) / prevScale;
      const worldY = (cy - prevOffY) / prevScale;
      const nextScale = bs * nextZoom;
      const nextOffX = cx - worldX * nextScale;
      const nextOffY = cy - worldY * nextScale;
      const next = {
        zoom: nextZoom,
        panX: nextOffX - (W - bed.width * nextScale) / 2,
        panY: nextOffY - (H - bed.height * nextScale) / 2,
      };
      viewRef.current = next;
      setView(next);
    },
    [bed.width, bed.height],
  );

  const resetView = useCallback(() => {
    const next = { zoom: 1, panX: 0, panY: 0 };
    viewRef.current = next;
    setView(next);
  }, []);

  const zoomBy = (factor: number) => {
    applyZoomAt(viewRef.current.zoom * factor, W / 2, H / 2);
  };

  // Wheel zoom anchored at the cursor (native listener so preventDefault works).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cx = ((e.clientX - rect.left) * W) / rect.width;
      const cy = ((e.clientY - rect.top) * H) / rect.height;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoomAt(v.zoom * factor, cx, cy);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyZoomAt]);

  // Drag to pan with the left or middle mouse button.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      setDragging(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!active) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const kx = W / rect.width;
      const ky = H / rect.height;
      const dx = (e.clientX - lastX) * kx;
      const dy = (e.clientY - lastY) * ky;
      lastX = e.clientX;
      lastY = e.clientY;
      const v = viewRef.current;
      const next = { ...v, panX: v.panX + dx, panY: v.panY + dy };
      viewRef.current = next;
      setView(next);
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      setDragging(false);
    };
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('auxclick', onAuxClick);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Build the static background (bed, dim toolpaths, travel moves).
  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#26282c';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#303236';
    ctx.strokeStyle = '#55595f';
    ctx.lineWidth = 1;
    ctx.fillRect(offsetX, offsetY, bed.width * scale, bed.height * scale);
    ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, bed.width * scale, bed.height * scale);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    const step = 10;
    ctx.beginPath();
    for (let x = 0; x <= bed.width; x += step) {
      const sx = Math.round(offsetX + x * scale) + 0.5;
      ctx.moveTo(sx, offsetY);
      ctx.lineTo(sx, offsetY + bed.height * scale);
    }
    for (let y = 0; y <= bed.height; y += step) {
      const sy = Math.round(offsetY + y * scale) + 0.5;
      ctx.moveTo(offsetX, sy);
      ctx.lineTo(offsetX + bed.width * scale, sy);
    }
    ctx.stroke();

    // travel
    if (showTravel) {
      ctx.strokeStyle = 'rgba(210,150,80,0.22)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      for (const seg of plan.segments) {
        if (seg.kind !== 'rapid') continue;
        const p = toScreen(seg.points[0]);
        ctx.beginPath();
        // draw a tiny marker for each rapid target
        ctx.moveTo(p.x - 1, p.y);
        ctx.lineTo(p.x + 1, p.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // dim full toolpaths
    ctx.lineWidth = 1;
    for (const seg of plan.segments) {
      if (seg.kind !== 'cut') continue;
      ctx.strokeStyle = colorByLayer.get(seg.layerId ?? '') ?? '#d0d3d6';
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      seg.points.forEach((pt, i) => {
        const s = toScreen(pt);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    bgRef.current = off;
    draw(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, scale, offsetX, offsetY, showTravel, bed.width, bed.height]);

  const draw = (value: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0);

    const target = value * totalDistance;
    let consumed = 0;
    let head: Pt | null = null;

    ctx.lineWidth = 1.35;
    for (let i = 0; i < plan.segments.length; i += 1) {
      const seg: PlanSegment = plan.segments[i];
      const d = cumulative[i];
      if (seg.kind === 'cut' && consumed < target) {
        const color = colorByLayer.get(seg.layerId ?? '') ?? '#e8eaec';
        ctx.strokeStyle = color;
        ctx.beginPath();
        const remaining = target - consumed;
        let walked = 0;
        for (let k = 0; k < seg.points.length; k += 1) {
          const s = toScreen(seg.points[k]);
          if (k === 0) ctx.moveTo(s.x, s.y);
          else {
            const prev = seg.points[k - 1];
            const stepLen = Math.hypot(seg.points[k].x - prev.x, seg.points[k].y - prev.y);
            if (walked + stepLen <= remaining) {
              ctx.lineTo(s.x, s.y);
              walked += stepLen;
            } else {
              const t = stepLen > 0 ? (remaining - walked) / stepLen : 0;
              const px = prev.x + (seg.points[k].x - prev.x) * t;
              const py = prev.y + (seg.points[k].y - prev.y) * t;
              const sp = toScreen({ x: px, y: py });
              ctx.lineTo(sp.x, sp.y);
              head = { x: px, y: py };
              break;
            }
          }
        }
        ctx.stroke();
        if (!head) head = seg.points[seg.points.length - 1];
      }
      consumed += d;
      if (consumed > target && head) break;
    }

    if (head) {
      const s = toScreen(head);
      ctx.strokeStyle = '#ffb357';
      ctx.fillStyle = 'rgba(255,179,87,0.25)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x - 10, s.y);
      ctx.lineTo(s.x + 10, s.y);
      ctx.moveTo(s.x, s.y - 10);
      ctx.lineTo(s.x, s.y + 10);
      ctx.stroke();
    }
  };

  useEffect(() => {
    draw(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - (progress * plan.timeSeconds * 1000) / speed;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = ((now - startRef.current) / 1000) * speed;
      const p = plan.timeSeconds > 0 ? elapsed / plan.timeSeconds : 1;
      if (p >= 1) {
        setProgress(1);
        setPlaying(false);
        return;
      }
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, plan]);

  const restart = () => {
    setProgress(0);
    setPlaying(true);
  };

  return (
    <Modal
      title="Preview"
      onClose={onClose}
      width={1060}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={!canSend || plan.segments.length === 0}
            title={canSend ? `Send to ${connectedName}` : 'Connect a device first'}
            onClick={() => onSend(plan)}
          >
            <Icon name="play" size={12} /> Send to laser
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <div>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{
              borderRadius: 3,
              border: '1px solid #1a1b1e',
              display: 'block',
              maxWidth: '100%',
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            title="Rueda: zoom · Arrastrar (izq./central): mover"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => setPlaying((v) => !v)} style={{ width: 84 }}>
              <Icon name={playing ? 'pause' : 'play'} size={12} /> {playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn" onClick={restart} title="Restart">
              <Icon name="repeat" size={13} />
            </button>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              onChange={(e) => {
                setPlaying(false);
                setProgress(Number(e.target.value) / 1000);
              }}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {(progress * 100).toFixed(0)}%
            </span>
            <select
              className="input"
              style={{ width: 74, height: 24 }}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={1}>1×</option>
              <option value={5}>5×</option>
              <option value={10}>10×</option>
              <option value={30}>30×</option>
              <option value={60}>60×</option>
            </select>
            <label className="checkbox" title="Show travel moves">
              <input
                type="checkbox"
                checked={showTravel}
                onChange={(e) => setShowTravel(e.target.checked)}
              />
              Travel
            </label>
            <span style={{ width: 1, height: 18, background: '#3a3d42' }} />
            <button className="btn" title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
              <Icon name="zoom-out" size={12} />
            </button>
            <span
              style={{
                width: 46,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.round(userZoom * 100)}%
            </span>
            <button className="btn" title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
              <Icon name="zoom-in" size={12} />
            </button>
            <button className="btn" title="Fit bed" onClick={resetView}>
              <Icon name="zoom-page" size={12} />
            </button>
          </div>
        </div>

        <div style={{ width: 210, flex: '0 0 210px' }}>
          <h4 style={{ margin: '0 0 8px' }}>Job summary</h4>
          <div className="summary-row">
            <span>Est. time</span>
            <strong>{formatDuration(plan.timeSeconds)}</strong>
          </div>
          <div className="summary-row">
            <span>Cut length</span>
            <strong>{(plan.cutDistance / 1000).toFixed(2)} m</strong>
          </div>
          <div className="summary-row">
            <span>Travel</span>
            <strong>{(plan.rapidDistance / 1000).toFixed(2)} m</strong>
          </div>
          <div className="summary-row">
            <span>GCode lines</span>
            <strong>{plan.lineCount.toLocaleString()}</strong>
          </div>
          <div className="summary-row">
            <span>Paths</span>
            <strong>{plan.layerStats.reduce((n, s) => n + s.segments, 0)}</strong>
          </div>

          <h4 style={{ margin: '12px 0 6px' }}>Layers</h4>
          {plan.layerStats.length === 0 && <p className="hint">No output layers.</p>}
          {plan.layerStats.map((s) => (
            <div key={s.layerId} className="summary-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className="layer-swatch" style={{ background: s.color, width: 10, height: 10 }} />
                {s.name}
              </span>
              <span className="hint">{formatDuration(s.seconds)}</span>
            </div>
          ))}

          {plan.warnings.length > 0 && (
            <>
              <h4 style={{ margin: '12px 0 6px', color: 'var(--yellow)' }}>Warnings</h4>
              <ul className="hint" style={{ paddingLeft: 14, margin: 0 }}>
                {plan.warnings.slice(0, 6).map((w, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    {w}
                  </li>
                ))}
              </ul>
            </>
          )}

          {!canSend && (
            <p className="hint" style={{ marginTop: 10 }}>
              Connect a device in the Laser panel to send this job directly.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, type JobPlan, type PlanSegment, type Pt } from '@/gcode/types';
import { rasterRuns } from '@/gcode/rasterPreview';
import { Icon } from './icons';
import { Modal } from './common';
import {
  blendDot,
  buildRasterIndex,
  copyRevealedRows,
  rasterBoxes,
  revealCount,
  type ScreenBox,
  type ToScreen,
} from './previewRaster';

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

/** Opacity of the not-yet-engraved image in the Preview backdrop. */
const RASTER_BACKDROP_ALPHA = 0.3;
/** Padding (px) around the raster layer, in canvas units. */
const RASTER_PAD = 1;

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

/** Offscreen canvas helper (all Preview layers are the same size). */
function scratch(ref: { current: HTMLCanvasElement | null }): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  if (!ref.current) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ref.current = canvas;
  }
  return { canvas: ref.current, ctx: ref.current.getContext('2d') };
}

export function PreviewDialog({ plan, bed, onClose, onSend, canSend, connectedName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Static backdrop (bed, dim toolpaths, travel, dimmed image), world units. */
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  /** Engraved-layer canvas for raster segments, world units. */
  const rasterRef = useRef<HTMLCanvasElement | null>(null);
  /** Screen-space canvas holding the raster rows already revealed. */
  const revealRef = useRef<HTMLCanvasElement | null>(null);
  /** Screen-space canvas holding the vector segments already engraved. */
  const doneRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(10);
  const [showTravel, setShowTravel] = useState(true);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const startRef = useRef(0);
  /**
   * Playhead of the incremental caches: vector segments before `done` are on
   * `doneRef`; raster rows before `revealDone` (plus `revealFrac` of the next
   * one) are on `revealRef`. `null` means nothing has been painted yet.
   */
  const cacheRef = useRef<{ done: number; revealDone: number; revealFrac: number } | null>(null);

  const userZoom = view.zoom;
  const panX = view.panX;
  const panY = view.panY;

  const colorByLayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of plan.layerStats) map.set(s.layerId, s.color);
    return map;
  }, [plan]);

  /**
   * Per-segment weight. Time-based weights (from the plan) include rapid moves
   * between raster rows; for raster cuts only the lit part of the row counts,
   * so the playhead does not crawl over blank image areas.
   */
  const { weights, totalWeight } = useMemo(() => {
    const timeWeights =
      plan.segSeconds && plan.segSeconds.length === plan.segments.length
        ? plan.segSeconds
        : null;
    const w = plan.segments.map((seg, i) => {
      if (seg.kind !== 'cut') return timeWeights?.[i] ?? 0;
      if (seg.powers) {
        const lit = rasterRuns(seg)
          .map((run) => polyLength(run.points))
          .reduce((a, b) => a + b, 0);
        return lit / Math.max(1, seg.feed ?? 600);
      }
      return timeWeights?.[i] ?? polyLength(seg.points) / Math.max(1, seg.feed ?? 600);
    });
    return { weights: w, totalWeight: w.reduce((a, b) => a + b, 0) || 1 };
  }, [plan]);

  /** Cumulative weight at the start of each segment (binary-searchable). */
  const cumulative = useMemo(() => {
    const acc = new Float64Array(plan.segments.length + 1);
    for (let i = 0; i < plan.segments.length; i += 1) acc[i + 1] = acc[i] + (weights[i] ?? 0);
    return acc;
  }, [plan.segments.length, weights]);

  const segmentAt = (target: number): number => {
    // Index of the first segment whose end is beyond `target`.
    let lo = 0;
    let hi = plan.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid + 1] <= target + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /** Raster rows in playback order, computed once per plan. */
  const rasterIndex = useMemo(() => buildRasterIndex(plan, weights), [plan, weights]);

  const baseScale = Math.min((W - MARGIN * 2) / bed.width, (H - MARGIN * 2) / bed.height);
  const scale = baseScale * userZoom;
  const offsetX = (W - bed.width * scale) / 2 + panX;
  const offsetY = (H - bed.height * scale) / 2 + panY;
  const toScreen = useCallback<ToScreen>(
    (p) => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale }),
    [offsetX, offsetY, scale],
  );

  /** Cached screen boxes of the raster rows; refreshed only when the view moves. */
  const rasterBoxesRef = useRef<ScreenBox[]>([]);
  const rasterBoxesKeyRef = useRef('');
  const boxesForView = useCallback((): ScreenBox[] => {
    const key = `${plan.segments.length}:${offsetX}:${offsetY}:${scale}`;
    if (rasterBoxesKeyRef.current !== key) {
      rasterBoxesRef.current = rasterBoxes(plan, rasterIndex, toScreen);
      rasterBoxesKeyRef.current = key;
    }
    return rasterBoxesRef.current;
  }, [plan, rasterIndex, toScreen, offsetX, offsetY, scale]);

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

  // Drag to pan with the left or middle mouse button. Pointer moves are
  // coalesced into one state update per animation frame: rebuilding the view
  // on every mouse event is what made panning feel stuck.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = false;
    let lastX = 0;
    let lastY = 0;
    let accX = 0;
    let accY = 0;
    let frame = 0;

    const flush = () => {
      frame = 0;
      if (accX === 0 && accY === 0) return;
      const v = viewRef.current;
      const next = { ...v, panX: v.panX + accX, panY: v.panY + accY };
      accX = 0;
      accY = 0;
      viewRef.current = next;
      setView(next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(flush);
    };

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
      accX += (e.clientX - lastX) * kx;
      accY += (e.clientY - lastY) * ky;
      lastX = e.clientX;
      lastY = e.clientY;
      schedule();
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      if (frame) {
        cancelAnimationFrame(frame);
        flush();
      }
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
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Build the static backdrop (bed, dim toolpaths, travel moves). It is cached
  // in *world* coordinates, so panning and zooming only re-composite it with a
  // new transform instead of re-stroking the whole plan.
  useEffect(() => {
    const { ctx } = scratch(bgRef);
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#26282c';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#303236';
    ctx.strokeStyle = '#55595f';
    ctx.lineWidth = 1;
    ctx.fillRect(0, 0, bed.width, bed.height);
    ctx.strokeRect(0.5, 0.5, bed.width, bed.height);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    const step = 10;
    ctx.beginPath();
    for (let x = 0; x <= bed.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, bed.height);
    }
    for (let y = 0; y <= bed.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(bed.width, y);
    }
    ctx.stroke();

    // travel (machine path between cuts). Two world points closer than half a
    // screen pixel are not worth a dashed stroke.
    if (showTravel) {
      ctx.strokeStyle = 'rgba(210,150,80,0.45)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      let position: Pt | null = null;
      ctx.beginPath();
      for (const seg of plan.segments) {
        if (seg.points.length === 0) continue;
        if (seg.kind === 'rapid') {
          const target = seg.points[0];
          if (position) {
            const dx = target.x - position.x;
            const dy = target.y - position.y;
            if (dx * dx + dy * dy > 0.25) {
              ctx.moveTo(position.x, position.y);
              ctx.lineTo(target.x, target.y);
            }
          }
          position = target;
        } else {
          position = seg.points[seg.points.length - 1];
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // dim full toolpaths. Raster segments are not strokes: they engrave
    // isolated pixels, so drawing the whole scan line would paint a solid
    // black block. Their dimmed version is rendered as a low-alpha bitmap.
    ctx.lineWidth = 1;
    for (const seg of plan.segments) {
      if (seg.kind !== 'cut' || seg.powers) continue;
      ctx.strokeStyle = colorByLayer.get(seg.layerId ?? '') ?? '#d0d3d6';
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      seg.points.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Pre-render the engraved image at full opacity, in world units. The
    // backdrop draws it dimmed; the playhead reveal composites the same layer
    // at full strength, so an image is never limited to the backdrop opacity.
    const raster = renderRasterLayer(plan, bed.width, bed.height);
    rasterRef.current = raster;
    if (raster) {
      ctx.globalAlpha = RASTER_BACKDROP_ALPHA;
      // The layer covers the whole bed (plus padding), in world units.
      ctx.drawImage(raster, -RASTER_PAD, -RASTER_PAD, bed.width + RASTER_PAD * 2, bed.height + RASTER_PAD * 2);
      ctx.globalAlpha = 1;
    }
    // The caches hold screen-space pixels: a new backdrop invalidates them.
    cacheRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, showTravel, bed.width, bed.height, colorByLayer]);

  const draw = (value: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (bgRef.current) {
      // The backdrop is cached in world space: only the bed origin moves.
      ctx.drawImage(
        bgRef.current,
        0,
        0,
        bed.width,
        bed.height,
        offsetX,
        offsetY,
        bed.width * scale,
        bed.height * scale,
      );
    }

    const target = value * totalWeight;
    const prev = cacheRef.current;
    const reveal = revealCount(rasterIndex, value);
    const done = scratch(doneRef);
    const revealLayer = scratch(revealRef);
    if (!done.ctx || !revealLayer.ctx) return;

    // Going backwards: drop whatever was painted past the playhead.
    const rewind =
      !prev ||
      prev.done > segmentAt(target) ||
      reveal.done < prev.revealDone ||
      (reveal.done === prev.revealDone && reveal.frac < prev.revealFrac);
    if (rewind) {
      done.ctx.clearRect(0, 0, W, H);
      revealLayer.ctx.clearRect(0, 0, W, H);
    }

    const startAt = rewind ? 0 : prev.done;
    const fromRow = rewind ? 0 : prev.revealDone;

    // Raster: copy only the rows revealed since the previous frame.
    const layer = rasterRef.current;
    if (layer) {
      const boxes = boxesForView();
      copyRevealedRows(
        revealLayer.ctx,
        layer,
        boxes,
        rasterIndex.rows,
        fromRow,
        reveal.done,
        reveal.frac,
      );
    }

    // Vector: add only the segments completed since the previous frame.
    for (let i = startAt; i < plan.segments.length; i += 1) {
      if (cumulative[i + 1] > target + 1e-9) break;
      const seg = plan.segments[i];
      if (seg.kind !== 'cut' || seg.powers || seg.points.length < 2) continue;
      done.ctx.strokeStyle = colorByLayer.get(seg.layerId ?? '') ?? '#e8eaec';
      done.ctx.lineWidth = 1;
      done.ctx.beginPath();
      for (let k = 0; k < seg.points.length; k += 1) {
        const s = toScreen(seg.points[k]);
        if (k === 0) done.ctx.moveTo(s.x, s.y);
        else done.ctx.lineTo(s.x, s.y);
      }
      done.ctx.stroke();
    }

    // Composite the cached layers, then paint only the active segment.
    ctx.drawImage(done.canvas, 0, 0);
    if (layer) ctx.drawImage(revealLayer.canvas, 0, 0);

    let head: Pt | null = null;
    let position: Pt | null = null;
    const active = segmentAt(target);
    const seg: PlanSegment | undefined = plan.segments[active];

    ctx.lineWidth = 1;
    if (seg && seg.points.length > 0 && cumulative[active] <= target + 1e-9) {
      const w = weights[active] ?? 0;
      const frac = w > 0 ? clamp((target - cumulative[active]) / w, 0, 1) : 0;
      if (seg.kind === 'cut') {
        if (seg.powers) {
          // The row is already revealed sideways by `copyRevealedRows`.
          head = interpolatePoint(seg.points, frac);
        } else {
          ctx.strokeStyle = colorByLayer.get(seg.layerId ?? '') ?? '#e8eaec';
          ctx.beginPath();
          const remaining = polyLength(seg.points) * frac;
          let walked = 0;
          let started = false;
          for (let k = 0; k < seg.points.length; k += 1) {
            const s = toScreen(seg.points[k]);
            if (k === 0) {
              ctx.moveTo(s.x, s.y);
              started = true;
              continue;
            }
            const prevPt = seg.points[k - 1];
            const stepLen = Math.hypot(seg.points[k].x - prevPt.x, seg.points[k].y - prevPt.y);
            if (walked + stepLen <= remaining) {
              ctx.lineTo(s.x, s.y);
              walked += stepLen;
            } else {
              const t = stepLen > 0 ? (remaining - walked) / stepLen : 0;
              const px = prevPt.x + (seg.points[k].x - prevPt.x) * t;
              const py = prevPt.y + (seg.points[k].y - prevPt.y) * t;
              const sp = toScreen({ x: px, y: py });
              ctx.lineTo(sp.x, sp.y);
              head = { x: px, y: py };
              break;
            }
          }
          if (started) ctx.stroke();
          if (!head) head = seg.points[seg.points.length - 1];
        }
      } else {
        // Moving through a travel move: interpolate the head position.
        for (let i = active - 1; i >= 0; i -= 1) {
          const p = plan.segments[i].points;
          if (p.length > 0) {
            position = p[p.length - 1];
            break;
          }
        }
        const to = seg.points[0];
        const from = position ?? to;
        const px = from.x + (to.x - from.x) * frac;
        const py = from.y + (to.y - from.y) * frac;
        head = { x: px, y: py };
        const a = toScreen(from);
        const b = toScreen({ x: px, y: py });
        ctx.strokeStyle = 'rgba(255,190,110,0.85)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (!head) {
      for (let i = Math.min(active, plan.segments.length - 1); i >= 0; i -= 1) {
        const p = plan.segments[i]?.points;
        if (p && p.length > 0) {
          head = p[p.length - 1];
          break;
        }
      }
    }

    cacheRef.current = { done: active, revealDone: reveal.done, revealFrac: reveal.frac };

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

  // Pan/zoom only re-composites the caches: invalidate them and repaint once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cacheRef.current = null;
    draw(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetX, offsetY, scale]);

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

function interpolatePoint(points: Pt[], frac: number): Pt {
  const total = polyLength(points);
  if (total <= 0) return points[0];
  let remaining = total * Math.max(0, Math.min(1, frac));
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= d) {
      const t = d > 0 ? remaining / d : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= d;
  }
  return points[points.length - 1];
}

export function rasterPowerColor(power: number): { r: number; g: number; b: number; a: number } {
  const p = Math.max(0, Math.min(100, Number.isFinite(power) ? power : 0)) / 100;
  // Low power: dim orange; high power: white-hot.
  const r = Math.round(190 + 65 * p);
  const g = Math.round(110 + 145 * p);
  const b = Math.round(60 + 195 * p);
  const a = 0.18 + 0.82 * Math.pow(p, 0.7);
  return { r, g, b, a };
}

/**
 * Pre-render the whole engraved (raster) layer at full opacity, in world
 * units (one extra pixel on every side). Pixels are written through an
 * `ImageData` buffer: one `putImageData` instead of two `fillRect` calls per
 * engraved point, which is what made large images slow to open and pan.
 *
 * The bitmap always covers the whole bed so it can be composited with a single
 * `drawImage`; its resolution is bounded by the on-screen canvas size, which
 * is where the detail is actually visible.
 */
function renderRasterLayer(plan: JobPlan, bedWidth: number, bedHeight: number): HTMLCanvasElement | null {
  const rows = plan.segments.filter((seg) => seg.kind === 'cut' && seg.powers && seg.points.length >= 2);
  if (rows.length === 0) return null;

  // World-space extent of the engraved area, padded.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of rows) {
    for (const p of seg.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || maxX < minX || maxY < minY) return null;

  // Resolution: never finer than the pixels the canvas can show, never
  // coarser than one texel per 0.125 mm (so small designs stay crisp).
  const texel = Math.max(1 / 8, Math.max(bedWidth, 1) / (W * 4), Math.max(bedHeight, 1) / (H * 4));
  const pad = RASTER_PAD;
  const w = Math.max(1, Math.ceil(Math.max(bedWidth, maxX) / texel) + pad * 2);
  const h = Math.max(1, Math.ceil(Math.max(bedHeight, maxY) / texel) + pad * 2);

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(w, h);
  const data = image.data;

  const toTx = (x: number) => x / texel + pad;
  const toTy = (y: number) => y / texel + pad;
  const dot = (px: number, py: number, color: { r: number; g: number; b: number; a: number }) =>
    blendDot(data, w, h, toTx(px), toTy(py), color);

  for (const seg of rows) {
    const points = seg.points;
    const powers = seg.powers!;
    const n = points.length;
    const first = points[0];
    const last = points[n - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const total = Math.hypot(dx, dy);
    // Offset along the row's normal so adjacent scan lines join up instead of
    // leaving a one-pixel gap at low resolution.
    const nx = total > 0 ? (-dy / total) * texel * 0.4 : 0;
    const ny = total > 0 ? (dx / total) * texel * 0.4 : texel * 0.4;
    for (let i = 1; i < n; i += 1) {
      const power = powers[i - 1] ?? 0;
      if (power <= 0) continue;
      const color = rasterPowerColor(power);
      const p = points[i];
      // The laser lights up on the move into point `i`, so the dot is drawn there.
      dot(p.x, p.y, color);
      dot(p.x + nx, p.y + ny, color);
    }
  }

  ctx.putImageData(image, 0, 0);
  return off;
}

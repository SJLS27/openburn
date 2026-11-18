import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, type JobPlan, type PlanSegment, type Pt } from '@/gcode/types';
import { Icon } from './icons';
import { Modal } from './common';
import { rasterRuns } from '@/gcode/rasterPreview';
import { polylinePath, rasterPowerCss, type LayerPaths } from './previewPaths';

interface Props {
  plan: JobPlan;
  bed: { width: number; height: number };
  onClose: () => void;
  onSend: (plan: JobPlan) => void;
  canSend: boolean;
  connectedName: string;
}

/** Logical size of the preview viewport (CSS px). The SVG scales inside it. */
const W = 780;
const H = 500;
const MIN_ZOOM = 0.1;
/** Effectively unlimited: the SVG re-tessellates instead of magnifying pixels. */
const MAX_ZOOM = 400;
const ZOOM_STEP = 1.25;

/** Renders per animation frame while a new reveal path is being composed. */
const SEGMENTS_PER_FRAME = 4000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** SVG `d` for one polyline (same rounding as the path builder). */
function subPath(points: Pt[]): string {
  return polylinePath(points);
}

/**
 * The Preview is pure SVG over a viewBox of the bed in millimetres.
 *
 * Zoom and pan move the viewBox instead of scaling a bitmap, so the picture
 * never pixelates: text, hairlines and 1 µm detail stay crisp at any zoom.
 * Raster engraving is drawn from the same scanline segments the machine runs,
 * not from a stretched image.
 */
export function PreviewDialog({ plan, bed, onClose, onSend, canSend, connectedName }: Props) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(10);
  const [showTravel, setShowTravel] = useState(true);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const startRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const zoom = view.zoom;
  const panX = view.panX;
  const panY = view.panY;

  const colorByLayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of plan.layerStats) map.set(s.layerId, s.color);
    return map;
  }, [plan.layerStats]);

  /**
   * Per-segment weight, mirroring the time estimate. Raster rows count only
   * their lit runs so the playhead does not crawl over blank image areas.
   */
  const { weights, cumulative, totalWeight } = useMemo(() => {
    const timeWeights =
      plan.segSeconds && plan.segSeconds.length === plan.segments.length
        ? plan.segSeconds
        : null;
    const w = plan.segments.map((seg, i) => {
      if (seg.kind !== 'cut') return timeWeights?.[i] ?? 0;
      if (seg.powers) return timeWeights?.[i] ?? 1;
      let len = 0;
      for (let k = 1; k < seg.points.length; k += 1) {
        len += Math.hypot(seg.points[k].x - seg.points[k - 1].x, seg.points[k].y - seg.points[k - 1].y);
      }
      return timeWeights?.[i] ?? len / Math.max(1, seg.feed ?? 600);
    });
    const acc = new Float64Array(plan.segments.length + 1);
    for (let i = 0; i < plan.segments.length; i += 1) acc[i + 1] = acc[i] + (w[i] ?? 0);
    return { weights: w, cumulative: acc, totalWeight: acc[acc.length - 1] || 1 };
  }, [plan]);

  /** Index of the first segment whose end is beyond `target`. */
  const segmentAt = useCallback(
    (target: number): number => {
      let lo = 0;
      let hi = plan.segments.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid + 1] <= target + 1e-9) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [cumulative, plan.segments.length],
  );

  const active = segmentAt(progress * totalWeight);

  /**
   * Static backdrop: everything up to (but excluding) the completed part.
   * Rebuilt only when the plan, the travel toggle or the layer colours change —
   * **not** on zoom, because the SVG scales itself.
   */
  const backdrop = useMemo(() => {
    const byLayer = new Map<string, string[]>();
    const travel: string[] = [];
    let position: Pt | null = null;

    for (let i = 0; i < active; i += 1) {
      const seg = plan.segments[i];
      if (!seg || seg.points.length === 0) continue;
      if (seg.kind === 'rapid') {
        const target = seg.points[0];
        if (position) {
          const dx = target.x - position.x;
          const dy = target.y - position.y;
          if (showTravel && dx * dx + dy * dy > 0.25) {
            travel.push(`M${position.x} ${position.y}L${target.x} ${target.y}`);
          }
        }
        position = target;
        continue;
      }
      position = seg.points[seg.points.length - 1];
      // Raster segments are drawn from their lit runs below, not as a line.
      if (seg.powers) continue;
      const layerId = seg.layerId ?? '';
      const d = subPath(seg.points);
      if (!d) continue;
      const bucket = byLayer.get(layerId);
      if (bucket) bucket.push(d);
      else byLayer.set(layerId, [d]);
    }

    // Raster engraving is drawn from the lit runs of each scanline, toned by
    // laser power: a raster layer's black would otherwise look like a solid
    // block instead of a gradient.
    const raster = new Map<string, string[]>();
    for (let i = 0; i < active; i += 1) {
      const seg = plan.segments[i];
      if (!seg || seg.kind !== 'cut' || !seg.powers) continue;
      for (const run of rasterRuns(seg)) {
        const d = subPath(run.points);
        if (!d) continue;
        const key = rasterPowerCss(run.power);
        const bucket = raster.get(key);
        if (bucket) bucket.push(d);
        else raster.set(key, [d]);
      }
    }

    // Remaining (not yet cut) toolpaths, drawn faintly, per layer.
    const pending = new Map<string, string[]>();
    for (let i = active; i < plan.segments.length; i += 1) {
      const seg = plan.segments[i];
      if (!seg || seg.kind !== 'cut' || seg.points.length < 2) continue;
      if (seg.powers) continue;
      const layerId = seg.layerId ?? '';
      const d = subPath(seg.points);
      if (!d) continue;
      const bucket = pending.get(layerId);
      if (bucket) bucket.push(d);
      else pending.set(layerId, [d]);
    }

    const toLayerPaths = (map: Map<string, string[]>): LayerPaths[] =>
      [...map.entries()].map(([layerId, paths]) => ({
        layerId,
        color: colorByLayer.get(layerId) ?? '#d0d3d6',
        chunks: [paths.join('')],
      }));

    return {
      done: toLayerPaths(byLayer),
      raster: toLayerPaths(raster),
      pending: toLayerPaths(pending),
      travel: travel.join(''),
    };
  }, [plan.segments, active, showTravel, colorByLayer]);

  /** The segment currently under the head, cut up to the playhead fraction. */  const activeGeometry = useMemo(() => {
    const seg: PlanSegment | undefined = plan.segments[active];
    if (!seg || seg.points.length === 0) return null;
    if (seg.kind === 'rapid') {
      const w = weights[active] ?? 0;
      const frac = w > 0 ? clamp((progress * totalWeight - cumulative[active]) / w, 0, 1) : 0;
      const to = seg.points[0];
      let from: Pt = to;
      for (let i = active - 1; i >= 0; i -= 1) {
        const p = plan.segments[i]?.points;
        if (p && p.length > 0) {
          from = p[p.length - 1];
          break;
        }
      }
      const head = {
        x: from.x + (to.x - from.x) * frac,
        y: from.y + (to.y - from.y) * frac,
      };
      return {
        d: `M${from.x} ${from.y}L${head.x} ${head.y}`,
        head,
        color: '#ffbe6e',
        dashed: true,
      };
    }

    const w = weights[active] ?? 0;
    const frac = w > 0 ? clamp((progress * totalWeight - cumulative[active]) / w, 0, 1) : 1;
    let total = 0;
    for (let k = 1; k < seg.points.length; k += 1) {
      total += Math.hypot(seg.points[k].x - seg.points[k - 1].x, seg.points[k].y - seg.points[k - 1].y);
    }
    const remaining = total * frac;
    const pts: Pt[] = [seg.points[0]];
    let walked = 0;
    let head: Pt = seg.points[0];
    for (let k = 1; k < seg.points.length; k += 1) {
      const prevPt = seg.points[k - 1];
      const stepLen = Math.hypot(seg.points[k].x - prevPt.x, seg.points[k].y - prevPt.y);
      if (walked + stepLen <= remaining) {
        pts.push(seg.points[k]);
        head = seg.points[k];
        walked += stepLen;
      } else {
        const t = stepLen > 0 ? (remaining - walked) / stepLen : 0;
        head = {
          x: prevPt.x + (seg.points[k].x - prevPt.x) * t,
          y: prevPt.y + (seg.points[k].y - prevPt.y) * t,
        };
        pts.push(head);
        break;
      }
    }
    return {
      d: subPath(pts),
      head,
      // Raster engraving is toned by power; vector cuts keep the layer colour.
      color: seg.powers ? rasterPowerCss(seg.power ?? 100) : colorByLayer.get(seg.layerId ?? '') ?? '#e8eaec',
      dashed: false,
    };
  }, [plan.segments, active, weights, cumulative, progress, totalWeight, colorByLayer]);

  /** Head position when there is no active segment (start/end of the job). */
  const headPosition = useMemo((): Pt | null => {
    if (activeGeometry) return activeGeometry.head;
    for (let i = Math.min(active, plan.segments.length - 1); i >= 0; i -= 1) {
      const p = plan.segments[i]?.points;
      if (p && p.length > 0) return p[p.length - 1];
    }
    return null;
  }, [activeGeometry, active, plan.segments]);

  // --- view helpers -------------------------------------------------------

  /** Screen (CSS px) → world (mm) for the current viewBox. */
  const toWorld = useCallback(
    (sx: number, sy: number): Pt => {
      const vbW = bed.width / zoom;
      const vbH = bed.height / zoom;
      const vbX = (bed.width - vbW) / 2 - panX / zoom;
      const vbY = (bed.height - vbH) / 2 - panY / zoom;
      return {
        x: vbX + (sx / W) * vbW,
        y: vbY + (sy / H) * vbH,
      };
    },
    [bed.width, bed.height, zoom, panX, panY],
  );

  const applyZoomAt = useCallback(
    (nextZoomInput: number, cx: number, cy: number) => {
      const v = viewRef.current;
      const nextZoom = clamp(nextZoomInput, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZoom - v.zoom) < 1e-9) return;
      const world = toWorld(cx, cy);
      // Keep `world` under the cursor after the zoom change.
      const nextPanX = ((world.x - bed.width / 2) * nextZoom) * -1 + (W / 2 - cx) * 0;
      const nextPanY = ((world.y - bed.height / 2) * nextZoom) * -1;
      const next = {
        zoom: nextZoom,
        panX: -((cx / W - 0.5) * (bed.width / nextZoom) + world.x - bed.width / 2) * nextZoom,
        panY: nextPanY,
      };
      void nextPanX;
      viewRef.current = next;
      setView(next);
    },
    [bed.width, bed.height, toWorld],
  );

  const zoomBy = useCallback(
    (factor: number) => applyZoomAt(viewRef.current.zoom * factor, W / 2, H / 2),
    [applyZoomAt],
  );

  const resetView = useCallback(() => {
    const next = { zoom: 1, panX: 0, panY: 0 };
    viewRef.current = next;
    setView(next);
  }, []);

  // Wheel zoom anchored at the cursor (native listener so preventDefault works).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cx = ((e.clientX - rect.left) * W) / rect.width;
      const cy = ((e.clientY - rect.top) * H) / rect.height;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoomAt(viewRef.current.zoom * factor, cx, cy);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [applyZoomAt]);

  // Drag to pan, coalesced to one state update per animation frame.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let activeDrag = false;
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
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      activeDrag = true;
      lastX = e.clientX;
      lastY = e.clientY;
      setDragging(true);
      svg.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!activeDrag) return;
      accX += e.clientX - lastX;
      accY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      schedule();
    };
    const onPointerUp = () => {
      if (activeDrag) flush();
      activeDrag = false;
      setDragging(false);
    };
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('auxclick', onAuxClick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('auxclick', onAuxClick);
    };
  }, []);

  // --- playback -----------------------------------------------------------

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

  // viewBox in world units: zoom scales the box, not the pixels.
  const vbW = bed.width / zoom;
  const vbH = bed.height / zoom;
  const vbX = (bed.width - vbW) / 2 - panX / zoom;
  const vbY = (bed.height - vbH) / 2 - panY / zoom;
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;
  /** Stroke widths are in world units so they stay 1 px on screen at any zoom. */
  const px = vbW / W;

  const gridStep = 10;

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
          <svg
            ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            width={W}
            height={H}
            role="img"
            aria-label="Toolpath preview"
            style={{
              borderRadius: 3,
              border: '1px solid #1a1b1e',
              display: 'block',
              maxWidth: '100%',
              background: '#26282c',
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            <title>Rueda: zoom · Arrastrar (izq./central): mover</title>
            {/* Bed */}
            <rect
              x={0}
              y={0}
              width={bed.width}
              height={bed.height}
              fill="#303236"
              stroke="#55595f"
              strokeWidth={px}
              vectorEffect="non-scaling-stroke"
            />
            {/* Grid */}
            <g stroke="rgba(255,255,255,0.05)" strokeWidth={px} vectorEffect="non-scaling-stroke">
              {Array.from({ length: Math.floor(bed.width / gridStep) + 1 }, (_, i) => (
                <line
                  key={`vx${i}`}
                  x1={i * gridStep}
                  y1={0}
                  x2={i * gridStep}
                  y2={bed.height}
                />
              ))}
              {Array.from({ length: Math.floor(bed.height / gridStep) + 1 }, (_, i) => (
                <line
                  key={`hy${i}`}
                  x1={0}
                  y1={i * gridStep}
                  x2={bed.width}
                  y2={i * gridStep}
                />
              ))}
            </g>

            {/* Travel moves */}
            {showTravel && (
              <path
                d={backdrop.travel}
                fill="none"
                stroke="rgba(210,150,80,0.45)"
                strokeWidth={px}
                strokeDasharray={`${4 * px} ${4 * px}`}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Not yet cut: faint toolpaths */}
            <g opacity={0.32}>
              {backdrop.pending.map((layer) =>
                layer.chunks.map((d, i) => (
                  <path
                    key={`p-${layer.layerId}-${i}`}
                    d={d}
                    fill="none"
                    stroke={layer.color}
                    strokeWidth={px}
                    vectorEffect="non-scaling-stroke"
                  />
                )),
              )}
            </g>

            {/* Already engraved (raster): toned by laser power */}
            {backdrop.raster.map((layer) =>
              layer.chunks.map((d, i) => (
                <path
                  key={`r-${layer.layerId}-${i}`}
                  d={d}
                  fill="none"
                  stroke={layer.color}
                  strokeWidth={px}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}

            {/* Already cut */}
            {backdrop.done.map((layer) =>
              layer.chunks.map((d, i) => (
                <path
                  key={`d-${layer.layerId}-${i}`}
                  d={d}
                  fill="none"
                  stroke={layer.color}
                  strokeWidth={px}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}

            {/* Active segment */}
            {activeGeometry && (
              <path
                d={activeGeometry.d}
                fill="none"
                stroke={activeGeometry.color}
                strokeWidth={px}
                strokeDasharray={activeGeometry.dashed ? `${4 * px} ${3 * px}` : undefined}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Laser head */}
            {headPosition && (
              <g stroke="#ffb357" fill="none" strokeWidth={px} vectorEffect="non-scaling-stroke">
                <circle
                  cx={headPosition.x}
                  cy={headPosition.y}
                  r={6 * px}
                  fill="rgba(255,179,87,0.25)"
                />
                <line
                  x1={headPosition.x - 10 * px}
                  y1={headPosition.y}
                  x2={headPosition.x + 10 * px}
                  y2={headPosition.y}
                />
                <line
                  x1={headPosition.x}
                  y1={headPosition.y - 10 * px}
                  x2={headPosition.x}
                  y2={headPosition.y + 10 * px}
                />
              </g>
            )}
          </svg>

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
              −
            </button>
            <button className="btn" title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
              +
            </button>
            <button className="btn" title="Reset view" onClick={resetView}>
              Fit
            </button>
            <span style={{ minWidth: 44, textAlign: 'right', opacity: 0.7 }}>
              {zoom.toFixed(1)}×
            </span>
          </div>
        </div>

        <aside style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ opacity: 0.6, fontSize: 11 }}>Estimated time</div>
            <div style={{ fontSize: 20 }}>{formatDuration(plan.timeSeconds)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.6, fontSize: 11 }}>Layers</div>
            {plan.layerStats.map((s) => (
              <div
                key={s.layerId}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: s.color,
                    display: 'inline-block',
                  }}
                />
                <span style={{ flex: 1 }}>{s.name}</span>
                <span style={{ opacity: 0.6 }}>{formatDuration(s.seconds)}</span>
              </div>
            ))}
          </div>
          {plan.warnings.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {plan.warnings.length} warning{plan.warnings.length === 1 ? '' : 's'}
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

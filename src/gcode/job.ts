import { FabricImage, type FabricObject } from 'fabric';
import type { CutSettings, LayerDef } from '@/types/document';
import { optimizeSegments } from './optimize';
import { offsetPolygonPoints, polygonArea } from '@/geometry/offset';
import {
  hatchContours,
  objectContours,
  offsetContours,
  rasterRows,
  type Contour,
} from './geometry';
import {
  emptyBounds,
  includePoint,
  type DeviceConfig,
  type JobBounds,
  type JobPlan,
  type LayerStat,
  type PlanSegment,
  type Pt,
} from './types';

const Z_WARNING = 'Z offsets ignored — enable the Z axis in Settings → Machine';

export interface BuildJobInput {
  objects: FabricObject[];
  layers: LayerDef[];
  bed: { width: number; height: number };
  device: DeviceConfig;
}

function layerIdOf(obj: FabricObject): string | undefined {
  return (obj as FabricObject & { layerId?: string }).layerId;
}

function isTextObject(obj: FabricObject): boolean {
  return /text/i.test(obj.type ?? '');
}

function pushContour(
  segments: PlanSegment[],
  contour: Contour,
  layerId: string,
  power: number,
  speed: number,
  passes: number,
  kerf = 0,
  z = 0,
): void {
  let pts = [...contour.points];
  if (contour.closed && pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) pts.pop();

    if (kerf !== 0) {
      const offset = offsetPolygonPoints(pts, kerf);
      // A collapsed inward offset means the shape is smaller than the kerf.
      if (offset.length >= 3 && polygonArea(offset) > 1e-3) pts = offset;
    }
    pts.push(pts[0]);
  }
  if (pts.length < 2) return;

  for (let pass = 0; pass < Math.max(1, passes); pass += 1) {
    segments.push({ kind: 'rapid', points: [pts[0]] });
    segments.push({
      kind: 'cut',
      points: pts,
      layerId,
      power,
      feed: Math.max(1, speed) * 60,
      z,
    });
  }
}

export function buildJob(input: BuildJobInput): JobPlan {
  const { objects, layers, bed, device } = input;
  const segments: PlanSegment[] = [];
  const warnings: string[] = [];
  const stats = new Map<string, LayerStat>();

  const byLayer = new Map<string, FabricObject[]>();
  for (const obj of objects) {
    const id = layerIdOf(obj);
    if (!id) continue;
    const list = byLayer.get(id);
    if (list) list.push(obj);
    else byLayer.set(id, [obj]);
  }

  for (const layer of layers) {
    if (!layer.settings.output) continue;
    const objs = byLayer.get(layer.id);
    if (!objs || objs.length === 0) continue;

    const stat: LayerStat = {
      layerId: layer.id,
      name: layer.name,
      color: layer.color,
      distance: 0,
      seconds: 0,
      segments: 0,
    };
    stats.set(layer.id, stat);

    const before = segments.length;

    for (const obj of objs) {
      const override = (obj as FabricObject & { cutOverride?: Partial<CutSettings> }).cutOverride;
      const s: CutSettings = override ? { ...layer.settings, ...override } : layer.settings;
      const rawZ = Number((obj as FabricObject & { zOffset?: number }).zOffset ?? 0);
      if (rawZ !== 0 && !device.zAxisEnabled && !warnings.includes(Z_WARNING)) {
        warnings.push(Z_WARNING);
      }
      const zOffset = device.zAxisEnabled && Number.isFinite(rawZ) ? rawZ : 0;

      if (s.mode === 'image') {
        if (!(obj instanceof FabricImage)) continue;
        const rows = rasterRows(obj, s.interval, s.power, s.dither);
        if (rows.length === 0) {
          warnings.push(`${layer.name}: image could not be rasterised`);
          continue;
        }
        const feed = Math.max(1, s.speed) * 60;
        for (const row of rows) {
          for (let pass = 0; pass < Math.max(1, s.passes); pass += 1) {
            segments.push({ kind: 'rapid', points: [row.points[0]] });
            segments.push({
              kind: 'cut',
              points: row.points,
              powers: row.powers,
              layerId: layer.id,
              feed,
              z: zOffset,
            });
          }
        }
        continue;
      }

      if (obj instanceof FabricImage) {
        warnings.push(`${layer.name}: image skipped in ${s.mode} mode (use Image mode)`);
        continue;
      }

      let contours: Contour[] = [];

      if (s.mode === 'fill') {
        contours = hatchContours(obj, s.interval, s.overscan, s.angle, s.crossHatch, s.scanOffset);
      } else if (s.mode === 'offsetFill') {
        const base = objectContours(obj);
        contours = base.length
          ? offsetContours(obj, s.offsetDistance > 0 ? s.offsetDistance : s.interval, base)
          : [];
      } else {
        contours = objectContours(obj);
      }

      if (contours.length === 0) {
        if (isTextObject(obj)) {
          warnings.push(
            `${layer.name}: text is not converted to a path — use Tools → Convert to Path`,
          );
        } else {
          warnings.push(`${layer.name}: ${obj.type} skipped (no usable geometry)`);
        }
        continue;
      }

      for (const contour of contours) {
        pushContour(
          segments,
          contour,
          layer.id,
          s.power,
          s.speed,
          s.passes,
          s.mode === 'line' ? s.kerf : 0,
          zOffset,
        );
      }
    }

    stat.segments = segments.length - before;
  }

  const planSegments =
    device.optimizeTravel === false ? segments : optimizeSegments(segments);
  const emitted = emitGcode(planSegments, device, bed);
  const layerStats = [...stats.values()].map((st) => {
    let distance = 0;
    let seconds = 0;
    for (const seg of planSegments) {
      if (seg.kind !== 'cut' || seg.layerId !== st.layerId) continue;
      const d = polylineLength(seg.points);
      distance += d;
      seconds += (d / Math.max(1, seg.feed ?? 600)) * 60;
    }
    return { ...st, distance, seconds };
  });

  let cutDistance = 0;
  let rapidDistance = 0;
  let timeSeconds = 0;
  let bounds = emptyBounds();
  let previous: Pt | null = null;
  let statsZ = 0;
  for (const seg of planSegments) {
    if (seg.kind === 'cut') {
      const z = device.zAxisEnabled ? seg.z ?? 0 : 0;
      if (z !== statsZ) {
        timeSeconds += (Math.abs(z - statsZ) / Math.max(1, device.zFeedRate || 300)) * 60 + 0.05;
        statsZ = z;
      }
      const d = polylineLength(seg.points);
      cutDistance += d;
      timeSeconds += (d / Math.max(1, seg.feed ?? 600)) * 60 + 0.02;
      seg.points.forEach((p) => includePoint(bounds, p));
      if (seg.points.length > 0) previous = seg.points[seg.points.length - 1];
    } else {
      const target = seg.points[0];
      if (!target) continue;
      const d = previous ? Math.hypot(target.x - previous.x, target.y - previous.y) : 0;
      rapidDistance += d;
      timeSeconds += (d / Math.max(1, device.rapidRate)) * 60 + 0.015;
      includePoint(bounds, target);
      previous = target;
    }
  }
  if (device.zAxisEnabled && statsZ !== 0) {
    timeSeconds += (Math.abs(statsZ) / Math.max(1, device.zFeedRate || 300)) * 60 + 0.05;
  }
  if (!Number.isFinite(bounds.minX)) bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  return {
    segments: planSegments,
    bounds,
    gcode: emitted.lines,
    timeSeconds,
    cutDistance,
    rapidDistance,
    layerStats,
    lineCount: emitted.lines.length,
    warnings,
  };
}

function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3);
}

function emitGcode(
  segments: PlanSegment[],
  device: DeviceConfig,
  bed: { width: number; height: number },
): { lines: string[] } {
  const lines: string[] = [
    '; Generated by OpenBurn',
    `; ${new Date().toISOString()}`,
    'G21 ; millimeters',
    'G90 ; absolute positioning',
    'G17 ; XY plane',
    'M5 ; laser off',
  ];
  if (device.homeBeforeJob && segments.length > 0) {
    lines.splice(1, 0, '$H ; home');
  }

  const mapPoint = (p: Pt): Pt => ({
    x: p.x,
    y: device.origin === 'bottom-left' ? bed.height - p.y : p.y,
  });

  let laserOn = false;
  let lastPower = -1;
  let lastFeed = -1;
  let currentZ = 0;
  const zFeed = Math.max(1, Math.round(device.zFeedRate || 300));

  for (const seg of segments) {
    if (seg.points.length === 0) continue;
    if (seg.kind === 'rapid') {
      if (laserOn) {
        lines.push('M5');
        laserOn = false;
      }
      const p = mapPoint(seg.points[0]);
      lines.push(`G0 X${fmt(p.x)} Y${fmt(p.y)}`);
      continue;
    }

    const feed = Math.max(1, Math.round(seg.feed ?? 600));
    const s = Math.max(0, Math.min(device.maxS, Math.round(((seg.power ?? 0) / 100) * device.maxS)));

    const targetZ = device.zAxisEnabled ? seg.z ?? 0 : 0;
    if (targetZ !== currentZ) {
      if (laserOn) {
        lines.push('M5');
        laserOn = false;
      }
      lines.push(`G1 Z${fmt(targetZ)} F${zFeed}`);
      currentZ = targetZ;
    }

    if (feed !== lastFeed) {
      lines.push(`G1 F${feed}`);
      lastFeed = feed;
    }

    if (seg.powers && seg.powers.length > 0) {
      // Raster engraving: power changes inline with motion (S word on G1).
      if (!laserOn) {
        lines.push(`${device.laserMode} S0`);
        laserOn = true;
        lastPower = 0;
      }
      for (let i = 1; i < seg.points.length; i += 1) {
        const p = mapPoint(seg.points[i]);
        const raw = seg.powers[Math.min(i, seg.powers.length - 1)] ?? 0;
        const sVal = Math.max(0, Math.min(device.maxS, Math.round((raw / 100) * device.maxS)));
        const sWord = sVal !== lastPower ? ` S${sVal}` : '';
        lastPower = sVal;
        lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)}${sWord}`);
      }
      continue;
    }

    if (!laserOn || s !== lastPower) {
      lines.push(`${device.laserMode} S${s}`);
      laserOn = true;
      lastPower = s;
    }

    for (let i = 1; i < seg.points.length; i += 1) {
      const p = mapPoint(seg.points[i]);
      lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)}`);
    }
  }

  if (device.zAxisEnabled && currentZ !== 0) {
    if (laserOn) {
      lines.push('M5');
      laserOn = false;
    }
    lines.push(`G1 Z0 F${zFeed}`);
    currentZ = 0;
  }
  if (laserOn) lines.push('M5');
  lines.push('M2');
  return { lines };
}

export function buildFramePlan(
  bounds: { left: number; top: number; width: number; height: number },
  bed: { width: number; height: number },
  device: DeviceConfig,
): JobPlan {
  const x0 = bounds.left;
  const y0 = bounds.top;
  const x1 = bounds.left + bounds.width;
  const y1 = bounds.top + bounds.height;
  const corners: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  // Frame at a controlled feed with the laser explicitly off (S0) instead of
  // G0, which would use the controller's maximum rapid rate.
  const frameSegments: PlanSegment[] = [
    { kind: 'rapid', points: [corners[0]] },
    {
      kind: 'cut',
      points: corners,
      power: 0,
      feed: Math.max(100, device.rapidRate),
    },
  ];
  const { lines } = emitGcode(frameSegments, device, bed);

  let rapidDistance = 0;
  let timeSeconds = 0;
  for (let i = 1; i < corners.length; i += 1) {
    const d = Math.hypot(corners[i].x - corners[i - 1].x, corners[i].y - corners[i - 1].y);
    rapidDistance += d;
    timeSeconds += (d / Math.max(1, device.rapidRate)) * 60;
  }
  const jobBounds = {
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
  };

  return {
    segments: frameSegments,
    bounds: jobBounds,
    gcode: lines,
    timeSeconds,
    cutDistance: rapidDistance,
    rapidDistance: 0,
    layerStats: [],
    lineCount: lines.length,
    warnings: [],
  };
}

export function planToText(plan: JobPlan): string {
  return `${plan.gcode.join('\n')}\n`;
}

export function planBounds(plan: JobPlan): JobBounds {
  return plan.bounds;
}

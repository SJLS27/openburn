import { FabricImage, Textbox, type FabricObject } from 'fabric';
import type { CutSettings, LayerDef } from '@/types/document';
import { optimizePlan, refreshItem, type PlanItem } from './optimize';
import { offsetPolygonPoints, polygonArea } from '@/geometry/offset';
import { textToScenePath } from '@/text/outline';
import {
  applyPowerRamp,
  contoursFromPathData,
  hatchContours,
  hatchPathData,
  objectContours,
  offsetContours,
  rasterRows,
  type Contour,
} from './geometry';
import {
  DEFAULT_OPTIMIZATION,
  emptyBounds,
  includePoint,
  type DeviceConfig,
  type JobBounds,
  type JobPlan,
  type LayerStat,
  type OptimizationSettings,
  type PlanSegment,
  type Pt,
} from './types';

const Z_WARNING = 'Z offsets ignored — enable the Z axis in Settings → Machine';

export interface BuildJobInput {
  objects: FabricObject[];
  layers: LayerDef[];
  bed: { width: number; height: number };
  device: DeviceConfig;
  optimization?: OptimizationSettings;
}

function layerIdOf(obj: FabricObject): string | undefined {
  return (obj as FabricObject & { layerId?: string }).layerId;
}

function isTextObject(obj: FabricObject): boolean {
  return /text/i.test(obj.type ?? '');
}

function isGroupObject(obj: FabricObject): boolean {
  const type = obj.type ?? '';
  return /group/i.test(type) || /activeSelection/i.test(type);
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

/** Total cut length of a flat segment list. */
export function segmentsLength(segments: PlanSegment[]): number {
  return segments.reduce(
    (total, seg) => (seg.kind === 'cut' ? total + polylineLength(seg.points) : total),
    0,
  );
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3);
}

function norm(p: Pt): Pt {
  const len = Math.hypot(p.x, p.y);
  return len < 1e-9 ? { x: 0, y: 0 } : { x: p.x / len, y: p.y / len };
}

/** Append an overcut beyond the start of a closed contour. */
function applyOvercut(points: Pt[], overcut: number): Pt[] {
  if (overcut <= 0 || points.length < 3) return points;
  const start = points[0];
  const prev = points[points.length - 2];
  const dir = norm({ x: start.x - prev.x, y: start.y - prev.y });
  if (dir.x === 0 && dir.y === 0) return points;
  return [...points, { x: start.x + dir.x * overcut, y: start.y + dir.y * overcut }];
}

/** Quadratic arc used to approximate an Arc-style Lead-In/Out. */
function arcPoints(a: Pt, b: Pt, outward: Pt, length: number): Pt[] {
  const control = {
    x: (a.x + b.x) / 2 + outward.x * length * 0.55,
    y: (a.y + b.y) / 2 + outward.y * length * 0.55,
  };
  const out: Pt[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    const mt = 1 - t;
    out.push({
      x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y,
    });
  }
  return out;
}

/**
 * Add Lead-In / Lead-Out lines or arcs to a closed contour. Positive angles
 * place the lead outside the shape, negative angles inside.
 */
function applyLeads(points: Pt[], closed: boolean, s: CutSettings): Pt[] {
  if (!closed || points.length < 3) return points;
  if (!s.leadIn && !s.leadOut) return points;

  const orientation = polygonArea(points) >= 0 ? 1 : -1;
  const angle = (s.leadAngle * Math.PI) / 180;
  const out = [...points];

  const leadVector = (tangent: Pt, outward: Pt): Pt =>
    norm({
      x: tangent.x * Math.cos(angle) + outward.x * Math.sin(angle),
      y: tangent.y * Math.cos(angle) + outward.y * Math.sin(angle),
    });

  if (s.leadIn && s.leadInLength > 0) {
    const start = out[0];
    const next = out[1];
    const tangent = norm({ x: next.x - start.x, y: next.y - start.y });
    const outward =
      orientation >= 0
        ? { x: tangent.y, y: -tangent.x }
        : { x: -tangent.y, y: tangent.x };
    const dir = leadVector(tangent, outward);
    const external = {
      x: start.x + dir.x * s.leadInLength,
      y: start.y + dir.y * s.leadInLength,
    };
    const lead =
      s.leadStyle === 'arc'
        ? arcPoints(external, start, outward, s.leadInLength)
        : [external, start];
    out.unshift(...lead.slice(0, -1));
  }

  if (s.leadOut && s.leadOutLength > 0) {
    const end = out[out.length - 1];
    const prev = out[out.length - 2];
    const tangent = norm({ x: end.x - prev.x, y: end.y - prev.y });
    const outward =
      orientation >= 0
        ? { x: tangent.y, y: -tangent.x }
        : { x: -tangent.y, y: tangent.x };
    const dir = leadVector(tangent, outward);
    const external = {
      x: end.x + dir.x * s.leadOutLength,
      y: end.y + dir.y * s.leadOutLength,
    };
    const lead =
      s.leadStyle === 'arc'
        ? arcPoints(end, external, outward, s.leadOutLength)
        : [end, external];
    out.push(...lead.slice(1));
  }

  return out;
}

/** Split a polyline into cut/skip dashes (LightBurn Perforation Mode). */
function perforate(points: Pt[], cut: number, skip: number, closed: boolean): Pt[][] {
  if (cut <= 0 || skip <= 0 || points.length < 2) return [points];
  const src =
    closed && !samePoint(points[0], points[points.length - 1])
      ? [...points, points[0]]
      : [...points];

  const out: Pt[][] = [];
  let current: Pt[] = [src[0]];
  let cutting = true;
  let remaining = cut;

  for (let i = 1; i < src.length; i += 1) {
    let a = src[i - 1];
    const b = src[i];
    let segmentLength = distance(a, b);

    while (segmentLength > 1e-9) {
      if (remaining > segmentLength) {
        remaining -= segmentLength;
        if (cutting) current.push(b);
        segmentLength = 0;
        break;
      }
      const t = remaining / segmentLength;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (cutting) {
        current.push(p);
        if (current.length > 1) out.push(current);
      }
      cutting = !cutting;
      remaining = cutting ? cut : skip;
      current = cutting ? [p] : [];
      a = p;
      segmentLength = distance(a, b);
    }
  }
  if (cutting && current.length > 1) out.push(current);
  return out;
}

interface ItemMeta {
  layerIndex: number;
  groupIndex: number;
  priority: number;
  layerId: string;
}

function makeItem(
  segments: PlanSegment[],
  meta: ItemMeta,
  reversible: boolean,
): PlanItem | null {
  if (!segments.some((s) => s.kind === 'cut' && s.points.length > 1)) return null;
  const cuts = segments.filter((s) => s.kind === 'cut' && s.points.length > 1);
  const first = cuts[0];
  const last = cuts[cuts.length - 1];
  const closed =
    first.points.length > 2 &&
    samePoint(first.points[0], first.points[first.points.length - 1]);
  return refreshItem({
    layerId: meta.layerId,
    layerIndex: meta.layerIndex,
    groupIndex: meta.groupIndex,
    priority: meta.priority,
    segments,
    start: first.points[0],
    end: last.points[last.points.length - 1],
    centroid: { x: 0, y: 0 },
    area: 0,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    closed,
    reversible,
  });
}

function cutSegment(
  points: Pt[],
  s: CutSettings,
  layerId: string,
  feed: number,
  z: number,
  powers?: number[],
  pausePower?: number,
): PlanSegment {
  return {
    kind: 'cut',
    points,
    layerId,
    power: s.power,
    powers,
    feed,
    z,
    startPause: s.startPause > 0 ? s.startPause : undefined,
    endPause: s.endPause > 0 ? s.endPause : undefined,
    cutThrough: s.cutThrough || undefined,
    pausePower,
    airAssist: s.airAssist || undefined,
  };
}

export async function buildJob(input: BuildJobInput): Promise<JobPlan> {
  const { objects, layers, bed, device } = input;
  const optimization = input.optimization ?? DEFAULT_OPTIMIZATION;
  const items: PlanItem[] = [];
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

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
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

    for (let objectIndex = 0; objectIndex < objs.length; objectIndex += 1) {
      const obj = objs[objectIndex];
      const override = (obj as FabricObject & { cutOverride?: Partial<CutSettings> }).cutOverride;
      const s: CutSettings = override ? { ...layer.settings, ...override } : layer.settings;
      const objZ = Number((obj as FabricObject & { zOffset?: number }).zOffset ?? 0);
      if (objZ !== 0 && !device.zAxisEnabled && !warnings.includes(Z_WARNING)) {
        warnings.push(Z_WARNING);
      }
      const resolvedObjZ = device.zAxisEnabled && Number.isFinite(objZ) ? objZ : 0;
      const baseZ = resolvedObjZ + (device.zAxisEnabled ? s.zOffset : 0);

      const groupBase = isGroupObject(obj) ? objectIndex + 1 : 0;
      const groupIndex =
        s.mode === 'fill' || s.mode === 'offsetFill'
          ? s.fillGrouping === 'individual'
            ? 100000 + objectIndex
            : s.fillGrouping === 'groups'
              ? groupBase
              : 0
          : groupBase;

      const meta: ItemMeta = {
        layerIndex,
        groupIndex,
        priority: Number((obj as FabricObject & { cutPriority?: number }).cutPriority ?? 0),
        layerId: layer.id,
      };
      const feed = Math.max(1, s.speed) * 60;
      const passes = Math.max(1, s.passes);

      if (s.mode === 'image') {
        if (!(obj instanceof FabricImage)) continue;
        const rows = rasterRows(obj, {
          interval: s.interval,
          power: s.power,
          minPower: s.minPower,
          dither: s.dither,
          bidirectional: s.bidirectional,
          negative: s.negative,
          dotWidthCorrection: s.dotWidthCorrection,
          passThrough: s.passThrough,
          rampLength: s.rampLength,
          rampOuter: s.rampOuter,
          cellsPerInch: s.cellsPerInch,
          halftoneAngle: s.halftoneAngle,
        });
        if (rows.length === 0) {
          warnings.push(`${layer.name}: image could not be rasterised`);
          continue;
        }
        const segments: PlanSegment[] = [];
        for (let pass = 0; pass < passes; pass += 1) {
          const z = baseZ + pass * s.zStepPerPass;
          for (const row of rows) {
            segments.push({ kind: 'rapid', points: [row.points[0]] });
            segments.push(cutSegment(row.points, s, layer.id, feed, z, row.powers));
          }
        }
        const item = makeItem(segments, meta, false);
        if (item) items.push(item);
        continue;
      }

      if (obj instanceof FabricImage) {
        warnings.push(`${layer.name}: image skipped in ${s.mode} mode (use Image mode)`);
        continue;
      }

      // Like LightBurn, text is outlined on the fly so it cuts without the
      // user having to run Tools → Convert to Path first.
      let textPathData: string | null = null;
      if (isTextObject(obj)) {
        const traced = await textToScenePath(obj as Textbox);
        textPathData = traced?.pathData ?? null;
      }

      const isFill = s.mode === 'fill';
      const isOffsetFill = s.mode === 'offsetFill';

      if (isFill) {
        // One item per contour when Flood Fill is enabled (allows the planner
        // to reorder hatch lines); otherwise the object stays atomic.
        const perPass: Contour[][] = [];
        for (let pass = 0; pass < passes; pass += 1) {
          const angle = s.angle + pass * s.angleIncrement;
          const contours = textPathData
            ? hatchPathData(
                textPathData,
                s.interval,
                s.overscan,
                angle,
                s.crossHatch,
                s.scanOffset,
                s.bidirectional,
              )
            : hatchContours(
                obj,
                s.interval,
                s.overscan,
                angle,
                s.crossHatch,
                s.scanOffset,
                s.bidirectional,
              );
          perPass.push(contours);
        }

        const total = perPass.reduce((sum, list) => sum + list.length, 0);
        if (total === 0) {
          warnings.push(
            isTextObject(obj)
              ? `${layer.name}: text could not be outlined — check the font or convert it to a path`
              : `${layer.name}: ${obj.type} skipped (no usable geometry)`,
          );
          continue;
        }

        if (s.floodFill) {
          for (let pass = 0; pass < passes; pass += 1) {
            const z = baseZ + pass * s.zStepPerPass;
            for (const contour of perPass[pass]) {
              const points = contour.points;
              if (points.length < 2) continue;
              const powers =
                s.rampLength > 0
                  ? points.map(() => s.power)
                  : undefined;
              if (powers) applyPowerRamp(points, powers, s.power, s.minPower, s.rampLength);
              const segments: PlanSegment[] = [
                { kind: 'rapid', points: [points[0]] },
                cutSegment(points, s, layer.id, feed, z, powers),
              ];
              const item = makeItem(segments, meta, true);
              if (item) items.push(item);
            }
          }
        } else {
          const segments: PlanSegment[] = [];
          for (let pass = 0; pass < passes; pass += 1) {
            const z = baseZ + pass * s.zStepPerPass;
            for (const contour of perPass[pass]) {
              const points = contour.points;
              if (points.length < 2) continue;
              const powers =
                s.rampLength > 0 ? points.map(() => s.power) : undefined;
              if (powers) applyPowerRamp(points, powers, s.power, s.minPower, s.rampLength);
              segments.push({ kind: 'rapid', points: [points[0]] });
              segments.push(cutSegment(points, s, layer.id, feed, z, powers));
            }
          }
          const item = makeItem(segments, meta, false);
          if (item) items.push(item);
        }
        continue;
      }

      // Line / Offset Fill.
      let contours: Contour[];
      if (isOffsetFill) {
        const base = textPathData
          ? contoursFromPathData(textPathData)
          : objectContours(obj);
        contours = base.length
          ? offsetContours(
              obj,
              s.offsetDistance > 0 ? s.offsetDistance : s.interval,
              base,
              textPathData ?? undefined,
            )
          : [];
      } else if (textPathData) {
        contours = contoursFromPathData(textPathData);
      } else {
        contours = objectContours(obj);
      }

      if (contours.length === 0) {
        if (isTextObject(obj)) {
          warnings.push(
            `${layer.name}: text could not be outlined — check the font or convert it to a path`,
          );
        } else {
          warnings.push(`${layer.name}: ${obj.type} skipped (no usable geometry)`);
        }
        continue;
      }

      for (const contour of contours) {
        let pts = [...contour.points];
        const closed = contour.closed;
        if (closed && pts.length > 2) {
          if (samePoint(pts[0], pts[pts.length - 1])) pts.pop();
          if (s.mode === 'line' && s.kerf !== 0) {
            const offset = offsetPolygonPoints(pts, s.kerf);
            // A collapsed inward offset means the shape is smaller than the kerf.
            if (offset.length >= 3 && polygonArea(offset) > 1e-3) pts = offset;
          }
          pts.push(pts[0]);
        }
        if (pts.length < 2) continue;

        if (s.mode === 'line') {
          pts = applyOvercut(pts, s.overcut);
          pts = applyLeads(pts, closed, s);
        }

        const segments: PlanSegment[] = [];
        for (let pass = 0; pass < passes; pass += 1) {
          const z = baseZ + pass * s.zStepPerPass;
          // Overcut and leads make more sense on the final pass, but repeating
          // them every pass matches LightBurn's default behaviour.
          if (s.mode === 'line' && s.perforation && s.perforationCut > 0) {
            const dashes = perforate(pts, s.perforationCut, s.perforationSkip, closed);
            for (const dash of dashes) {
              if (dash.length < 2) continue;
              segments.push({ kind: 'rapid', points: [dash[0]] });
              segments.push(cutSegment(dash, s, layer.id, feed, z));
            }
          } else {
            segments.push({ kind: 'rapid', points: [pts[0]] });
            segments.push(cutSegment(pts, s, layer.id, feed, z));
          }
        }
        const item = makeItem(segments, meta, s.mode !== 'line' || !s.perforation);
        if (item) items.push(item);
      }
    }
  }

  const planSegments = optimizePlan(items, optimization);

  // ---- statistics ---------------------------------------------------------
  for (const stat of stats.values()) {
    let total = 0;
    let seconds = 0;
    for (const seg of planSegments) {
      if (seg.kind !== 'cut' || seg.layerId !== stat.layerId) continue;
      const d = polylineLength(seg.points);
      total += d;
      seconds += (d / Math.max(1, seg.feed ?? 600)) * 60;
    }
    stat.distance = total;
    stat.seconds = seconds;
    stat.segments = planSegments.filter(
      (seg) => seg.kind === 'cut' && seg.layerId === stat.layerId,
    ).length;
  }

  let cutDistance = 0;
  let rapidDistance = 0;
  let timeSeconds = 0;
  let bounds = emptyBounds();
  let previous: Pt | null = null;
  let statsZ = 0;
  const segSeconds: number[] = [];

  for (const seg of planSegments) {
    let seconds = 0;
    if (seg.kind === 'cut') {
      const z = device.zAxisEnabled ? seg.z ?? 0 : 0;
      if (z !== statsZ) {
        seconds += (Math.abs(z - statsZ) / Math.max(1, device.zFeedRate || 300)) * 60 + 0.05;
        statsZ = z;
      }
      const d = polylineLength(seg.points);
      cutDistance += d;
      seconds += (d / Math.max(1, seg.feed ?? 600)) * 60 + 0.02;
      if (seg.startPause) seconds += seg.startPause / 1000;
      if (seg.endPause) seconds += seg.endPause / 1000;
      seg.points.forEach((p) => includePoint(bounds, p));
      if (seg.points.length > 0) previous = seg.points[seg.points.length - 1];
    } else {
      const target = seg.points[0];
      if (!target) {
        segSeconds.push(0);
        continue;
      }
      const d = previous ? distance(target, previous) : 0;
      rapidDistance += d;
      seconds += (d / Math.max(1, device.rapidRate)) * 60 + 0.015;
      includePoint(bounds, target);
      previous = target;
    }
    timeSeconds += seconds;
    segSeconds.push(seconds);
  }
  if (device.zAxisEnabled && statsZ !== 0) {
    timeSeconds += (Math.abs(statsZ) / Math.max(1, device.zFeedRate || 300)) * 60 + 0.05;
  }
  if (!Number.isFinite(bounds.minX)) bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const emitted = emitGcode(planSegments, device, bed);

  return {
    segments: planSegments,
    bounds,
    gcode: emitted.lines,
    timeSeconds,
    cutDistance,
    rapidDistance,
    layerStats: [...stats.values()],
    lineCount: emitted.lines.length,
    warnings,
    segSeconds,
  };
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
  let airOn = false;
  let lastPower = -1;
  let lastFeed = -1;
  let currentZ = 0;
  const zFeed = Math.max(1, Math.round(device.zFeedRate || 300));
  const pauseSeconds = (ms: number) => fmt(ms / 1000);

  for (const seg of segments) {
    if (seg.points.length === 0) continue;
    if (seg.kind === 'rapid') {
      if (laserOn) {
        lines.push('M5');
        laserOn = false;
        lastPower = -1;
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
        lastPower = -1;
      }
      lines.push(`G1 Z${fmt(targetZ)} F${zFeed}`);
      currentZ = targetZ;
    }

    if (seg.airAssist && !airOn) {
      lines.push(device.airAssistCommand ?? 'M8');
      airOn = true;
    } else if (!seg.airAssist && airOn) {
      lines.push('M9');
      airOn = false;
    }

    if (feed !== lastFeed) {
      lines.push(`G1 F${feed}`);
      lastFeed = feed;
    }

    // Start dwell. With Cut Through the beam stays on at the pause power.
    if (seg.startPause && seg.startPause > 0) {
      if (seg.cutThrough) {
        const pauseS = Math.max(
          0,
          Math.min(device.maxS, Math.round(((seg.pausePower ?? 100) / 100) * device.maxS)),
        );
        lines.push(`${device.laserMode} S${pauseS}`);
        laserOn = true;
        lastPower = pauseS;
      }
      lines.push(`G4 P${pauseSeconds(seg.startPause)}`);
      lastPower = -1;
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
    } else {
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

    // End dwell.
    if (seg.endPause && seg.endPause > 0) {
      if (seg.cutThrough) {
        const pauseS = Math.max(
          0,
          Math.min(device.maxS, Math.round(((seg.pausePower ?? 100) / 100) * device.maxS)),
        );
        lines.push(`${device.laserMode} S${pauseS}`);
        lastPower = pauseS;
        lines.push(`G4 P${pauseSeconds(seg.endPause)}`);
        lines.push('M5');
        laserOn = false;
        lastPower = -1;
      } else {
        if (laserOn) {
          lines.push('M5');
          laserOn = false;
          lastPower = -1;
        }
        lines.push(`G4 P${pauseSeconds(seg.endPause)}`);
      }
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
  if (airOn) lines.push('M9');
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
    segSeconds: frameSegments.map(() => timeSeconds / 2),
  };
}

export function planToText(plan: JobPlan): string {
  return `${plan.gcode.join('\n')}\n`;
}

export function planBounds(plan: JobPlan): JobBounds {
  return plan.bounds;
}

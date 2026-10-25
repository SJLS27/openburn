export interface Pt {
  x: number;
  y: number;
}

export type SegmentKind = 'rapid' | 'cut';

export interface PlanSegment {
  kind: SegmentKind;
  points: Pt[];
  layerId?: string;
  /** 0 - 100 (%) */
  power?: number;
  /** Per-point power for raster engraving (same length as points). */
  powers?: number[];
  /** mm / min */
  feed?: number;
  /** Z height in mm (only used when the device has a Z axis) */
  z?: number;
  /** Dwell before the cut starts, in milliseconds (Line mode). */
  startPause?: number;
  /** Dwell after the cut ends, in milliseconds (Line mode). */
  endPause?: number;
  /** Fire the laser during the pauses instead of leaving it off. */
  cutThrough?: boolean;
  /** Power % to use while Cut Through is pausing. */
  pausePower?: number;
  /** Enable air assist (M7/M8) for this segment. */
  airAssist?: boolean;
}

export interface LayerStat {
  layerId: string;
  name: string;
  color: string;
  distance: number;
  seconds: number;
  segments: number;
}

export interface JobBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface JobPlan {
  segments: PlanSegment[];
  bounds: JobBounds;
  gcode: string[];
  timeSeconds: number;
  cutDistance: number;
  rapidDistance: number;
  layerStats: LayerStat[];
  lineCount: number;
  warnings: string[];
  /** Time (seconds) spent on each segment, parallel to `segments`. */
  segSeconds?: number[];
}

/** Criteria used to sort cut units before optimising (LightBurn "Order by"). */
export type CutOrderKey = 'layer' | 'group' | 'priority';

/** "Cut in direction order" options (LightBurn). */
export type DirectionOrder = 'none' | 'topBottom' | 'bottomTop' | 'leftRight' | 'rightLeft';

/**
 * Cut planner settings, mirroring LightBurn's Optimization Settings window.
 * All of these only apply when `enabled` is true.
 */
export interface OptimizationSettings {
  enabled: boolean;
  /** Ordered list of sorting criteria (first has highest precedence). */
  orderBy: CutOrderKey[];
  cutInnerFirst: boolean;
  cutInDirectionOrder: DirectionOrder;
  reduceTravel: boolean;
  reduceDirectionChanges: boolean;
  chooseBestStartingPoint: boolean;
  chooseCorners: boolean;
  chooseBestDirection: boolean;
  removeOverlapping: boolean;
  /** Distance (mm) under which two overlapping lines are considered equal. */
  overlapTolerance: number;
}

export const DEFAULT_OPTIMIZATION: OptimizationSettings = {
  enabled: true,
  orderBy: ['layer'],
  cutInnerFirst: true,
  cutInDirectionOrder: 'none',
  reduceTravel: true,
  reduceDirectionChanges: false,
  chooseBestStartingPoint: true,
  chooseCorners: false,
  chooseBestDirection: true,
  removeOverlapping: false,
  overlapTolerance: 0.05,
};

export interface DeviceConfig {
  type: 'grbl';
  name: string;
  baudRate: number;
  /** Maximum S word value (GRBL usually 1000) */
  maxS: number;
  /** Rapid / travel speed in mm per minute */
  rapidRate: number;
  laserMode: 'M3' | 'M4';
  /** Bed origin corner used by the controller */
  origin: 'bottom-left' | 'top-left';
  /** Home the machine before each job */
  homeBeforeJob: boolean;
  /** Reorder cut segments to minimise travel */
  optimizeTravel: boolean;
  /** Z axis available (required for Focus Test and per-object Z offsets) */
  zAxisEnabled: boolean;
  /** Z move feed rate in mm per minute */
  zFeedRate: number;
  /** GCode command used to enable air assist */
  airAssistCommand: 'M7' | 'M8';
}

export const DEFAULT_DEVICE: DeviceConfig = {
  type: 'grbl',
  name: 'GRBL',
  baudRate: 115200,
  maxS: 1000,
  rapidRate: 3000,
  laserMode: 'M4',
  origin: 'bottom-left',
  homeBeforeJob: false,
  optimizeTravel: true,
  zAxisEnabled: false,
  zFeedRate: 300,
  airAssistCommand: 'M8',
};

export function emptyBounds(): JobBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function includePoint(b: JobBounds, p: Pt): void {
  b.minX = Math.min(b.minX, p.x);
  b.minY = Math.min(b.minY, p.y);
  b.maxX = Math.max(b.maxX, p.x);
  b.maxY = Math.max(b.maxY, p.y);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

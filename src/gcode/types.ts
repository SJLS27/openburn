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
}

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

import { DEFAULT_SNAP_RADIUS_PX } from '@/workspace/snap';

/**
 * Versioned snap preferences.
 *
 * Everything about snapping lives in one typed block so new kinds of targets
 * (guides, tangents, …) are added as fields here instead of new global state.
 * `version` lets the older `snapToGrid` boolean be migrated exactly once.
 */
export interface SnapSettings {
  version: 1;
  enabled: boolean;
  grid: boolean;
  objects: boolean;
  intersections: boolean;
  /** Capture radius in device pixels, constant at every zoom. */
  radiusPx: number;
}

export const SNAP_SETTINGS_KEY = 'openburn.snap';

const MIN_RADIUS_PX = 2;
const MAX_RADIUS_PX = 30;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  version: 1,
  enabled: false,
  grid: true,
  objects: true,
  intersections: true,
  radiusPx: DEFAULT_SNAP_RADIUS_PX,
};

function clampRadius(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SNAP_RADIUS_PX;
  return Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export interface SnapMigrationInput {
  /** Value of the old `snapToGrid` flag when no stored blob exists yet. */
  legacySnapToGrid?: boolean;
  /** Decoded `localStorage` blob, if any. */
  stored?: unknown;
}

/**
 * Normalise stored settings. Stored values win field by field; a legacy
 * boolean only seeds `enabled` and leaves object snapping off so existing
 * users keep the behaviour they configured.
 */
export function migrateSnapSettings(input: SnapMigrationInput = {}): SnapSettings {
  const stored = (input.stored && typeof input.stored === 'object' ? input.stored : {}) as Partial<SnapSettings>;
  const legacy = typeof input.legacySnapToGrid === 'boolean' ? input.legacySnapToGrid : undefined;
  const hasStored = typeof stored.enabled === 'boolean';
  const enabled = bool(stored.enabled, legacy ?? DEFAULT_SNAP_SETTINGS.enabled);
  return {
    version: 1,
    enabled,
    grid: bool(stored.grid, DEFAULT_SNAP_SETTINGS.grid),
    objects: bool(stored.objects, hasStored ? DEFAULT_SNAP_SETTINGS.objects : legacy ? false : DEFAULT_SNAP_SETTINGS.objects),
    intersections: bool(stored.intersections, DEFAULT_SNAP_SETTINGS.intersections),
    radiusPx: clampRadius(stored.radiusPx),
  };
}

export function loadSnapSettings(storage: Storage | null = (typeof localStorage !== 'undefined' ? localStorage : null)): SnapSettings {
  if (!storage) return { ...DEFAULT_SNAP_SETTINGS };
  try {
    const raw = storage.getItem(SNAP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SNAP_SETTINGS };
    return migrateSnapSettings({ stored: JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_SNAP_SETTINGS };
  }
}

export function saveSnapSettings(settings: SnapSettings, storage: Storage | null = (typeof localStorage !== 'undefined' ? localStorage : null)): void {
  if (!storage) return;
  try {
    storage.setItem(SNAP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}

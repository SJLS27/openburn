import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SNAP_SETTINGS, SNAP_SETTINGS_KEY, loadSnapSettings, migrateSnapSettings } from './snapSettings';
import { DEFAULT_SNAP_RADIUS_PX } from '@/workspace/snap';

describe('state/snapSettings', () => {
  it('starts with grid-only snapping off, like the old boolean', () => {
    expect(DEFAULT_SNAP_SETTINGS).toMatchObject({ enabled: false, grid: true, objects: true, intersections: true });
    expect(DEFAULT_SNAP_SETTINGS.radiusPx).toBe(DEFAULT_SNAP_RADIUS_PX);
    expect(DEFAULT_SNAP_SETTINGS.version).toBe(1);
  });

  it('migrates the legacy `snapToGrid` boolean', () => {
    expect(migrateSnapSettings({ legacySnapToGrid: true }).enabled).toBe(true);
    expect(migrateSnapSettings({ legacySnapToGrid: false }).enabled).toBe(false);
  });

  it('turns object snapping off when only the legacy flag is present', () => {
    // Someone who used "snap to grid" does not expect snapping to objects.
    const migrated = migrateSnapSettings({ legacySnapToGrid: true });
    expect(migrated.grid).toBe(true);
    expect(migrated.objects).toBe(false);
  });

  it('fills missing fields when hydrating a stored blob', () => {
    const settings = migrateSnapSettings({ stored: { enabled: true, objects: false } });
    expect(settings.enabled).toBe(true);
    expect(settings.objects).toBe(false);
    expect(settings.grid).toBe(DEFAULT_SNAP_SETTINGS.grid);
    expect(settings.radiusPx).toBe(DEFAULT_SNAP_SETTINGS.radiusPx);
  });

  it('clamps the capture radius to a sane range', () => {
    expect(migrateSnapSettings({ stored: { radiusPx: 1 } }).radiusPx).toBe(2);
    expect(migrateSnapSettings({ stored: { radiusPx: 999 } }).radiusPx).toBe(30);
    expect(migrateSnapSettings({ stored: { radiusPx: Number.NaN } }).radiusPx).toBe(DEFAULT_SNAP_RADIUS_PX);
  });

  it('reads the stored settings from localStorage', () => {
    const getItem = vi.fn(() => JSON.stringify({ version: 1, enabled: true, objects: true }));
    const settings = loadSnapSettings({ getItem } as unknown as Storage);
    expect(getItem).toHaveBeenCalledWith(SNAP_SETTINGS_KEY);
    expect(settings.enabled).toBe(true);
    expect(settings.objects).toBe(true);
  });

  it('survives corrupted storage', () => {
    const getItem = vi.fn(() => '{not json');
    expect(loadSnapSettings({ getItem } as unknown as Storage)).toEqual(DEFAULT_SNAP_SETTINGS);
    const boom = vi.fn(() => {
      throw new Error('denied');
    });
    expect(loadSnapSettings({ getItem: boom } as unknown as Storage)).toEqual(DEFAULT_SNAP_SETTINGS);
    expect(loadSnapSettings(null)).toEqual(DEFAULT_SNAP_SETTINGS);
  });
});

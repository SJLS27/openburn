import { describe, expect, it } from 'vitest';
import { DEFAULT_CUT_SETTINGS, createLayer, type LayerDef } from '@/types/document';
import { findImageLayer } from './layers';

function layer(id: string, mode: LayerDef['settings']['mode']): LayerDef {
  return { ...createLayer(0), id, settings: { ...DEFAULT_CUT_SETTINGS, mode } };
}

describe('findImageLayer', () => {
  it('prefers the active layer when it is an Image layer', () => {
    const layers = [layer('a', 'line'), layer('b', 'image'), layer('c', 'image')];
    expect(findImageLayer(layers, 'c')?.id).toBe('c');
  });

  it('falls back to the first Image layer when the active one is not', () => {
    const layers = [layer('a', 'line'), layer('b', 'image')];
    expect(findImageLayer(layers, 'a')?.id).toBe('b');
  });

  it('returns undefined when no layer is in Image mode', () => {
    const layers = [layer('a', 'line'), layer('b', 'fill')];
    expect(findImageLayer(layers, 'a')).toBeUndefined();
  });
});

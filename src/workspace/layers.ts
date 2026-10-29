import type { LayerDef } from '@/types/document';

/**
 * Choose the layer a raster image should be placed on, mirroring LightBurn:
 * images belong on a layer whose mode is "Image" (Scan/Image), never on a Line
 * layer where the job would skip them.
 *
 * Preference order:
 *  1. The active layer, when it is already an Image layer.
 *  2. The first Image layer in the document.
 *
 * Returns `undefined` when there is no Image layer yet; the caller creates one.
 */
export function findImageLayer(
  layers: LayerDef[],
  activeLayerId: string,
): LayerDef | undefined {
  const active = layers.find((l) => l.id === activeLayerId);
  if (active?.settings.mode === 'image') return active;
  return layers.find((l) => l.settings.mode === 'image');
}

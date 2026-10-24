/**
 * OpenBurn document model.
 *
 * The native format (.obrn) is a versioned JSON envelope around the Fabric.js
 * scene graph plus OpenBurn-specific metadata (layers, cut settings, bed size).
 */

export type Units = 'mm' | 'in';

export type CutMode = 'line' | 'fill' | 'offsetFill' | 'image';

export type DitherMode = 'none' | 'jarvis' | 'atkinson' | 'ordered' | 'stucki';

export interface CutSettings {
  mode: CutMode;
  /** mm / second */
  speed: number;
  /** 0 - 100 % */
  power: number;
  passes: number;
  /** Line interval for fill modes, in mm */
  interval: number;
  /** Offset distance for offset-fill, in mm */
  offsetDistance: number;
  /** Extra travel distance for fill scanning, in mm */
  overscan: number;
  /** Fill scan angle in degrees (0 = horizontal) */
  angle: number;
  /** Add a second fill pass at angle + 90° */
  crossHatch: boolean;
  /** Kerf compensation for closed line cuts, in mm (positive expands) */
  kerf: number;
  /** Raster scan delay compensation, in mm along the scan direction */
  scanOffset: number;
  dither: DitherMode;
  /** Send this layer to the laser */
  output: boolean;
  /** Show this layer in the editor */
  visible: boolean;
  airAssist: boolean;
}

/** Per-object cut setting overrides (used by material/interval tests). */
export interface CutOverride {
  mode?: CutMode;
  speed?: number;
  power?: number;
  passes?: number;
  interval?: number;
  offsetDistance?: number;
  overscan?: number;
  dither?: DitherMode;
}

/** Tone adjustments applied to raster images before engraving. */
export interface ImageAdjust {
  /** -100 .. 100 */
  brightness: number;
  /** -100 .. 100 */
  contrast: number;
  /** 0.2 .. 3 */
  gamma: number;
  /** -1 disables thresholding, 0 .. 255 otherwise */
  threshold: number;
  invert: boolean;
}

export const DEFAULT_IMAGE_ADJUST: ImageAdjust = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  threshold: -1,
  invert: false,
};

export interface LayerDef {
  /** Stable id referenced by shapes (`shape.layerId`) */
  id: string;
  name: string;
  /** Display + preview colour (hex) */
  color: string;
  settings: CutSettings;
}

export interface BedConfig {
  width: number;
  height: number;
  /** Show the bed-outline rectangle */
  showOutline: boolean;
}

export interface PageDef {
  id: string;
  name: string;
  canvas: unknown;
}

export interface DocumentMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenBurnDocument {
  format: 'openburn';
  version: 1;
  units: Units;
  bed: BedConfig;
  layers: LayerDef[];
  /** Fabric.js scene graph (JSON) */
  canvas: unknown;
  pages?: PageDef[];
  meta: DocumentMeta;
}

export const DEFAULT_CUT_SETTINGS: CutSettings = {
  mode: 'line',
  speed: 20,
  power: 50,
  passes: 1,
  interval: 0.1,
  offsetDistance: 0.2,
  overscan: 2.5,
  angle: 0,
  crossHatch: false,
  kerf: 0,
  scanOffset: 0,
  dither: 'none',
  output: true,
  visible: true,
  airAssist: false,
};

/** LightBurn-style palette. Each swatch is a usable layer. */
export const PALETTE_COLORS = [
  '#000000',
  '#0000ff',
  '#ff0000',
  '#00a000',
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#ff8000',
  '#8000ff',
  '#008080',
  '#804000',
  '#c0c0c0',
  '#808080',
  '#004080',
  '#800000',
  '#008000',
  '#808000',
  '#800080',
  '#008040',
  '#400080',
  '#804040',
  '#b0b0b0',
  '#404040',
  '#a06020',
  '#2070c0',
  '#c02070',
  '#70c020',
  '#c0a000',
] as const;

export const LAYER_NAMES = ['C00', 'C01', 'C02', 'C03'];

export function createLayer(index: number): LayerDef {
  const color = PALETTE_COLORS[index % PALETTE_COLORS.length];
  const hex = color.replace('#', '').toUpperCase();
  return {
    id: `layer-${hex}`,
    name: `C${String(index).padStart(2, '0')}`,
    color,
    settings: { ...DEFAULT_CUT_SETTINGS },
  };
}

export function createDefaultLayers(): LayerDef[] {
  // OpenBurn starts with a handful of layers, like LightBurn's default palette.
  return Array.from({ length: 8 }, (_, i) => createLayer(i));
}

export function createEmptyDocument(name = 'Untitled'): OpenBurnDocument {
  const now = new Date().toISOString();
  return {
    format: 'openburn',
    version: 1,
    units: 'mm',
    bed: { width: 400, height: 400, showOutline: true },
    layers: createDefaultLayers(),
    canvas: { version: '6', objects: [] },
    meta: { name, createdAt: now, updatedAt: now },
  };
}

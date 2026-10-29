import { useSyncExternalStore } from 'react';
import {
  createEmptyDocument,
  createLayer,
  type CutSettings,
  type ImageAdjust,
  type LayerDef,
  type OpenBurnDocument,
  type Units,
} from '@/types/document';
import { DEFAULT_DEVICE, DEFAULT_OPTIMIZATION, type DeviceConfig, type JobPlan, type OptimizationSettings } from '@/gcode/types';
import type { TraceOptions } from '@/image/trace';

export type ToolId =
  | 'select'
  | 'node'
  | 'line'
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'polygon'
  | 'text'
  | 'measure'
  | 'pan'
  | 'zoom';

export interface SelectionSnapshot {
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  /** Layer ids of the selected shapes */
  layerIds: string[];
  /** Number of selected objects with per-object cut overrides */
  overrideCount: number;
  /** Per-object Z offset in mm (first selected object) */
  zOffset: number;
  /** Cut order priority of the first selected object */
  cutPriority: number;
}

export interface AppState {
  doc: OpenBurnDocument;
  filePath: string | null;
  dirty: boolean;

  tool: ToolId;
  activeLayerId: string;
  polygonSides: number;

  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;

  zoom: number;
  selection: SelectionSnapshot | null;
  cursor: { x: number; y: number } | null;
  statusText: string;

  canUndo: boolean;
  canRedo: boolean;

  showPreview: boolean;
  beginnerMode: boolean;
  device: DeviceConfig;
  optimization: OptimizationSettings;
}

const DEVICE_KEY = 'openburn.device';
const OPTIMIZATION_KEY = 'openburn.optimization';
const LAYER_DEFAULTS_KEY = 'openburn.layerDefaults';

function loadDevice(): DeviceConfig {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceConfig>;
      return { ...DEFAULT_DEVICE, ...parsed };
    }
  } catch {
    /* ignore corrupted settings */
  }
  return { ...DEFAULT_DEVICE };
}

function loadOptimization(): OptimizationSettings {
  try {
    const raw = localStorage.getItem(OPTIMIZATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OptimizationSettings>;
      return {
        ...DEFAULT_OPTIMIZATION,
        ...parsed,
        orderBy: Array.isArray(parsed.orderBy) && parsed.orderBy.length
          ? parsed.orderBy
          : DEFAULT_OPTIMIZATION.orderBy,
      };
    }
  } catch {
    /* ignore corrupted settings */
  }
  return { ...DEFAULT_OPTIMIZATION };
}

function initialState(): AppState {
  const doc = createEmptyDocument();
  return {
    doc,
    filePath: null,
    dirty: false,
    tool: 'select',
    activeLayerId: doc.layers[0].id,
    polygonSides: 6,
    gridSize: 10,
    showGrid: true,
    snapToGrid: false,
    zoom: 1,
    selection: null,
    cursor: null,
    statusText: 'Ready',
    canUndo: false,
    canRedo: false,
    showPreview: false,
    beginnerMode: false,
    device: loadDevice(),
    optimization: loadOptimization(),
  };
}

type Listener = () => void;

class AppStore {
  private state: AppState = initialState();
  private listeners = new Set<Listener>();

  getState = (): AppState => this.state;

  setState = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ---- document helpers ---------------------------------------------------

  replaceDocument(doc: OpenBurnDocument, filePath: string | null = null): void {
    this.setState({
      doc,
      filePath,
      dirty: false,
      activeLayerId: doc.layers[0]?.id ?? '',
      selection: null,
      canUndo: false,
      canRedo: false,
    });
  }

  updateLayer(layerId: string, patch: Partial<LayerDef>): void {
    const doc = this.state.doc;
    const layers = doc.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l));
    this.setState({ doc: { ...doc, layers }, dirty: true });
  }

  updateCutSettings(layerId: string, patch: Partial<CutSettings>): void {
    const doc = this.state.doc;
    const layers = doc.layers.map((l) =>
      l.id === layerId ? { ...l, settings: { ...l.settings, ...patch } } : l,
    );
    this.setState({ doc: { ...doc, layers }, dirty: true });
  }

  addLayer(): LayerDef {
    const doc = this.state.doc;
    let index = doc.layers.length;
    let layer = createLayer(index);
    while (doc.layers.some((l) => l.id === layer.id)) {
      index += 1;
      layer = createLayer(index);
    }
    this.setState({
      doc: { ...doc, layers: [...doc.layers, layer] },
      activeLayerId: layer.id,
      dirty: true,
    });
    return layer;
  }

  removeLayer(layerId: string): void {
    const doc = this.state.doc;
    const layers = doc.layers.filter((l) => l.id !== layerId);
    if (layers.length === 0) return;
    this.setState({
      doc: { ...doc, layers },
      activeLayerId:
        this.state.activeLayerId === layerId ? layers[0].id : this.state.activeLayerId,
      dirty: true,
    });
  }

  setUnits(units: Units): void {
    this.setState({ doc: { ...this.state.doc, units }, dirty: true });
  }

  setBed(width: number, height: number): void {
    const doc = this.state.doc;
    this.setState({ doc: { ...doc, bed: { ...doc.bed, width, height } }, dirty: true });
  }

  updateDevice(patch: Partial<DeviceConfig>): void {
    const device = { ...this.state.device, ...patch };
    try {
      localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    } catch {
      /* storage may be unavailable */
    }
    this.setState({ device });
  }

  updateOptimization(patch: Partial<OptimizationSettings>): void {
    const optimization = { ...this.state.optimization, ...patch };
    try {
      localStorage.setItem(OPTIMIZATION_KEY, JSON.stringify(optimization));
    } catch {
      /* storage may be unavailable */
    }
    this.setState({ optimization });
  }

  /** Move a layer up (-1) or down (+1) in the cut order. */
  moveLayer(layerId: string, delta: number): void {
    const doc = this.state.doc;
    const index = doc.layers.findIndex((l) => l.id === layerId);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= doc.layers.length) return;
    const layers = [...doc.layers];
    const [layer] = layers.splice(index, 1);
    layers.splice(target, 0, layer);
    this.setState({ doc: { ...doc, layers }, dirty: true });
  }

  /**
   * LightBurn "Sort Cuts Last": order by how strongly a layer burns (higher
   * power, slower speed, more passes first), then push Line-mode layers to the
   * end so engraving happens before cutting.
   */
  sortCutsLast(): void {
    const doc = this.state.doc;
    const strength = (s: CutSettings): number =>
      s.power - s.speed / 10 + s.passes * 5;
    const sorted = [...doc.layers].sort((a, b) => {
      const aLine = a.settings.mode === 'line' ? 1 : 0;
      const bLine = b.settings.mode === 'line' ? 1 : 0;
      if (aLine !== bLine) return aLine - bLine;
      return strength(b.settings) - strength(a.settings);
    });
    this.setState({ doc: { ...doc, layers: sorted }, dirty: true });
  }

  // ---- per-layer defaults (LightBurn "Default Layer Settings") ------------

  private loadLayerDefaults(): Record<string, CutSettings> {
    try {
      const raw = localStorage.getItem(LAYER_DEFAULTS_KEY);
      if (raw) return JSON.parse(raw) as Record<string, CutSettings>;
    } catch {
      /* ignore corrupted defaults */
    }
    return {};
  }

  hasLayerDefaults(layerId: string): boolean {
    return !!this.loadLayerDefaults()[layerId];
  }

  saveLayerDefaults(layerId: string): void {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const all = this.loadLayerDefaults();
    all[layerId] = { ...layer.settings };
    try {
      localStorage.setItem(LAYER_DEFAULTS_KEY, JSON.stringify(all));
    } catch {
      /* storage may be unavailable */
    }
  }

  resetLayerDefaults(layerId: string): void {
    const all = this.loadLayerDefaults();
    const saved = all[layerId];
    if (!saved) return;
    this.updateCutSettings(layerId, { ...saved });
  }

  markDirty(dirty = true): void {
    if (this.state.dirty !== dirty) this.setState({ dirty });
  }

  setHistoryState(canUndo: boolean, canRedo: boolean): void {
    if (this.state.canUndo !== canUndo || this.state.canRedo !== canRedo) {
      this.setState({ canUndo, canRedo });
    }
  }
}

export const store = new AppStore();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * Imperative bridge to the workspace controller (Fabric canvas). Registered by
 * the workspace component so toolbars and menus can invoke commands.
 */
export interface WorkspaceApi {
  newDocument(): void;
  openDocument(): Promise<void>;
  openLightBurn(): Promise<void>;
  saveLightBurn(format: 'lbrn' | 'lbrn2'): Promise<void>;
  saveDocument(saveAs?: boolean): Promise<void>;
  importFile(): Promise<void>;
  exportSvg(): Promise<void>;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): void;
  pasteClipboard(): Promise<void>;
  pasteSmart(): Promise<void>;
  pasteInPlace(): Promise<void>;
  pasteFromSystem(): Promise<void>;
  selectAll(): void;
  invertSelection(): void;
  deleteDuplicates(): void;
  mirrorAcrossLine(): void;
  rotateByTwoPoints(): void;
  group(): void;
  ungroup(): void;
  bringToFront(): void;
  sendToBack(): void;
  zoomToPage(): void;
  zoomToFitSelection(): void;
  zoomBy(factor: number): void;
  flip(axis: 'h' | 'v'): void;
  rotate(degrees: number): void;
  align(mode: AlignMode): void;
  distribute(axis: 'h' | 'v'): void;
  booleanOp(op: BooleanOp): void;
  offsetShapes(distance: number): void;
  arrayGrid(rows: number, cols: number, dx: number, dy: number): void;
  arrayCircular(count: number, radius: number, startAngle: number): void;
  setLayerOfSelection(layerId: string): void;
  setSelectionCutPriority(priority: number): void;
  selectLayerObjects(layerId: string): void;
  flashLayer(layerId: string): void;
  copyLayerSettings(layerId: string): void;
  pasteLayerSettings(layerId: string): void;
  applyNumeric(patch: Partial<{ x: number; y: number; width: number; height: number; angle: number }>): void;
  applyTextStyle(patch: {
    fontSize?: number;
    charSpacing?: number;
    lineHeight?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
  }): void;
  convertToPath(): Promise<void>;
  closePath(): void;
  breakApart(): void;
  setStartPoint(): void;
  traceImage(): void;
  applyCutPreview(): void;
  generateJob(cutSelectionOnly: boolean): Promise<JobPlan>;
  generateFrameJob(): JobPlan | null;
  exportGcode(cutSelectionOnly?: boolean): Promise<void>;
  clearCutOverride(): void;
  generateMaterialTest(options: MaterialTestOptions): void;
  generateIntervalTest(options: IntervalTestOptions): void;
  generateFocusTest(options: FocusTestOptions): void;
  generateKerfTest(options: KerfTestOptions): void;
  setSelectionZOffset(z: number): void;
  applyImageAdjust(adjust: ImageAdjust): void;
  getSelectedImageInfo(): { dataUrl: string; adjust: ImageAdjust } | null;
  traceSelectedImage(options: TraceOptions): Promise<void>;
  applyMaskToImage(): Promise<void>;
  addTabs(tabWidth: number, spacing: number): void;
  updateCursor(x: number, y: number): void;
  setStatus(text: string): void;
}

export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'centerPage'
  | 'centerHPage'
  | 'centerVPage';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export interface MaterialTestOptions {
  powerMin: number;
  powerMax: number;
  powerSteps: number;
  speedMin: number;
  speedMax: number;
  speedSteps: number;
  cellSize: number;
  gap: number;
  mode: 'line' | 'fill';
  passes: number;
  interval: number;
  labels: boolean;
  angle: number;
  crossHatch: boolean;
  sublayers: boolean;
}

export interface FocusTestOptions {
  zMin: number;
  zMax: number;
  steps: number;
  lineLength: number;
  gap: number;
  repeats: number;
  speed: number;
  power: number;
  passes: number;
  labels: boolean;
}

export interface KerfTestOptions {
  method: 'slot' | 'span';
  nominalWidth: number;
  spacing: number;
  length: number;
  count: number;
  labels: boolean;
}

export interface IntervalTestOptions {
  intervalMin: number;
  intervalMax: number;
  steps: number;
  cellSize: number;
  speed: number;
  power: number;
  labels: boolean;
}

let workspaceApi: WorkspaceApi | null = null;

export function registerWorkspaceApi(api: WorkspaceApi): void {
  workspaceApi = api;
}

export function ws(): WorkspaceApi {
  if (!workspaceApi) throw new Error('Workspace not ready');
  return workspaceApi;
}

export function getWorkspaceApi(): WorkspaceApi | null {
  return workspaceApi;
}

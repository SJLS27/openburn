import {
  ActiveSelection,
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  Line,
  Path as FabricPath,
  Point,
  Polygon,
  Rect,
  Textbox,
  loadSVGFromString,
  util,
} from 'fabric';
import { BackgroundRenderer } from './background';
import {
  registerWorkspaceApi,
  store,
  type AlignMode,
  type BooleanOp,
  type FocusTestOptions,
  type IntervalTestOptions,
  type KerfTestOptions,
  type MaterialTestOptions,
  type ToolId,
  type WorkspaceApi,
} from '@/state/store';
import { buildDocument, parseDocument, serializeDocument } from '@/core/serialize';
import {
  pickArtwork,
  pickProject,
  saveProjectFile,
  saveTextFile,
} from '@/core/fileApi';
import { booleanObjects, isConvertible, objectToPathData } from '@/geometry/paperOps';
import { offsetPathData } from '@/geometry/offset';
import { objectContours } from '@/gcode/geometry';
import { parseDxf } from '@/core/dxf';
import { prepareSvgForImport, applySvgPhysicalSize } from '@/io/svg';
import { buildFramePlan, buildJob, planToText } from '@/gcode/job';
import type { JobPlan, Pt } from '@/gcode/types';
import { DEFAULT_IMAGE_ADJUST, type ImageAdjust, type LayerDef } from '@/types/document';
import { textToScenePath } from '@/text/outline';
import { addTabsToContour } from '@/geometry/tabs';
import { traceImageObject, type TraceOptions } from '@/image/trace';
import {
  parseLightBurn,
  serializeLightBurn,
  type LightBurnFormat,
  type LightBurnImportResult,
} from '@/io/lightburn';

// Serialize our per-object layer assignment along with everything else.
FabricObject.customProperties = ['layerId', 'cutOverride', 'imageAdjust', 'zOffset'];
Group.customProperties = ['layerId', 'cutOverride', 'imageAdjust', 'zOffset'];

const SELECTION_ACCENT = '#3f8fdd';

interface DrawState {
  tool: ToolId;
  start: Point;
  obj?: FabricObject;
}

export class WorkspaceController implements WorkspaceApi {
  private canvas!: Canvas;
  private bg!: BackgroundRenderer;
  private host: HTMLElement;
  private fabricEl: HTMLCanvasElement;
  private bgEl: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;

  private drawing: DrawState | null = null;
  private panning = false;
  private spaceDown = false;
  private lastPan = { x: 0, y: 0 };
  private disposed = false;

  private nodeTarget: FabricPath | null = null;
  private nodeHandles: { circle: Circle; commandIndex: number }[] = [];
  private nodeDragging = false;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private currentSnapshot = '';
  private suppressHistory = false;
  private editingText = false;
  private historyTimer: number | null = null;
  private clipboard: Record<string, unknown>[] = [];
  private lastCursorPush = 0;

  private lastLayers = store.getState().doc.layers;
  private lastTool: ToolId = store.getState().tool;
  private lastBgKey = '';
  private unsubscribe: () => void;

  constructor(host: HTMLElement, fabricEl: HTMLCanvasElement, bgEl: HTMLCanvasElement) {
    this.host = host;
    this.fabricEl = fabricEl;
    this.bgEl = bgEl;
    this.init();
    this.unsubscribe = store.subscribe(this.onStoreChange);
    registerWorkspaceApi(this);
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  private init(): void {
    const state = store.getState();
    this.canvas = new Canvas(this.fabricEl, {
      backgroundColor: 'transparent',
      preserveObjectStacking: true,
      selection: true,
      selectionColor: 'rgba(63,143,221,0.10)',
      selectionBorderColor: 'rgba(63,143,221,0.75)',
      selectionLineWidth: 1,
      fireRightClick: true,
      stopContextMenu: false,
      uniformScaling: true,
    });

    this.canvas.setDimensions({
      width: this.host.clientWidth || 800,
      height: this.host.clientHeight || 600,
    });

    this.bg = new BackgroundRenderer(this.bgEl, this.canvas, {
      bedWidth: state.doc.bed.width,
      bedHeight: state.doc.bed.height,
      gridSize: state.gridSize,
      showGrid: state.showGrid,
      showOutline: state.doc.bed.showOutline,
      units: state.doc.units,
    });

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.host);

    this.zoomToPage(false);
    this.currentSnapshot = this.snapshot();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    (window as unknown as { __openburn?: WorkspaceController }).__openburn = this;
    this.setStatus('Ready');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.historyTimer) window.clearTimeout(this.historyTimer);
    this.unsubscribe();
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    this.canvas.dispose();
  }

  private handleResize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.setDimensions({ width: w, height: h });
    this.bg.resize();
    this.canvas.requestRenderAll();
  }

  private onStoreChange = (): void => {
    const s = store.getState();
    if (s.doc.layers !== this.lastLayers) {
      this.lastLayers = s.doc.layers;
      this.applyLayerStyles();
      this.canvas.requestRenderAll();
    }
    if (s.tool !== this.lastTool) {
      this.lastTool = s.tool;
      this.updateCursorStyle();
      if (s.tool === 'node') this.rebuildNodeHandles();
      else this.clearNodeHandles();
    }
    const bgKey = [
      s.doc.bed.width,
      s.doc.bed.height,
      s.doc.bed.showOutline,
      s.gridSize,
      s.showGrid,
      s.doc.units,
    ].join('|');
    if (bgKey !== this.lastBgKey) {
      this.lastBgKey = bgKey;
      this.bg.setOptions({
        bedWidth: s.doc.bed.width,
        bedHeight: s.doc.bed.height,
        gridSize: s.gridSize,
        showGrid: s.showGrid,
        showOutline: s.doc.bed.showOutline,
        units: s.doc.units,
      });
    }
  };

  private updateCursorStyle(): void {
    const tool = store.getState().tool;
    if (tool === 'select' || tool === 'node') this.canvas.defaultCursor = 'default';
    else if (tool === 'pan') this.canvas.defaultCursor = 'grab';
    else this.canvas.defaultCursor = 'crosshair';
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    this.canvas.on('mouse:wheel', (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      const factor = Math.pow(0.999, e.deltaY);
      this.zoomAt(factor, this.canvas.getViewportPoint(e));
    });

    this.canvas.on('mouse:down', (opt) => {
      const e = opt.e as MouseEvent;
      if (this.isPanTrigger(e)) {
        this.panning = true;
        this.lastPan = { x: e.clientX, y: e.clientY };
        this.canvas.defaultCursor = 'grabbing';
        return;
      }
      if (e.button === 2) return;
      const tool = store.getState().tool;
      if (this.isDrawTool(tool)) {
        this.beginDraw(tool, this.canvas.getScenePoint(e));
      }
    });

    this.canvas.on('mouse:move', (opt) => {
      const e = opt.e as MouseEvent;
      if (this.panning) {
        const dx = e.clientX - this.lastPan.x;
        const dy = e.clientY - this.lastPan.y;
        this.lastPan = { x: e.clientX, y: e.clientY };
        const vpt = this.canvas.viewportTransform;
        if (vpt) {
          vpt[4] += dx;
          vpt[5] += dy;
          this.canvas.setViewportTransform(vpt);
          this.bg.render();
        }
        return;
      }
      const p = this.canvas.getScenePoint(e);
      if (this.drawing) this.updateDraw(p);
      const now = performance.now();
      if (now - this.lastCursorPush > 50) {
        this.lastCursorPush = now;
        this.updateCursor(p.x, p.y);
      }
    });

    this.canvas.on('mouse:up', () => {
      if (this.panning) {
        this.panning = false;
        this.updateCursorStyle();
        return;
      }
      if (this.nodeDragging) {
        this.nodeDragging = false;
        this.afterChange();
        if (this.nodeTarget) {
          this.canvas.setActiveObject(this.nodeTarget);
          this.rebuildNodeHandles();
        }
        return;
      }
      if (this.drawing) this.finishDraw();
    });

    const sync = () => this.syncSelection();
    this.canvas.on('selection:created', sync);
    this.canvas.on('selection:updated', sync);
    this.canvas.on('selection:cleared', sync);
    this.canvas.on('object:modified', () => {
      this.syncSelection();
      this.afterChange();
    });
    this.canvas.on('object:added', () => this.afterChange());
    this.canvas.on('object:removed', () => this.afterChange());

    this.canvas.on('text:editing:entered', () => {
      this.editingText = true;
    });

    this.canvas.on('text:editing:exited', () => {
      this.editingText = false;
      const active = document.activeElement as HTMLElement | null;
      if (active && active.tagName === 'TEXTAREA') active.blur();
      this.afterChange();
    });

    this.canvas.on('after:render', () => {
      // keep background aligned with the fabric viewport
      this.bg.render();
    });
  }

  private isPanTrigger(e: MouseEvent): boolean {
    return (
      e.button === 1 ||
      store.getState().tool === 'pan' ||
      (this.spaceDown && e.button === 0)
    );
  }

  private isDrawTool(tool: ToolId): boolean {
    return ['line', 'rect', 'roundedRect', 'ellipse', 'polygon', 'text', 'measure'].includes(tool);
  }

  // -------------------------------------------------------------------------
  // Zoom & pan
  // -------------------------------------------------------------------------

  private zoomAt(factor: number, point: Point): void {
    const zoom = Math.min(60, Math.max(0.03, this.canvas.getZoom() * factor));
    this.canvas.zoomToPoint(point, zoom);
    this.afterZoom();
  }

  private afterZoom(): void {
    const zoom = this.canvas.getZoom();
    store.setState({ zoom });
    this.refreshStrokeWidth(zoom);
    this.positionNodeHandles();
    this.bg.render();
    this.canvas.requestRenderAll();
  }

  private refreshStrokeWidth(zoom: number): void {
    const width = 1.15 / zoom;
    for (const obj of this.canvas.getObjects()) {
      if (this.isText(obj)) continue;
      obj.set({ strokeWidth: width, objectCaching: false });
    }
    this.canvas.requestRenderAll();
  }

  zoomToPage(notify = true): void {
    const { bed } = store.getState().doc;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const margin = 46;
    const zoom = Math.min((w - margin * 2) / bed.width, (h - margin * 2) / bed.height);
    const z = Math.max(0.03, zoom);
    this.canvas.setViewportTransform([z, 0, 0, z, margin, margin]);
    this.bg.resize();
    this.afterZoom();
    if (notify) this.setStatus('Zoom to page');
  }

  zoomToFitSelection(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.zoomToPage();
      return;
    }
    const b = this.selectionBounds(objs);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const margin = 60;
    const zoom = Math.max(
      0.03,
      Math.min(
        8,
        Math.min((w - margin) / Math.max(1, b.width), (h - margin) / Math.max(1, b.height)),
      ),
    );
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, w / 2 - cx * zoom, h / 2 - cy * zoom]);
    this.afterZoom();
  }

  zoomBy(factor: number): void {
    const center = new Point(this.host.clientWidth / 2, this.host.clientHeight / 2);
    this.zoomAt(factor, center);
  }

  private fitToBounds(
    bounds: { left: number; top: number; width: number; height: number },
    margin = 60,
  ): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const zoom = Math.max(
      0.03,
      Math.min(
        8,
        Math.min((w - margin) / Math.max(1, bounds.width), (h - margin) / Math.max(1, bounds.height)),
      ),
    );
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, w / 2 - cx * zoom, h / 2 - cy * zoom]);
    this.bg.resize();
    this.afterZoom();
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private snap(p: Point): Point {
    const s = store.getState();
    if (!s.snapToGrid) return p;
    const g = s.gridSize;
    return new Point(Math.round(p.x / g) * g, Math.round(p.y / g) * g);
  }

  private beginDraw(tool: ToolId, raw: Point): void {
    const p = this.snap(raw);
    const layer = this.activeLayer();

    if (tool === 'text') {
      const t = new Textbox('Text', {
        left: p.x,
        top: p.y,
        fontSize: store.getState().doc.units === 'mm' ? 10 : 10,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: layer.color,
        stroke: null,
        width: 60,
        objectCaching: false,
      });
      this.assignLayer(t, layer.id);
      this.canvas.add(t);
      this.canvas.setActiveObject(t);
      t.enterEditing();
      t.selectAll();
      store.setState({ tool: 'select' });
      this.setStatus('Text created — type to edit');
      this.afterChange();
      return;
    }

    let obj: FabricObject | undefined;

    if (tool === 'rect' || tool === 'roundedRect') {
      obj = new Rect({
        left: p.x,
        top: p.y,
        width: 0.001,
        height: 0.001,
        rx: tool === 'roundedRect' ? 3 : 0,
        ry: tool === 'roundedRect' ? 3 : 0,
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1,
        objectCaching: false,
      });
    } else if (tool === 'ellipse') {
      obj = new Ellipse({
        left: p.x,
        top: p.y,
        rx: 0.001,
        ry: 0.001,
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1,
        objectCaching: false,
      });
    } else if (tool === 'line') {
      obj = new Line([p.x, p.y, p.x, p.y], {
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1,
        objectCaching: false,
      });
    } else if (tool === 'polygon') {
      const sides = store.getState().polygonSides;
      const poly = this.buildPolygon(sides, 0.001, p);
      poly.set({
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1,
        objectCaching: false,
      });
      obj = poly;
    } else if (tool === 'measure') {
      obj = new Line([p.x, p.y, p.x, p.y], {
        stroke: '#e0b84a',
        strokeDashArray: [4, 3],
        strokeUniform: true,
        strokeWidth: 1,
        objectCaching: false,
      });
      (obj as FabricObject & { isMeasure?: boolean }).isMeasure = true;
    }

    if (obj) {
      this.assignLayer(obj, layer.id);
      this.canvas.add(obj);
      obj.setCoords();
      this.drawing = { tool, start: p, obj };
    }
  }

  private updateDraw(p: Point): void {
    const d = this.drawing;
    if (!d || !d.obj) return;
    const s = this.snap(p);
    const start = d.start;
    const obj = d.obj;

    if (d.tool === 'rect' || d.tool === 'roundedRect') {
      const left = Math.min(start.x, s.x);
      const top = Math.min(start.y, s.y);
      const width = Math.abs(s.x - start.x);
      const height = Math.abs(s.y - start.y);
      obj.set({
        left,
        top,
        width,
        height,
        rx: d.tool === 'roundedRect' ? Math.min(3, width / 2, height / 2) : 0,
        ry: d.tool === 'roundedRect' ? Math.min(3, width / 2, height / 2) : 0,
      });
    } else if (d.tool === 'ellipse') {
      const cx = (start.x + s.x) / 2;
      const cy = (start.y + s.y) / 2;
      const rx = Math.abs(s.x - start.x) / 2;
      const ry = Math.abs(s.y - start.y) / 2;
      (obj as Ellipse).set({ left: cx - rx, top: cy - ry, rx, ry });
    } else if (d.tool === 'line' || d.tool === 'measure') {
      const line = obj as Line;
      line.set({ x1: start.x, y1: start.y, x2: s.x, y2: s.y });
      if (d.tool === 'measure') {
        const len = Math.hypot(s.x - start.x, s.y - start.y);
        this.setStatus(`Length: ${len.toFixed(2)} mm`);
      }
    } else if (d.tool === 'polygon') {
      const radius = Math.hypot(s.x - start.x, s.y - start.y);
      const poly = this.buildPolygon(store.getState().polygonSides, radius, start);
      obj.set({ left: poly.left, top: poly.top, points: poly.points });
    }
    obj.setCoords();
    this.canvas.requestRenderAll();
  }

  private finishDraw(): void {
    const d = this.drawing;
    this.drawing = null;
    if (!d || !d.obj) return;

    const b = d.obj.getBoundingRect();
    const tiny = b.width < 0.4 && b.height < 0.4;
    if (tiny) {
      this.canvas.remove(d.obj);
      store.setState({ tool: 'select' });
      return;
    }

    d.obj.setCoords();
    this.canvas.setActiveObject(d.obj);
    store.setState({ tool: 'select' });
    this.afterChange();
    this.syncSelection();
  }

  private buildPolygon(sides: number, radius: number, center: Point): Polygon {
    const n = Math.max(3, Math.round(sides));
    const pts: { x: number; y: number }[] = [];
    const r = Math.max(radius, 0.001);
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const shifted = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    return new Polygon(shifted, {
      left: center.x + minX,
      top: center.y + minY,
      objectCaching: false,
    });
  }

  // -------------------------------------------------------------------------
  // Layers & styling
  // -------------------------------------------------------------------------

  private activeLayer() {
    const s = store.getState();
    return s.doc.layers.find((l) => l.id === s.activeLayerId) ?? s.doc.layers[0];
  }

  private layerFor(obj: FabricObject) {
    const id = (obj as FabricObject & { layerId?: string }).layerId;
    const layers = store.getState().doc.layers;
    return layers.find((l) => l.id === id) ?? this.activeLayer();
  }

  private assignLayer(obj: FabricObject, layerId: string): void {
    (obj as FabricObject & { layerId?: string }).layerId = layerId;
    this.styleObject(obj, true);
  }

  private isText(obj: FabricObject): boolean {
    return obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text';
  }

  private styleObject(obj: FabricObject, recolor: boolean): void {
    const layer = this.layerFor(obj);
    const zoom = this.canvas.getZoom();
    const width = 1.15 / zoom;

    if (this.isText(obj)) {
      obj.set({ fill: layer.color, stroke: null, objectCaching: false });
    } else if (obj.type === 'image') {
      // leave image colours alone
    } else {
      // Like LightBurn, imported/created vectors are contour-only (Line mode):
      // any fill coming from an SVG is dropped so shapes never render as solid
      // blocks. The layer colour is used for the stroke.
      obj.set({
        fill: null,
        stroke: layer.color,
        strokeWidth: width,
        objectCaching: false,
      });
    }

    obj.set({
      borderColor: SELECTION_ACCENT,
      cornerColor: SELECTION_ACCENT,
      cornerStrokeColor: '#0f1114',
      cornerSize: 9,
      cornerStyle: 'rect',
      transparentCorners: false,
      padding: 3,
      strokeUniform: true,
    });

    obj.visible = layer.settings.visible;
  }

  private applyLayerStyles(): void {
    const layerIds = new Set(store.getState().doc.layers.map((l) => l.id));
    for (const obj of this.canvas.getObjects()) {
      const id = (obj as FabricObject & { layerId?: string }).layerId;
      if (id && !layerIds.has(id)) {
        (obj as FabricObject & { layerId?: string }).layerId = this.activeLayer().id;
      }
      this.styleObject(obj, true);
    }
  }

  // -------------------------------------------------------------------------
  // Selection & history
  // -------------------------------------------------------------------------

  private selectionBounds(objs: FabricObject[]): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of objs) {
      const r = o.getBoundingRect();
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.left + r.width);
      maxY = Math.max(maxY, r.top + r.height);
    }
    if (!Number.isFinite(minX)) return { left: 0, top: 0, width: 0, height: 0 };
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Paper.js returns path data in a normalised coordinate space, so we re-align
   * generated geometry against the bounds it came from.
   */
  private alignPathTo(
    path: FabricObject,
    target: { left: number; top: number; width: number; height: number },
    anchor: 'topleft' | 'center',
  ): void {
    path.setCoords();
    const b = path.getBoundingRect();
    const dx =
      anchor === 'center'
        ? target.left + target.width / 2 - (b.left + b.width / 2)
        : target.left - b.left;
    const dy =
      anchor === 'center'
        ? target.top + target.height / 2 - (b.top + b.height / 2)
        : target.top - b.top;
    path.set({ left: (path.left ?? 0) + dx, top: (path.top ?? 0) + dy });
    path.setCoords();
  }

  private syncSelection(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length > 0 && objs.every((o) => this.isNodeHandle(o))) {
      // A node handle is being dragged; keep the underlying path selected.
      return;
    }
    if (objs.length === 0) {
      store.setState({ selection: null });
      this.rebuildNodeHandles();
      return;
    }
    const b = this.selectionBounds(objs);
    const single = objs.length === 1 ? objs[0] : null;
    store.setState({
      selection: {
        count: objs.length,
        x: b.left,
        y: b.top,
        width: b.width,
        height: b.height,
        angle: single ? single.angle ?? 0 : 0,
        layerIds: [
          ...new Set(
            objs.map(
              (o) => (o as FabricObject & { layerId?: string }).layerId ?? this.activeLayer().id,
            ),
          ),
        ],
        overrideCount: objs.filter(
          (o) => (o as FabricObject & { cutOverride?: unknown }).cutOverride != null,
        ).length,
        zOffset: Number((objs[0] as FabricObject & { zOffset?: number }).zOffset ?? 0),
      },
    });
    if (store.getState().tool === 'node') this.rebuildNodeHandles();
  }

  // -------------------------------------------------------------------------
  // Node editing
  // -------------------------------------------------------------------------

  private isNodeHandle(obj: FabricObject | null): boolean {
    return !!obj && (obj as FabricObject & { isNodeHandle?: boolean }).isNodeHandle === true;
  }

  private commandToScene(path: FabricPath, x: number, y: number): Point {
    const offset = path.pathOffset;
    const local = new Point(x - offset.x, y - offset.y);
    return util.transformPoint(local, path.calcTransformMatrix());
  }

  private clearNodeHandles(): void {
    if (this.nodeHandles.length === 0) {
      this.nodeTarget = null;
      return;
    }
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    for (const h of this.nodeHandles) this.canvas.remove(h.circle);
    this.nodeHandles = [];
    this.nodeTarget?.set({ hasControls: true, hasBorders: true });
    this.nodeTarget = null;
    this.suppressHistory = previous;
    this.canvas.requestRenderAll();
  }

  private rebuildNodeHandles(): void {
    if (store.getState().tool !== 'node') {
      this.clearNodeHandles();
      return;
    }
    const active = this.canvas.getActiveObject();
    if (!active) {
      this.clearNodeHandles();
      return;
    }
    if (this.isNodeHandle(active)) return;

    if (!(active instanceof FabricPath)) {
      this.clearNodeHandles();
      if (active) this.setStatus('Node editing needs a path — use Tools → Convert to Path first');
      return;
    }

    if (this.nodeTarget === active && this.nodeHandles.length > 0) {
      this.positionNodeHandles();
      return;
    }

    this.clearNodeHandles();
    this.nodeTarget = active;
    active.set({ hasControls: false, hasBorders: true });

    const previous = this.suppressHistory;
    this.suppressHistory = true;
    const zoom = this.canvas.getZoom();
    (active.path as unknown as unknown[][]).forEach((cmd, idx) => {
      const anchor = anchorCoords(cmd);
      if (!anchor) return;
      const scene = this.commandToScene(active, anchor.x, anchor.y);
      const circle = new Circle({
        left: scene.x,
        top: scene.y,
        radius: 4 / zoom,
        originX: 'center',
        originY: 'center',
        fill: '#f5f6f7',
        stroke: SELECTION_ACCENT,
        strokeWidth: 1.4 / zoom,
        strokeUniform: true,
        hasControls: false,
        hasBorders: false,
        lockRotation: true,
        excludeFromExport: true,
        objectCaching: false,
      });
      (circle as Circle & { isNodeHandle?: boolean }).isNodeHandle = true;
      circle.on('mousedown', () => {
        this.nodeDragging = true;
      });
      circle.on('moving', () => this.moveNode(circle, idx));
      this.nodeHandles.push({ circle, commandIndex: idx });
      this.canvas.add(circle);
    });
    this.suppressHistory = previous;
    this.setStatus(`Node editing — ${this.nodeHandles.length} node(s). Drag to reshape.`);
  }

  private moveNode(circle: Circle, index: number): void {
    const path = this.nodeTarget;
    if (!path) return;
    const inverse = util.invertTransform(path.calcTransformMatrix());
    const local = util.transformPoint(new Point(circle.left ?? 0, circle.top ?? 0), inverse);
    const x = local.x + path.pathOffset.x;
    const y = local.y + path.pathOffset.y;

    const commands = (path.path as unknown as unknown[][]).map((c) => [...c]);
    if (!commands[index]) return;

    // Anchor the shape using another node so only the dragged point moves.
    let refBefore: Point | null = null;
    let refIndex = -1;
    for (let i = 0; i < commands.length; i += 1) {
      if (i === index) continue;
      const anchor = anchorCoords(commands[i]);
      if (anchor) {
        refIndex = i;
        refBefore = this.commandToScene(path, anchor.x, anchor.y);
        break;
      }
    }

    const cmd = commands[index];
    const type = cmd[0];
    if (type === 'M' || type === 'L') {
      cmd[1] = x;
      cmd[2] = y;
    } else if (type === 'C') {
      cmd[5] = x;
      cmd[6] = y;
    } else if (type === 'Q') {
      cmd[3] = x;
      cmd[4] = y;
    } else if (type === 'A') {
      cmd[6] = x;
      cmd[7] = y;
    } else {
      return;
    }

    path._setPath(commands as never, false);
    if (refBefore && refIndex >= 0) {
      const anchor = anchorCoords(path.path[refIndex] as unknown as unknown[]);
      if (anchor) {
        const refAfter = this.commandToScene(path, anchor.x, anchor.y);
        path.set({
          left: (path.left ?? 0) + refBefore.x - refAfter.x,
          top: (path.top ?? 0) + refBefore.y - refAfter.y,
        });
      }
    }
    path.setCoords();
    this.positionNodeHandles(circle);
    this.canvas.requestRenderAll();
  }

  private positionNodeHandles(skip?: Circle): void {
    const path = this.nodeTarget;
    if (!path) return;
    const zoom = this.canvas.getZoom();
    for (const handle of this.nodeHandles) {
      if (handle.circle === skip) continue;
      const cmd = path.path[handle.commandIndex] as unknown as unknown[];
      const anchor = cmd ? anchorCoords(cmd) : null;
      if (!anchor) continue;
      const scene = this.commandToScene(path, anchor.x, anchor.y);
      handle.circle.set({
        left: scene.x,
        top: scene.y,
        radius: 4 / zoom,
        strokeWidth: 1.4 / zoom,
      });
      handle.circle.setCoords();
    }
  }

  private snapshot(): string {
    return JSON.stringify(this.canvas.toObject(['layerId']));
  }

  private afterChange(): void {
    if (this.suppressHistory || this.editingText) return;
    store.markDirty(true);
    if (this.historyTimer) window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.commitHistory(), 160);
  }

  private commitHistory(): void {
    if (this.suppressHistory || this.editingText) return;
    const snap = this.snapshot();
    if (snap === this.currentSnapshot) return;
    this.undoStack.push(this.currentSnapshot);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.currentSnapshot = snap;
    this.redoStack = [];
    store.setHistoryState(this.undoStack.length > 0, false);
  }

  private async loadSnapshot(json: string): Promise<void> {
    this.suppressHistory = true;
    try {
      const vpt = this.canvas.viewportTransform;
      await this.canvas.loadFromJSON(json);
      if (vpt) this.canvas.setViewportTransform(vpt);
      this.applyLayerStyles();
      this.refreshStrokeWidth(this.canvas.getZoom());
      this.canvas.requestRenderAll();
      this.syncSelection();
    } finally {
      this.suppressHistory = false;
    }
  }

  undo(): void {
    if (this.historyTimer) window.clearTimeout(this.historyTimer);
    this.commitHistory();
    if (this.undoStack.length === 0) return;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.currentSnapshot);
    this.currentSnapshot = prev;
    void this.loadSnapshot(prev).then(() => {
      store.setHistoryState(this.undoStack.length > 0, true);
      store.markDirty(true);
      this.setStatus('Undo');
    });
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.currentSnapshot);
    this.currentSnapshot = next;
    void this.loadSnapshot(next).then(() => {
      store.setHistoryState(true, this.redoStack.length > 0);
      store.markDirty(true);
      this.setStatus('Redo');
    });
  }

  private reselect(objs: FabricObject[]): void {
    if (objs.length === 0) {
      this.canvas.discardActiveObject();
    } else if (objs.length === 1) {
      this.canvas.setActiveObject(objs[0]);
    } else {
      this.canvas.setActiveObject(
        new ActiveSelection(objs, { canvas: this.canvas } as never),
      );
    }
    this.canvas.requestRenderAll();
    this.syncSelection();
  }

  private withSelectionObjects(fn: (objs: FabricObject[]) => void): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    this.canvas.discardActiveObject();
    fn(objs);
    objs.forEach((o) => o.setCoords());
    this.reselect(objs);
    this.afterChange();
  }

  // -------------------------------------------------------------------------
  // Workspace API implementation
  // -------------------------------------------------------------------------

  newDocument(): void {
    const empty = buildDocument({
      name: 'Untitled',
      units: store.getState().doc.units,
      bed: store.getState().doc.bed,
      layers: store.getState().doc.layers,
      canvas: { version: '6', objects: [] },
    });
    this.applyDocument(empty, null);
    this.setStatus('New document');
  }

  private async applyDocument(
    doc: ReturnType<typeof parseDocument>,
    filePath: string | null,
  ): Promise<void> {
    this.suppressHistory = true;
    try {
      store.replaceDocument(doc, filePath);
      await this.canvas.loadFromJSON(doc.canvas as Record<string, unknown>);
      this.applyLayerStyles();
      this.currentSnapshot = this.snapshot();
      this.undoStack = [];
      this.redoStack = [];
      store.setHistoryState(false, false);
      this.bg.setOptions({
        bedWidth: doc.bed.width,
        bedHeight: doc.bed.height,
        showOutline: doc.bed.showOutline,
        units: doc.units,
        gridSize: store.getState().gridSize,
        showGrid: store.getState().showGrid,
      });
      this.zoomToPage(false);
      this.syncSelection();
    } finally {
      this.suppressHistory = false;
    }
  }

  async openDocument(): Promise<void> {
    const file = await pickProject();
    if (!file?.text) return;
    try {
      if (/\.(lbrn|lbrn2)$/i.test(file.name)) {
        const result = await parseLightBurn(file.text);
        await this.applyLightBurnImport(result, baseName(file.name));
        return;
      }
      const doc = parseDocument(file.text);
      // Legacy .ovbrn files are read-only: save as .obrn on the next Ctrl+S.
      const legacyProject = /\.ovbrn$/i.test(file.name);
      await this.applyDocument(doc, legacyProject ? null : file.path ?? null);
      this.setStatus(
        legacyProject
          ? `Opened legacy ${file.name} — use Save As to convert it to .obrn`
          : `Opened ${file.name}`,
      );
    } catch (err) {
      this.setStatus(`Open failed: ${(err as Error).message}`);
    }
  }

  async openLightBurn(): Promise<void> {
    const file = await pickProject();
    if (!file?.text) return;
    if (!/\.(lbrn|lbrn2)$/i.test(file.name)) {
      this.setStatus('Choose a .lbrn or .lbrn2 file');
      return;
    }
    try {
      const result = await parseLightBurn(file.text);
      await this.applyLightBurnImport(result, baseName(file.name));
    } catch (err) {
      this.setStatus(`LightBurn import failed: ${(err as Error).message}`);
    }
  }

  private async applyLightBurnImport(
    result: LightBurnImportResult,
    name: string,
  ): Promise<void> {
    const width = Math.max(400, Math.ceil((result.bounds.maxX + 20) / 50) * 50);
    const height = Math.max(400, Math.ceil((result.bounds.maxY + 20) / 50) * 50);
    const doc = buildDocument({
      name,
      units: 'mm',
      bed: { width, height, showOutline: true },
      layers: result.layers,
      canvas: { version: '6', objects: [] },
    });

    await this.applyDocument(doc, null);

    this.suppressHistory = true;
    try {
      for (const obj of result.objects) {
        const target = obj as FabricObject & { layerId?: string };
        if (!target.layerId && result.layers[0]) target.layerId = result.layers[0].id;
        this.canvas.add(obj);
        obj.setCoords();
      }
      this.applyLayerStyles();
      this.canvas.requestRenderAll();
      this.currentSnapshot = this.snapshot();
      this.undoStack = [];
      this.redoStack = [];
      store.setHistoryState(false, false);
      store.markDirty(true);
      this.fitToBounds({
        left: result.bounds.minX,
        top: result.bounds.minY,
        width: Math.max(1, result.bounds.maxX - result.bounds.minX),
        height: Math.max(1, result.bounds.maxY - result.bounds.minY),
      });
      const warning = result.warnings.length
        ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`
        : '';
      this.setStatus(
        `Opened LightBurn project: ${result.objects.length} shapes, ${result.layers.length} layers${warning}`,
      );
    } finally {
      this.suppressHistory = false;
    }
  }

  async saveLightBurn(format: LightBurnFormat): Promise<void> {
    const state = store.getState();
    const objects = this.canvas.getObjects().filter((o) => !this.isNodeHandle(o));
    try {
      const result = await serializeLightBurn(objects, state.doc.layers, state.doc.bed, format);
      if (result.shapes === 0) {
        this.setStatus('Nothing to export — add vector shapes or text');
        return;
      }
      const name = (state.doc.meta.name || 'openburn').replace(/\s+/g, '_');
      const ok = await saveTextFile(`${name}.${format}`, result.xml, format, 'application/xml', [
        { name: `LightBurn ${format.toUpperCase()}`, extensions: [format] },
      ]);
      if (ok) {
        const warning = result.warnings.length ? ` — ${result.warnings.length} warning(s)` : '';
        this.setStatus(`Exported ${format.toUpperCase()} (${result.shapes} shapes)${warning}`);
      }
    } catch (err) {
      this.setStatus(`LightBurn export failed: ${(err as Error).message}`);
    }
  }

  async saveDocument(saveAs = false): Promise<void> {
    const s = store.getState();
    const doc = buildDocument({
      name: s.doc.meta.name,
      units: s.doc.units,
      bed: s.doc.bed,
      layers: s.doc.layers,
      canvas: this.canvas.toObject(['layerId']),
      pages: s.doc.pages,
      createdAt: s.doc.meta.createdAt,
    });
    const path = await saveProjectFile(
      s.doc.meta.name || 'Untitled',
      serializeDocument(doc),
      saveAs ? null : s.filePath,
    );
    if (!path) return;
    store.setState({
      doc: { ...doc, meta: { ...doc.meta, name: baseName(path) } },
      filePath: path,
      dirty: false,
    });
    this.currentSnapshot = this.snapshot();
    this.setStatus('Saved');
  }

  async importFile(): Promise<void> {
    const file = await pickArtwork();
    if (!file) return;
    try {
      if (file.text && /\.svg$/i.test(file.name)) {
        await this.importSvg(file.text);
      } else if (file.text && /\.dxf$/i.test(file.name)) {
        this.importDxf(file.text);
      } else if (file.dataUrl) {
        await this.importImage(file.dataUrl);
      } else {
        this.setStatus('Unsupported file type');
      }
    } catch (err) {
      this.setStatus(`Import failed: ${(err as Error).message}`);
    }
  }

  private async importSvg(text: string): Promise<void> {
    const prep = prepareSvgForImport(text);
    // Visible in DevTools: shows what the source SVG declared and the size we
    // apply, which makes scaling issues easy to diagnose.
    console.info(
      '[OpenBurn] SVG import:',
      `${prep.widthMm?.toFixed(2) ?? '?'} × ${prep.heightMm?.toFixed(2) ?? '?'} mm`,
      text.match(/<svg\b[^>]*>/i)?.[0] ?? '(no root tag)',
    );
    const { objects, options } = await loadSVGFromString(prep.svg);
    const valid = objects.filter((o): o is FabricObject => !!o);
    if (valid.length === 0) {
      this.setStatus('No shapes found in SVG');
      return;
    }
    const layer = this.activeLayer();
    let target: FabricObject;
    if (valid.length === 1) {
      target = valid[0];
    } else {
      target = util.groupSVGElements(valid, options);
    }
    target.setCoords();
    this.scaleToPhysicalSize(target, prep.widthMm, prep.heightMm);
    this.canvas.add(target);
    this.assignLayerDeep(target, layer.id);
    this.fitImported(target);
    target.setCoords();
    this.canvas.setActiveObject(target);
    this.zoomToFitSelection();
    this.afterChange();
    this.syncSelection();
    const size = target.getBoundingRect();
    this.setStatus(
      `SVG imported — ${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`,
    );
  }

  private importDxf(text: string): void {
    const objects = parseDxf(text);
    const layer = this.activeLayer();
    for (const obj of objects) {
      this.assignLayerDeep(obj, layer.id);
      this.canvas.add(obj);
      obj.setCoords();
    }
    const first = objects[0];
    if (first) {
      this.fitImported(first);
      first.setCoords();
      this.canvas.setActiveObject(first);
      this.zoomToFitSelection();
    }
    this.afterChange();
    this.syncSelection();
    this.setStatus('DXF imported');
  }

  private async importImage(dataUrl: string): Promise<void> {
    const img = await FabricImage.fromURL(dataUrl);
    const bed = store.getState().doc.bed;
    const maxW = bed.width * 0.8;
    const maxH = bed.height * 0.8;
    const scale = Math.min(1, maxW / (img.width || 1), maxH / (img.height || 1));
    img.set({
      left: 10,
      top: 10,
      scaleX: scale,
      scaleY: scale,
      objectCaching: false,
    });
    this.assignLayerDeep(img, this.activeLayer().id);
    this.canvas.add(img);
    img.setCoords();
    this.canvas.setActiveObject(img);
    this.zoomToFitSelection();
    this.afterChange();
    this.syncSelection();
    this.setStatus('Image imported');
  }

  /**
   * Force an imported object to a physical size in mm. The SVG is parsed at
   * viewBox scale (1) so this is the only scaling applied to the artwork.
   */
  private scaleToPhysicalSize(obj: FabricObject, widthMm: number | null, heightMm: number | null): void {
    if (!widthMm || !heightMm || widthMm <= 0 || heightMm <= 0) return;
    obj.setCoords();
    const before = obj.getBoundingRect();
    if (before.width <= 0 || before.height <= 0) return;

    const sx = widthMm / before.width;
    const sy = heightMm / before.height;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;

    // Keep the artwork's aspect ratio if the declared size disagrees with it.
    const scale = Math.min(sx, sy);
    if (Math.abs(scale - 1) < 1e-6) return;

    obj.set({
      scaleX: (obj.scaleX ?? 1) * scale,
      scaleY: (obj.scaleY ?? 1) * scale,
    });
    obj.setCoords();

    // Scaling happens around the origin; restore the original top-left corner.
    const after = obj.getBoundingRect();
    obj.set({
      left: (obj.left ?? 0) + (before.left - after.left),
      top: (obj.top ?? 0) + (before.top - after.top),
    });
    obj.setCoords();
  }

  private fitImported(obj: FabricObject): void {
    const bed = store.getState().doc.bed;
    const b = obj.getBoundingRect();
    if (b.width <= 0 || b.height <= 0) return;
    const maxW = bed.width;
    const maxH = bed.height;
    let scale = 1;
    if (b.width > maxW || b.height > maxH) {
      scale = Math.min(maxW / b.width, maxH / b.height) * 0.95;
    }
    if (scale !== 1) {
      obj.set({
        scaleX: (obj.scaleX ?? 1) * scale,
        scaleY: (obj.scaleY ?? 1) * scale,
        left: 0,
        top: 0,
      });
    } else if (b.left < 0 || b.top < 0 || b.left + b.width > bed.width || b.top + b.height > bed.height) {
      obj.set({
        left: (obj.left ?? 0) - b.left + 5,
        top: (obj.top ?? 0) - b.top + 5,
      });
    }
  }

  private assignLayerDeep(obj: FabricObject, layerId: string): void {
    (obj as FabricObject & { layerId?: string }).layerId = layerId;
    if (obj instanceof Group) {
      obj.getObjects().forEach((child) => this.assignLayerDeep(child, layerId));
    }
    this.styleObject(obj, true);
  }

  async exportSvg(): Promise<void> {
    const svg = applySvgPhysicalSize(this.canvas.toSVG());
    const name = (store.getState().doc.meta.name || 'openburn').replace(/\s+/g, '_');
    const ok = await saveTextFile(`${name}.svg`, svg, 'svg', 'image/svg+xml', [
      { name: 'SVG', extensions: ['svg'] },
    ]);
    if (ok) this.setStatus('Exported SVG');
  }

  deleteSelection(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    this.canvas.discardActiveObject();
    objs.forEach((o) => this.canvas.remove(o));
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
    this.setStatus('Deleted');
  }

  copySelection(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    this.clipboard = objs.map((o) => o.toObject(['layerId']) as Record<string, unknown>);
    this.setStatus(`Copied ${objs.length} object(s)`);
  }

  async pasteClipboard(offset = 10): Promise<void> {
    if (this.clipboard.length === 0) return;
    const enlivened = (await util.enlivenObjects(
      this.clipboard as never[],
    )) as unknown as FabricObject[];
    const layer = this.activeLayer();
    this.canvas.discardActiveObject();
    for (const o of enlivened) {
      o.set({
        left: (o.left ?? 0) + offset,
        top: (o.top ?? 0) + offset,
      });
      (o as FabricObject & { layerId?: string }).layerId =
        (o as FabricObject & { layerId?: string }).layerId ?? layer.id;
      this.styleObject(o, true);
      this.canvas.add(o);
      o.setCoords();
    }
    this.reselect(enlivened);
    this.afterChange();
    this.setStatus(offset === 0 ? 'Pasted in place' : 'Pasted');
  }

  /** Paste the internal clipboard keeping the original position (Alt+V). */
  async pasteInPlace(): Promise<void> {
    await this.pasteClipboard(0);
  }

  duplicateSelection(): void {
    this.copySelection();
    void this.pasteClipboard();
  }

  selectAll(): void {
    const objs = this.canvas.getObjects();
    this.reselect(objs);
  }

  group(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length < 2) return;
    this.canvas.discardActiveObject();
    objs.forEach((o) => this.canvas.remove(o));
    const g = new Group(objs);
    (g as FabricObject & { layerId?: string }).layerId = this.activeLayer().id;
    this.canvas.add(g);
    this.canvas.setActiveObject(g);
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
    this.setStatus('Grouped');
  }

  ungroup(): void {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof Group) || active instanceof ActiveSelection) return;
    const children = active.removeAll();
    this.canvas.remove(active);
    children.forEach((c) => this.canvas.add(c));
    this.reselect(children);
    this.afterChange();
    this.setStatus('Ungrouped');
  }

  bringToFront(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    objs.forEach((o) => this.canvas.bringObjectToFront(o));
    this.canvas.requestRenderAll();
    this.afterChange();
    this.setStatus('Brought to front');
  }

  sendToBack(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    [...objs].reverse().forEach((o) => this.canvas.sendObjectToBack(o));
    this.canvas.requestRenderAll();
    this.afterChange();
    this.setStatus('Sent to back');
  }

  flip(axis: 'h' | 'v'): void {
    this.withSelectionObjects((objs) => {
      const b = this.selectionBounds(objs);
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      for (const o of objs) {
        if (axis === 'h') o.set({ scaleX: -(o.scaleX ?? 1) });
        else o.set({ scaleY: -(o.scaleY ?? 1) });
        const nb = o.getBoundingRect();
        if (axis === 'h') o.set({ left: (o.left ?? 0) + (cx - (nb.left + nb.width / 2)) * 2 });
        else o.set({ top: (o.top ?? 0) + (cy - (nb.top + nb.height / 2)) * 2 });
      }
    });
  }

  rotate(degrees: number): void {
    this.withSelectionObjects((objs) => {
      const b = this.selectionBounds(objs);
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      for (const o of objs) {
        o.set({ angle: (o.angle ?? 0) + degrees });
        const dx = (o.left ?? 0) - cx;
        const dy = (o.top ?? 0) - cy;
        o.set({ left: cx + dx * cos - dy * sin, top: cy + dx * sin + dy * cos });
      }
    });
  }

  align(mode: AlignMode): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const bed = store.getState().doc.bed;

    if (mode === 'centerPage' || mode === 'centerHPage' || mode === 'centerVPage') {
      const b = this.selectionBounds(objs);
      const dx = mode === 'centerVPage' ? 0 : bed.width / 2 - (b.left + b.width / 2);
      const dy = mode === 'centerHPage' ? 0 : bed.height / 2 - (b.top + b.height / 2);
      this.translate(objs, dx, dy);
      this.setStatus('Centered on page');
      return;
    }

    const rects = objs.map((o) => o.getBoundingRect());
    const minLeft = Math.min(...rects.map((r) => r.left));
    const maxRight = Math.max(...rects.map((r) => r.left + r.width));
    const minTop = Math.min(...rects.map((r) => r.top));
    const maxBottom = Math.max(...rects.map((r) => r.top + r.height));

    this.withSelectionObjects(() => {
      objs.forEach((o, i) => {
        const r = rects[i];
        let dx = 0;
        let dy = 0;
        switch (mode) {
          case 'left':
            dx = minLeft - r.left;
            break;
          case 'right':
            dx = maxRight - (r.left + r.width);
            break;
          case 'hcenter':
            dx = (minLeft + maxRight) / 2 - (r.left + r.width / 2);
            break;
          case 'top':
            dy = minTop - r.top;
            break;
          case 'bottom':
            dy = maxBottom - (r.top + r.height);
            break;
          case 'vcenter':
            dy = (minTop + maxBottom) / 2 - (r.top + r.height / 2);
            break;
        }
        o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy });
      });
    });
    this.setStatus('Aligned');
  }

  private translate(objs: FabricObject[], dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.withSelectionObjects(() => {
      objs.forEach((o) => o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy }));
    });
  }

  distribute(axis: 'h' | 'v'): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length < 3) {
      this.setStatus('Select at least 3 objects to distribute');
      return;
    }
    const rects = objs.map((o) => o.getBoundingRect());
    const order = objs
      .map((_, i) => i)
      .sort((a, b) => (axis === 'h' ? rects[a].left - rects[b].left : rects[a].top - rects[b].top));
    const first = rects[order[0]];
    const last = rects[order[order.length - 1]];
    const span =
      axis === 'h'
        ? last.left + last.width - first.left
        : last.top + last.height - first.top;
    const sizes = order.reduce((sum, i) => sum + (axis === 'h' ? rects[i].width : rects[i].height), 0);
    const gap = (span - sizes) / (order.length - 1);

    this.withSelectionObjects(() => {
      let cursor = axis === 'h' ? first.left : first.top;
      for (const i of order) {
        const r = rects[i];
        const o = objs[i];
        if (axis === 'h') {
          o.set({ left: (o.left ?? 0) + (cursor - r.left) });
          cursor += r.width + gap;
        } else {
          o.set({ top: (o.top ?? 0) + (cursor - r.top) });
          cursor += r.height + gap;
        }
      }
    });
    this.setStatus('Distributed');
  }

  booleanOp(op: BooleanOp): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length < 2) {
      this.setStatus('Select at least 2 shapes for a boolean operation');
      return;
    }
    const layer = this.activeLayer();
    if (objs.some((o) => !isConvertible(o))) {
      this.setStatus('Convert text to a path before using boolean operations');
      return;
    }
    const bounds = this.selectionBounds(objs);
    try {
      const result = booleanObjects(objs, op);
      if (!result) {
        this.setStatus('Boolean operation produced no result');
        return;
      }
      this.canvas.discardActiveObject();
      objs.forEach((o) => this.canvas.remove(o));
      const path = new FabricPath(result.pathData, {
        fill: 'transparent',
        stroke: layer.color,
        strokeWidth: 1.15 / this.canvas.getZoom(),
        strokeUniform: true,
        objectCaching: false,
      });
      this.assignLayer(path, layer.id);
      this.canvas.add(path);
      this.alignPathTo(path, bounds, 'topleft');
      this.canvas.setActiveObject(path);
      this.canvas.requestRenderAll();
      this.afterChange();
      this.syncSelection();
      this.setStatus(`Boolean: ${op}`);
    } catch (err) {
      this.setStatus(`Boolean failed: ${(err as Error).message}`);
    }
  }

  offsetShapes(distance: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.setStatus('Select shapes to offset');
      return;
    }
    const layer = this.activeLayer();
    const created: FabricObject[] = [];
    for (const o of objs) {
      if (!isConvertible(o)) continue;
      const sourceBounds = o.getBoundingRect();
      const data = objectToPathData(o);
      if (!data) continue;
      const offset = offsetPathData(data, distance);
      if (!offset) continue;
      const path = new FabricPath(offset, {
        fill: 'transparent',
        stroke: layer.color,
        strokeWidth: 1.15 / this.canvas.getZoom(),
        strokeUniform: true,
        objectCaching: false,
      });
      this.assignLayer(path, layer.id);
      this.canvas.add(path);
      this.alignPathTo(path, sourceBounds, 'center');
      created.push(path);
    }
    if (created.length) {
      this.reselect(created);
      this.afterChange();
      this.setStatus(`Offset ${distance} mm`);
    }
  }

  arrayGrid(rows: number, cols: number, dx: number, dy: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const created: FabricObject[] = [];
    void (async () => {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (r === 0 && c === 0) continue;
          const clones = await util.enlivenObjects(
            objs.map((o) => o.toObject(['layerId'])) as never[],
          );
          for (const clone of clones as unknown as FabricObject[]) {
            clone.set({
              left: (clone.left ?? 0) + c * dx,
              top: (clone.top ?? 0) + r * dy,
            });
            this.canvas.add(clone);
            clone.setCoords();
            created.push(clone);
          }
        }
      }
      this.reselect([...objs, ...created]);
      this.afterChange();
      this.setStatus(`Grid array ${rows}×${cols}`);
    })();
  }

  arrayCircular(count: number, radius: number, startAngle: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const b = this.selectionBounds(objs);
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const created: FabricObject[] = [];
    void (async () => {
      for (let i = 1; i < count; i += 1) {
        const a = ((startAngle + (360 / count) * i) * Math.PI) / 180;
        const clones = await util.enlivenObjects(
          objs.map((o) => o.toObject(['layerId'])) as never[],
        );
        for (const clone of clones as unknown as FabricObject[]) {
          const ox = (clone.left ?? 0) - cx;
          const oy = (clone.top ?? 0) - cy;
          clone.set({
            left: cx + radius + ox * Math.cos(a) - oy * Math.sin(a),
            top: cy + ox * Math.sin(a) + oy * Math.cos(a),
            angle: (clone.angle ?? 0) + (360 / count) * i,
          });
          this.canvas.add(clone);
          clone.setCoords();
          created.push(clone);
        }
      }
      this.reselect([...objs, ...created]);
      this.afterChange();
      this.setStatus(`Circular array ×${count}`);
    })();
  }

  setLayerOfSelection(layerId: string): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    objs.forEach((o) => this.assignLayerDeep(o, layerId));
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
  }

  // Kept for API completeness (used by menus / panels later)
  setLayerColorForSelection(color: string): void {
    const s = store.getState();
    const active = s.doc.layers.find((l) => l.id === s.activeLayerId);
    if (!active) return;
    store.updateLayer(active.id, { color });
  }

  applyNumeric(
    patch: Partial<{ x: number; y: number; width: number; height: number; angle: number }>,
  ): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const b = this.selectionBounds(objs);
    const anchorX = b.left;
    const anchorY = b.top;

    this.withSelectionObjects(() => {
      if (patch.x !== undefined || patch.y !== undefined) {
        const dx = patch.x !== undefined ? patch.x - b.left : 0;
        const dy = patch.y !== undefined ? patch.y - b.top : 0;
        objs.forEach((o) => o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy }));
      }
      if (patch.width !== undefined && b.width > 0) {
        const fx = patch.width / b.width;
        objs.forEach((o) => {
          o.set({
            left: anchorX + ((o.left ?? 0) - anchorX) * fx,
            scaleX: (o.scaleX ?? 1) * fx,
          });
        });
      }
      if (patch.height !== undefined && b.height > 0) {
        const fy = patch.height / b.height;
        objs.forEach((o) => {
          o.set({
            top: anchorY + ((o.top ?? 0) - anchorY) * fy,
            scaleY: (o.scaleY ?? 1) * fy,
          });
        });
      }
      if (patch.angle !== undefined) {
        const current = objs.length === 1 ? objs[0].angle ?? 0 : 0;
        const delta = patch.angle - current;
        if (delta !== 0) {
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          const rad = (delta * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          objs.forEach((o) => {
            o.set({ angle: (o.angle ?? 0) + delta });
            const dx = (o.left ?? 0) - cx;
            const dy = (o.top ?? 0) - cy;
            o.set({ left: cx + dx * cos - dy * sin, top: cy + dx * sin + dy * cos });
          });
        }
      }
    });
  }

  applyTextStyle(patch: {
    fontSize?: number;
    charSpacing?: number;
    lineHeight?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
  }): void {
    const objs = this.canvas.getActiveObjects();
    let touched = 0;
    for (const o of objs) {
      if (!this.isText(o) && !(o instanceof Group)) continue;
      const targets = o instanceof Group ? o.getObjects().filter((c) => this.isText(c)) : [o];
      for (const t of targets) {
        const next: Record<string, unknown> = {};
        if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
        if (patch.charSpacing !== undefined) next.charSpacing = patch.charSpacing * 10;
        if (patch.lineHeight !== undefined) next.lineHeight = patch.lineHeight;
        if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
        if (patch.bold !== undefined) next.fontWeight = patch.bold ? '700' : '400';
        if (patch.italic !== undefined) next.fontStyle = patch.italic ? 'italic' : 'normal';
        t.set(next as never);
        touched += 1;
      }
    }
    if (touched > 0) {
      this.canvas.requestRenderAll();
      this.afterChange();
      this.setStatus('Text updated');
    }
  }

  async convertToPath(): Promise<void> {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const layer = this.activeLayer();
    const converted: FabricObject[] = [];
    let textCount = 0;
    let failures = 0;
    let substitutedFrom: string | null = null;

    for (const o of objs) {
      const objLayerId = (o as FabricObject & { layerId?: string }).layerId ?? layer.id;
      const zoom = this.canvas.getZoom();

      if (this.isText(o)) {
        const family = String((o as Textbox).fontFamily ?? 'Inter');
        if (!/inter/i.test(family)) substitutedFrom = family;
        const result = await textToScenePath(o as Textbox);
        if (!result) {
          failures += 1;
          continue;
        }
        const path = new FabricPath(result.pathData, {
          fill: 'transparent',
          stroke: layer.color,
          strokeWidth: 1.15 / zoom,
          strokeUniform: true,
          objectCaching: false,
        });
        this.assignLayerDeep(path, objLayerId);
        this.canvas.remove(o);
        this.canvas.add(path);
        path.setCoords();
        converted.push(path);
        textCount += 1;
        continue;
      }

      const bounds = o.getBoundingRect();
      const data = objectToPathData(o);
      if (!data) {
        failures += 1;
        continue;
      }
      const path = new FabricPath(data, {
        fill: 'transparent',
        stroke: layer.color,
        strokeWidth: 1.15 / zoom,
        strokeUniform: true,
        objectCaching: false,
      });
      this.assignLayerDeep(path, objLayerId);
      this.canvas.remove(o);
      this.canvas.add(path);
      this.alignPathTo(path, bounds, 'topleft');
      converted.push(path);
    }

    if (converted.length) {
      this.reselect(converted);
      this.afterChange();
      const note = substitutedFrom ? ` — outlines use Inter (was ${substitutedFrom})` : '';
      this.setStatus(
        textCount > 0
          ? `Converted ${converted.length} object(s) to path (${textCount} text)${note}`
          : `Converted ${converted.length} object(s) to path`,
      );
    }
    if (failures > 0) {
      this.setStatus(`Could not convert ${failures} object(s) to path`);
    }
  }

  closePath(): void {
    const objs = this.canvas.getActiveObjects();
    let closed = 0;
    for (const o of objs) {
      if (o instanceof FabricPath) {
        (o as FabricPath).set({ fill: 'transparent' });
        // Fabric paths are closed by mutating the path string when possible.
        if (o.path && !/z\s*$/i.test(JSON.stringify(o.path).replace(/"/g, ''))) {
          const path = [...o.path];
          const last = path[path.length - 1];
          if (last && (last as unknown[])[0] !== 'Z') path.push(['Z']);
          o.set({ path: path as never });
          closed += 1;
        }
      }
    }
    if (closed > 0) {
      this.canvas.requestRenderAll();
      this.afterChange();
      this.setStatus(`Closed ${closed} path(s)`);
    } else {
      this.setStatus('No open paths selected');
    }
  }

  breakApart(): void {
    this.ungroup();
  }

  setStartPoint(): void {
    this.setStatus('Set start point: available when laser output is enabled (Phase 2)');
  }

  traceImage(): void {
    this.setStatus('Image trace: coming in Phase 3');
  }

  applyCutPreview(): void {
    this.setStatus('Generating toolpath preview…');
  }

  async generateJob(cutSelectionOnly: boolean): Promise<JobPlan> {
    const s = store.getState();
    const objs = (cutSelectionOnly ? this.canvas.getActiveObjects() : this.canvas.getObjects()).filter(
      (o) => !this.isNodeHandle(o),
    );
    return buildJob({
      objects: objs,
      layers: s.doc.layers,
      bed: s.doc.bed,
      device: s.device,
    });
  }

  generateFrameJob(): JobPlan | null {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.setStatus('Select shapes to frame');
      return null;
    }
    const s = store.getState();
    const b = this.selectionBounds(objs);
    return buildFramePlan(
      { left: b.left, top: b.top, width: b.width, height: b.height },
      s.doc.bed,
      s.device,
    );
  }

  async exportGcode(cutSelectionOnly = false): Promise<void> {
    const plan = await this.generateJob(cutSelectionOnly);
    if (plan.gcode.length === 0) {
      this.setStatus('Nothing to export — check layer output');
      return;
    }
    const base = (store.getState().doc.meta.name || 'openburn').replace(/\s+/g, '_');
    const ok = await saveTextFile(`${base}.nc`, planToText(plan), 'nc', 'text/plain', [
      { name: 'GCode', extensions: ['nc', 'gcode', 'tap'] },
    ]);
    if (ok) this.setStatus(`Exported GCode (${plan.lineCount} lines)`);
  }

  // -------------------------------------------------------------------------
  // Material / interval tests and per-object overrides
  // -------------------------------------------------------------------------

  clearCutOverride(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    let cleared = 0;
    for (const obj of objs) {
      const target = obj as FabricObject & { cutOverride?: unknown };
      if (target.cutOverride != null) {
        delete target.cutOverride;
        cleared += 1;
      }
    }
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
    this.setStatus(cleared ? `Cleared ${cleared} cut override(s)` : 'No cut overrides in selection');
  }

  private ensureAnnotationLayer(): LayerDef {
    const state = store.getState();
    const existing = state.doc.layers.find((l) => l.name === 'NOTES');
    if (existing) return existing;

    const previous = state.activeLayerId;
    const created = store.addLayer();
    store.updateLayer(created.id, { name: 'NOTES', color: '#9aa0a6' });
    store.updateCutSettings(created.id, { output: false, visible: true, mode: 'line', power: 0 });
    store.setState({ activeLayerId: previous });
    return store.getState().doc.layers.find((l) => l.id === created.id) ?? created;
  }

  private makeNote(
    text: string,
    left: number,
    top: number,
    width: number,
    fontSize: number,
    layer: LayerDef,
  ): Textbox {
    const note = new Textbox(text, {
      left,
      top,
      width,
      fontSize,
      fontFamily: 'Inter',
      fill: layer.color,
      textAlign: 'center',
      objectCaching: false,
    });
    this.assignLayerDeep(note, layer.id);
    this.canvas.add(note);
    note.setCoords();
    return note;
  }

  generateMaterialTest(options: MaterialTestOptions): void {
    const state = store.getState();
    const layer = this.activeLayer();
    const notes = options.labels ? this.ensureAnnotationLayer() : null;
    const zoom = this.canvas.getZoom();

    const rows = Math.max(1, Math.min(12, Math.round(options.powerSteps)));
    const cols = Math.max(1, Math.min(12, Math.round(options.speedSteps)));
    const cell = Math.max(5, options.cellSize);
    const gap = Math.max(0, options.gap);
    const gridWidth = cols * cell + (cols - 1) * gap;
    const gridHeight = rows * cell + (rows - 1) * gap;
    const startX = Math.max(12, Math.round((state.doc.bed.width - gridWidth) / 2));
    const startY = Math.max(notes ? 24 : 12, Math.round((state.doc.bed.height - gridHeight) / 2) + 6);

    const valueAt = (min: number, max: number, index: number, count: number) =>
      count <= 1 ? min : min + ((max - min) * index) / (count - 1);

    const created: FabricObject[] = [];

    if (notes) {
      const header = this.makeNote(
        `MATERIAL TEST — speed (mm/s) × power (%)`,
        startX,
        Math.max(3, startY - 13),
        Math.max(gridWidth, 60),
        3,
        notes,
      );
      created.push(header);
    }

    for (let r = 0; r < rows; r += 1) {
      const power = Math.round(valueAt(options.powerMin, options.powerMax, r, rows));
      for (let c = 0; c < cols; c += 1) {
        const speed = Math.round(valueAt(options.speedMin, options.speedMax, c, cols));
        const left = startX + c * (cell + gap);
        const top = startY + r * (cell + gap);

        // Sublayer mode: one real layer per cell so both speed and power live in
        // layer settings and survive LightBurn/GRBL export without overrides.
        let cellLayer = layer;
        if (options.sublayers) {
          const child = store.addLayer();
          store.updateLayer(child.id, { name: `${layer.name} P${power} S${speed}` });
          store.updateCutSettings(child.id, {
            ...layer.settings,
            mode: options.mode,
            speed,
            power,
            passes: Math.max(1, options.passes),
            interval: options.interval,
            angle: options.angle,
            crossHatch: options.crossHatch,
          });
          cellLayer = store.getState().doc.layers.find((l) => l.id === child.id) ?? child;
        }

        const rect = new Rect({
          left,
          top,
          width: cell,
          height: cell,
          fill: 'transparent',
          stroke: cellLayer.color,
          strokeUniform: true,
          strokeWidth: 1.15 / zoom,
          objectCaching: false,
        });
        if (options.sublayers) {
          this.assignLayer(rect, cellLayer.id);
        } else {
          (rect as FabricObject & { cutOverride?: unknown }).cutOverride = {
            mode: options.mode,
            speed,
            power,
            passes: Math.max(1, options.passes),
            interval: options.interval,
            angle: options.angle,
            crossHatch: options.crossHatch,
          };
          this.assignLayer(rect, layer.id);
        }
        this.canvas.add(rect);
        rect.setCoords();
        created.push(rect);

        if (notes) {
          const fs = Math.max(1.5, Math.min(3.2, cell * 0.16));
          created.push(
            this.makeNote(
              `S${speed}\nP${power}`,
              left + cell * 0.05,
              top + cell * 0.05,
              cell * 0.9,
              fs,
              notes,
            ),
          );
        }
      }
    }

    // Keep the original layer active instead of the last generated sublayer.
    store.setState({ activeLayerId: layer.id });

    if (startX + gridWidth > state.doc.bed.width || startY + gridHeight > state.doc.bed.height) {
      this.setStatus('Material test exceeds the bed — move or resize it before cutting');
    } else if (options.sublayers) {
      this.setStatus(
        `Material test: ${rows * cols} sublayers (${rows} power × ${cols} speed)`,
      );
    } else {
      this.setStatus(
        `Material test: ${rows} power × ${cols} speed (${rows * cols} cells) on ${layer.name}`,
      );
    }

    this.reselect(created);
    this.afterChange();
    this.zoomToPage(false);
  }

  generateIntervalTest(options: IntervalTestOptions): void {
    const state = store.getState();
    const layer = this.activeLayer();
    const notes = options.labels ? this.ensureAnnotationLayer() : null;
    const zoom = this.canvas.getZoom();

    const steps = Math.max(1, Math.min(10, Math.round(options.steps)));
    const cell = Math.max(5, options.cellSize);
    const gap = 3;
    const totalWidth = steps * cell + (steps - 1) * gap;
    const totalHeight = cell + (notes ? 9 : 0);
    const startX = Math.max(12, Math.round((state.doc.bed.width - totalWidth) / 2));
    const startY = Math.max(notes ? 24 : 12, Math.round((state.doc.bed.height - totalHeight) / 2) + 6);

    const valueAt = (min: number, max: number, index: number, count: number) =>
      count <= 1 ? min : min + ((max - min) * index) / (count - 1);

    const created: FabricObject[] = [];

    if (notes) {
      created.push(
        this.makeNote(
          `INTERVAL TEST — speed ${options.speed} mm/s · power ${options.power}%`,
          startX,
          Math.max(3, startY - 13),
          Math.max(totalWidth, 60),
          3,
          notes,
        ),
      );
    }

    for (let i = 0; i < steps; i += 1) {
      const interval = valueAt(options.intervalMin, options.intervalMax, i, steps);
      const left = startX + i * (cell + gap);
      const rect = new Rect({
        left,
        top: startY,
        width: cell,
        height: cell,
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1.15 / zoom,
        objectCaching: false,
      });
      (rect as FabricObject & { cutOverride?: unknown }).cutOverride = {
        mode: 'fill',
        speed: options.speed,
        power: options.power,
        interval,
        passes: 1,
      };
      this.assignLayer(rect, layer.id);
      this.canvas.add(rect);
      rect.setCoords();
      created.push(rect);

      if (notes) {
        created.push(
          this.makeNote(
            `${interval.toFixed(2)} mm`,
            left,
            startY + cell + 1,
            cell,
            Math.max(1.6, Math.min(2.6, cell * 0.16)),
            notes,
          ),
        );
      }
    }

    this.setStatus(`Interval test: ${steps} patches (${options.intervalMin}–${options.intervalMax} mm)`);
    if (startX + steps * (cell + gap) > state.doc.bed.width) {
      this.setStatus('Interval test exceeds the bed — move or resize it');
    }

    this.reselect(created);
    this.afterChange();
    this.zoomToPage(false);
  }

  generateFocusTest(options: FocusTestOptions): void {
    const state = store.getState();
    const layer = this.activeLayer();
    const notes = options.labels ? this.ensureAnnotationLayer() : null;
    const zoom = this.canvas.getZoom();

    const steps = Math.max(2, Math.min(30, Math.round(options.steps)));
    const repeats = Math.max(1, Math.min(8, Math.round(options.repeats)));
    const length = Math.max(5, options.lineLength);
    const rowGap = Math.max(0.5, options.gap);
    const lineGap = Math.max(0.6, Math.min(4, length * 0.08));
    const blockHeight = repeats * lineGap;
    const totalWidth = length;
    const totalHeight = steps * blockHeight + (steps - 1) * rowGap;
    const startX = Math.max(10, Math.round((state.doc.bed.width - totalWidth) / 2));
    const startY = Math.max(notes ? 22 : 10, Math.round((state.doc.bed.height - totalHeight) / 2) + 4);

    const valueAt = (min: number, max: number, index: number, count: number) =>
      count <= 1 ? min : min + ((max - min) * index) / (count - 1);

    const created: FabricObject[] = [];
    if (notes) {
      created.push(
        this.makeNote(
          `FOCUS TEST — ${options.zMin.toFixed(2)} to ${options.zMax.toFixed(2)} mm · ${options.speed} mm/s · ${options.power}%`,
          startX,
          Math.max(2, startY - 12),
          Math.max(totalWidth, 60),
          2.8,
          notes,
        ),
      );
    }

    for (let r = 0; r < steps; r += 1) {
      const z = Math.round(valueAt(options.zMin, options.zMax, r, steps) * 100) / 100;
      const rowTop = startY + r * (blockHeight + rowGap);
      for (let i = 0; i < repeats; i += 1) {
        const y = rowTop + i * lineGap;
        const line = new Line([startX, y, startX + length, y], {
          stroke: layer.color,
          strokeUniform: true,
          strokeWidth: 1.15 / zoom,
          objectCaching: false,
        });
        (line as FabricObject & { zOffset?: number }).zOffset = z;
        (line as FabricObject & { cutOverride?: unknown }).cutOverride = {
          mode: 'line',
          speed: options.speed,
          power: options.power,
          passes: Math.max(1, options.passes),
        };
        this.assignLayer(line, layer.id);
        this.canvas.add(line);
        line.setCoords();
        created.push(line);
      }
      if (notes) {
        created.push(
          this.makeNote(
            `Z ${z.toFixed(2)} mm`,
            startX + length + 2,
            rowTop - 0.4,
            Math.max(16, 26),
            2.4,
            notes,
          ),
        );
      }
    }

    const zActive = state.device.zAxisEnabled;
    this.setStatus(
      zActive
        ? `Focus test: ${steps} Z steps (${options.zMin}–${options.zMax} mm) on ${layer.name}`
        : 'Focus test created — enable the Z axis in Settings → Machine to emit Z moves',
    );
    this.reselect(created);
    this.afterChange();
    this.zoomToPage(false);
  }

  generateKerfTest(options: KerfTestOptions): void {
    const state = store.getState();
    const layer = this.activeLayer();
    const notes = options.labels ? this.ensureAnnotationLayer() : null;
    const zoom = this.canvas.getZoom();
    const created: FabricObject[] = [];

    // Kerf tests must cut exactly on the nominal geometry.
    const baseOverride = {
      mode: 'line' as const,
      speed: layer.settings.speed,
      power: layer.settings.power,
      passes: Math.max(1, layer.settings.passes),
      kerf: 0,
    };

    if (options.method === 'span') {
      const count = Math.max(2, Math.min(40, Math.round(options.count)));
      const spacing = Math.max(0.5, options.spacing);
      const length = Math.max(5, options.length);
      const span = (count - 1) * spacing;
      const startX = Math.max(10, (state.doc.bed.width - span) / 2);
      const top = Math.max(10, (state.doc.bed.height - length) / 2);

      if (notes) {
        created.push(
          this.makeNote(
            `KERF TEST — ${count} lines · ${spacing} mm spacing · ${length} mm long · kerf 0`,
            startX - 5,
            Math.max(2, top - 12),
            Math.max(span + 10, 60),
            3,
            notes,
          ),
        );
      }

      for (let i = 0; i < count; i += 1) {
        const x = startX + i * spacing;
        const line = new Line([x, top, x, top + length], {
          stroke: layer.color,
          strokeUniform: true,
          strokeWidth: 1.15 / zoom,
          objectCaching: false,
        });
        (line as FabricObject & { cutOverride?: unknown }).cutOverride = { ...baseOverride };
        this.assignLayer(line, layer.id);
        this.canvas.add(line);
        line.setCoords();
        created.push(line);
      }

      this.setStatus(
        `Kerf span test: ${count} lines, ${spacing} mm apart. Measure outer edge to outer edge and enter it in Tools → Kerf Test.`,
      );
    } else {
      const width = Math.max(0.2, options.nominalWidth);
      const length = Math.max(5, options.length);
      const left = Math.max(10, (state.doc.bed.width - width) / 2);
      const top = Math.max(10, (state.doc.bed.height - length) / 2);

      if (notes) {
        created.push(
          this.makeNote(
            `KERF TEST — slot nominal ${width} mm × ${length} mm · kerf 0`,
            left - 10,
            Math.max(2, top - 12),
            Math.max(width + 20, 60),
            3,
            notes,
          ),
        );
      }

      const rect = new Rect({
        left,
        top,
        width,
        height: length,
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: 1.15 / zoom,
        objectCaching: false,
      });
      (rect as FabricObject & { cutOverride?: unknown }).cutOverride = { ...baseOverride };
      this.assignLayer(rect, layer.id);
      this.canvas.add(rect);
      rect.setCoords();
      created.push(rect);

      this.setStatus(
        `Kerf slot test: nominal ${width} mm. Measure the slot width and enter it in Tools → Kerf Test.`,
      );
    }

    const widthUsed = options.method === 'span' ? (options.count - 1) * options.spacing : options.nominalWidth;
    if (widthUsed + 40 > state.doc.bed.width && options.method === 'span') {
      this.setStatus('Kerf test exceeds the bed — reduce the line count or spacing');
    }

    this.reselect(created);
    this.afterChange();
    this.zoomToPage(false);
  }

  setSelectionZOffset(z: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.setStatus('Select an object first');
      return;
    }
    for (const obj of objs) {
      (obj as FabricObject & { zOffset?: number }).zOffset = Number.isFinite(z) ? z : 0;
    }
    this.syncSelection();
    this.afterChange();
    this.setStatus(`Z offset set to ${z.toFixed(2)} mm`);
  }

  // -------------------------------------------------------------------------
  // Image adjustments, tracing and tabs
  // -------------------------------------------------------------------------

  applyImageAdjust(adjust: ImageAdjust): void {
    const images = this.canvas
      .getActiveObjects()
      .filter((o): o is FabricImage => o instanceof FabricImage);
    if (images.length === 0) {
      this.setStatus('Select an image first');
      return;
    }
    for (const img of images) {
      (img as FabricImage & { imageAdjust?: ImageAdjust }).imageAdjust = { ...adjust };
    }
    this.canvas.requestRenderAll();
    this.afterChange();
    this.setStatus(`Image adjustment applied to ${images.length} image(s)`);
  }

  getSelectedImageInfo(): { dataUrl: string; adjust: ImageAdjust } | null {
    const img = this.canvas
      .getActiveObjects()
      .find((o): o is FabricImage => o instanceof FabricImage);
    if (!img) return null;

    const element = img.getElement() as
      | HTMLImageElement
      | HTMLCanvasElement
      | HTMLVideoElement
      | null;
    if (!element) return null;

    let dataUrl: string | null = null;
    if (typeof HTMLImageElement !== 'undefined' && element instanceof HTMLImageElement) {
      dataUrl = element.src;
    } else if (typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement) {
      dataUrl = element.toDataURL();
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width || 1));
      canvas.height = Math.max(1, Math.round(img.height || 1));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(element as CanvasImageSource, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL();
      }
    }
    if (!dataUrl) return null;

    const adjust =
      (img as FabricImage & { imageAdjust?: ImageAdjust }).imageAdjust ?? {
        ...DEFAULT_IMAGE_ADJUST,
      };
    return { dataUrl, adjust };
  }

  async traceSelectedImage(options: TraceOptions): Promise<void> {
    const images = this.canvas
      .getActiveObjects()
      .filter((o): o is FabricImage => o instanceof FabricImage);
    if (images.length === 0) {
      this.setStatus('Select an image to trace');
      return;
    }

    const layer = this.activeLayer();
    const created: FabricObject[] = [];
    this.setStatus('Tracing image…');

    for (const img of images) {
      try {
        const group = await traceImageObject(img, options);
        if (!group) continue;
        this.assignLayerDeep(group, layer.id);
        this.canvas.add(group);
        group.setCoords();
        created.push(group);
      } catch (err) {
        this.setStatus(`Trace failed: ${(err as Error).message}`);
      }
    }

    if (created.length > 0) {
      this.reselect(created);
      this.afterChange();
      this.setStatus(`Traced ${created.length} image(s) into vector paths`);
    } else {
      this.setStatus('Trace produced no contours — adjust threshold / colors');
    }
  }

  addTabs(tabWidth: number, spacing: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.setStatus('Select closed shapes to add tabs');
      return;
    }

    const layer = this.activeLayer();
    const zoom = this.canvas.getZoom();
    const created: FabricObject[] = [];

    for (const obj of objs) {
      if (obj instanceof FabricImage || this.isText(obj)) continue;
      const contours = objectContours(obj);
      if (contours.length === 0) continue;

      const pieces: Pt[][] = [];
      for (const contour of contours) {
        if (contour.closed) pieces.push(...addTabsToContour(contour.points, tabWidth, spacing));
        else pieces.push(contour.points);
      }
      if (pieces.length === 0) continue;

      const pathData = pieces
        .map((piece) =>
          piece
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
            .join(' '),
        )
        .join(' ');

      const path = new FabricPath(pathData, {
        fill: 'transparent',
        stroke: layer.color,
        strokeWidth: 1.15 / zoom,
        strokeUniform: true,
        objectCaching: false,
      });
      this.assignLayerDeep(path, (obj as FabricObject & { layerId?: string }).layerId ?? layer.id);
      this.canvas.remove(obj);
      this.canvas.add(path);
      path.setCoords();
      created.push(path);
    }

    if (created.length > 0) {
      this.reselect(created);
      this.afterChange();
      this.setStatus(
        layer.settings.mode === 'line'
          ? `Added tabs to ${created.length} shape(s)`
          : `Added tabs to ${created.length} shape(s) — switch the layer to Line mode to cut them`,
      );
    } else {
      this.setStatus('No closed vector shapes selected');
    }
  }

  // -------------------------------------------------------------------------
  // System clipboard
  // -------------------------------------------------------------------------

  private onPaste = (e: ClipboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector('.dialog-backdrop')) return;
    const data = e.clipboardData;
    if (!data) return;

    const files = Array.from(data.files);
    const imageItem = Array.from(data.items).find(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    const imageFile = files.length === 0 && imageItem ? imageItem.getAsFile() : null;
    const text = data.getData('text/plain');
    const html = data.getData('text/html');
    const svg = data.getData('image/svg+xml');
    if (files.length === 0 && !imageFile && !svg && !text.trim() && !html) return;

    e.preventDefault();
    void this.handlePastedPayload({
      text,
      html,
      svg,
      files: imageFile ? [...files, imageFile] : files,
    });
  };

  async pasteFromSystem(): Promise<void> {
    try {
      if (window.openburn?.readClipboard) {
        const data = await window.openburn.readClipboard();
        const handled = await this.handlePastedPayload(data);
        if (!handled) this.setStatus('Clipboard is empty or unsupported');
        return;
      }

      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const payload: { text?: string; html?: string; image?: string; svg?: string } = {};
        for (const item of items) {
          for (const type of item.types) {
            if (type === 'image/svg+xml') {
              payload.svg = await (await item.getType(type)).text();
            } else if (type === 'image/x-inkscape-compressed-svg') {
              // Inkscape stores the vector payload compressed on the clipboard.
              try {
                const blob = await item.getType(type);
                const decoded = await this.decompressSvgBlob(blob);
                if (decoded) payload.svg = decoded;
              } catch {
                /* ignore malformed payloads */
              }
            } else if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              if (!payload.image) payload.image = await this.blobToDataUrl(blob);
            } else if (type === 'text/plain') {
              payload.text = await (await item.getType(type)).text();
            } else if (type === 'text/html') {
              payload.html = await (await item.getType(type)).text();
            }
          }
        }
        const handled = await this.handlePastedPayload(payload);
        if (!handled) this.setStatus('Clipboard is empty or unsupported');
      } else {
        this.setStatus('Use Ctrl+V to paste from the system clipboard');
      }
    } catch (err) {
      this.setStatus(`Clipboard access failed: ${(err as Error).message}. Try Ctrl+V.`);
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Decompress an Inkscape clipboard SVG (gzip / zlib / raw deflate). */
  private async decompressSvgBlob(blob: Blob): Promise<string> {
    if (typeof DecompressionStream === 'undefined') return '';
    const formats: CompressionFormat[] = ['gzip', 'deflate', 'deflate-raw'];
    for (const format of formats) {
      try {
        const stream = blob.stream().pipeThrough(new DecompressionStream(format));
        const text = await new Response(stream).text();
        if (/<svg[\s>]/i.test(text)) return text;
      } catch {
        /* try the next compression variant */
      }
    }
    return '';
  }

  private async handlePastedPayload(payload: {
    text?: string | null;
    html?: string | null;
    image?: string | null;
    svg?: string | null;
    files?: File[];
  }): Promise<boolean> {
    for (const file of payload.files ?? []) {
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
        await this.importSvg(await file.text());
        this.setStatus('Pasted SVG from clipboard');
        return true;
      }
    }

    // Vector formats win over the raster snapshot that editors (e.g. Inkscape)
    // put on the clipboard alongside the SVG.
    const htmlSvg = payload.html?.match(/<svg[\s\S]*?<\/svg>/i)?.[0] ?? null;
    // When copying prose from a page that merely contains an inline icon, the
    // HTML also has an <svg>. Ignore it unless the vector is the whole payload.
    const htmlHasProse = htmlSvg
      ? payload.html!
          .replace(htmlSvg, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .trim().length > 0
      : false;
    const svgCandidates = [
      payload.svg,
      /^<svg[\s>]/i.test((payload.text ?? '').trim()) ? payload.text : null,
      htmlHasProse || (payload.text ?? '').trim() ? null : htmlSvg,
    ];
    for (const candidate of svgCandidates) {
      if (candidate && /<svg[\s>]/i.test(candidate) && /<\/svg>/i.test(candidate)) {
        await this.importSvg(candidate);
        this.setStatus('Pasted SVG from clipboard');
        return true;
      }
    }

    for (const file of payload.files ?? []) {
      if (file.type.startsWith('image/')) {
        await this.importImage(await this.blobToDataUrl(file));
        this.setStatus('Pasted image from clipboard');
        return true;
      }
    }

    if (payload.image) {
      await this.importImage(payload.image);
      this.setStatus('Pasted image from clipboard');
      return true;
    }

    const text = payload.text ?? '';
    if (text.trim()) {
      this.addTextFromClipboard(text);
      return true;
    }
    return false;
  }

  private addTextFromClipboard(text: string): void {
    const content = text.replace(/\r\n/g, '\n');
    if (!content.trim()) return;
    const layer = this.activeLayer();
    const vpt = this.canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const zoom = this.canvas.getZoom();
    const centerX = (this.host.clientWidth / 2 - vpt[4]) / zoom;
    const centerY = (this.host.clientHeight / 2 - vpt[5]) / zoom;
    const width = Math.max(40, Math.min(120, content.length * 2.2));

    const box = new Textbox(content, {
      left: centerX - width / 2,
      top: centerY - 5,
      width,
      fontSize: 8,
      fontFamily: 'Inter',
      fill: layer.color,
      objectCaching: false,
    });
    this.assignLayerDeep(box, layer.id);
    this.canvas.add(box);
    box.setCoords();
    this.canvas.setActiveObject(box);
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
    this.setStatus('Pasted text from clipboard');
  }

  updateCursor(x: number, y: number): void {
    store.setState({ cursor: { x, y } });
  }

  setStatus(text: string): void {
    store.setState({ statusText: text });
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    // Dialogs own their keyboard handling; don't fire canvas shortcuts.
    if (document.querySelector('.dialog-backdrop')) return;

    if (e.code === 'Space') {
      this.spaceDown = true;
      this.canvas.defaultCursor = 'grab';
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('openburn:preview'));
      return;
    }

    // LightBurn-style Alt/Option shortcuts.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          this.breakApart();
          return;
        case 'v':
          e.preventDefault();
          void this.pasteInPlace();
          return;
        default:
          break;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) this.redo();
          else this.undo();
          return;
        case 'y':
          e.preventDefault();
          this.redo();
          return;
        case 'h':
          // LightBurn: Flip Horizontal
          e.preventDefault();
          this.flip('h');
          return;
        case 'u':
          // LightBurn: Ungroup
          e.preventDefault();
          this.ungroup();
          return;
        case 'c':
          e.preventDefault();
          this.copySelection();
          return;
        case 'x':
          e.preventDefault();
          this.copySelection();
          this.deleteSelection();
          return;
        case 'v':
          if (this.clipboard.length > 0 && !e.shiftKey) {
            e.preventDefault();
            void this.pasteClipboard();
          } else if (window.openburn?.readClipboard) {
            e.preventDefault();
            void this.pasteFromSystem();
          }
          // In the browser without internal content, let the paste event fire.
          return;
        case 'd':
          e.preventDefault();
          this.duplicateSelection();
          return;
        case 'a':
          e.preventDefault();
          // LightBurn: Ctrl+Shift+A = Frame Selection
          if (e.shiftKey) this.zoomToFitSelection();
          else this.selectAll();
          return;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) this.ungroup();
          else this.group();
          return;
        case 's':
          e.preventDefault();
          void this.saveDocument(e.shiftKey);
          return;
        case 'o':
          e.preventDefault();
          void this.openDocument();
          return;
        case 'n':
          e.preventDefault();
          this.newDocument();
          return;
        case 'i':
          e.preventDefault();
          void this.importFile();
          return;
        case 'e':
          e.preventDefault();
          void this.exportGcode(false);
          return;
        case '0':
          e.preventDefault();
          this.zoomToPage();
          return;
        case '=':
        case '+':
          e.preventDefault();
          this.zoomBy(1.25);
          return;
        case '-':
          e.preventDefault();
          this.zoomBy(0.8);
          return;
        default:
          return;
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }

    if (e.key === 'Escape') {
      if (this.drawing) {
        if (this.drawing.obj) this.canvas.remove(this.drawing.obj);
        this.drawing = null;
      }
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
      store.setState({ tool: 'select' });
      this.syncSelection();
      return;
    }

    if (e.key.startsWith('Arrow')) {
      const objs = this.canvas.getActiveObjects();
      if (objs.length === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.translate(objs, dx, dy);
      return;
    }

    // LightBurn-style single-key shortcuts (edit window in focus).
    if (!e.altKey) {
      const plain = e.key.toLowerCase();
      const hasSelection = this.canvas.getActiveObjects().length > 0;
      if (hasSelection) {
        if (plain === 'h') {
          e.preventDefault();
          this.flip('h');
          return;
        }
        if (plain === 'v') {
          e.preventDefault();
          this.flip('v');
          return;
        }
        if (e.key === '.') {
          e.preventDefault();
          this.rotate(90);
          return;
        }
        if (e.key === ',') {
          e.preventDefault();
          this.rotate(-90);
          return;
        }
      }
      if (e.key === '+' || e.key === '-') {
        e.preventDefault();
        this.zoomBy(e.key === '+' ? 1.25 : 0.8);
        return;
      }
    }

    const toolKeys: Record<string, ToolId> = {
      s: 'select',
      n: 'node',
      l: 'line',
      r: 'rect',
      e: 'ellipse',
      p: 'polygon',
      t: 'text',
      m: 'measure',
    };
    const key = e.key.toLowerCase();
    if (toolKeys[key] && !e.altKey) {
      store.setState({ tool: toolKeys[key] });
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.updateCursorStyle();
    }
  };

  // Exposed for the UI
  getCanvas(): Canvas {
    return this.canvas;
  }

  getSelectedSnapshot() {
    return store.getState().selection;
  }
}

function anchorCoords(cmd: unknown[]): { x: number; y: number } | null {
  const type = cmd[0];
  const pair = (xi: number, yi: number) => {
    const x = cmd[xi];
    const y = cmd[yi];
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
  };
  if (type === 'M' || type === 'L') return pair(1, 2);
  if (type === 'C') return pair(5, 6);
  if (type === 'Q') return pair(3, 4);
  if (type === 'A') return pair(6, 7);
  return null;
}

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, '');
}

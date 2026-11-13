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
  type DroppedFile,
  type FocusTestOptions,
  type IntervalTestOptions,
  type KerfTestOptions,
  type MaterialTestOptions,
  type TextAlign,
  type ToolId,
  type WorkspaceApi,
} from '@/state/store';
import { buildDocument, parseDocument, serializeDocument } from '@/core/serialize';
import { HistoryBuffer } from './history';
import {
  pickArtwork,
  mimeForFile,
  pickProject,
  saveProjectFile,
  saveTextFile,
} from '@/core/fileApi';
import { dropKindForFile } from '@/core/dropRouting';
import { addRecentFile } from '@/state/recentStore';
import { requestDiscardConfirmation } from '@/state/discardGuard';
import { booleanObjects, isConvertible, objectToPathData } from '@/geometry/paperOps';
import { offsetPathData } from '@/geometry/offset';
import { objectContours } from '@/gcode/geometry';
import { parseDxf } from '@/core/dxf';
import { prepareSvgForImport, applySvgPhysicalSize } from '@/io/svg';
import { findImageLayer } from './layers';
import { applyNumericSingle, resolveSizePatch } from './numeric';
import { liveMeasure } from './measure';
import {
  buildPath,
  insertNode,
  isCurvedSegment,
  moveAnchor,
  moveHandle,
  nearestOnSubpath,
  removeNodes,
  parsePath,
  removeNode,
  setNodeType,
  toggleSegmentType,
  type NodeType,
  type Subpath,
} from './nodes';
import {
  intersectionTargets,
  snapDragDelta,
  snapPoint,
  targetsForShape,
  type SnapKind,
  type SnapOptions,
  type SnapShape,
  type SnapTarget,
} from './snap';
import { buildFramePlan, buildJob, planToText } from '@/gcode/job';
import type { JobPlan, Pt } from '@/gcode/types';
import {
  DEFAULT_IMAGE_ADJUST,
  type CutSettings,
  type ImageAdjust,
  type LayerDef,
  type OpenBurnDocument,
} from '@/types/document';
import { textToScenePath } from '@/text/outline';
import { addTabsToContour } from '@/geometry/tabs';
import { traceImageByColor, traceImageObject, type TraceOptions } from '@/image/trace';
import {
  parseLightBurn,
  serializeLightBurn,
  type LightBurnFormat,
  type LightBurnImportResult,
} from '@/io/lightburn';

// Serialize our per-object layer assignment along with everything else.
FabricObject.customProperties = ['layerId', 'cutOverride', 'imageAdjust', 'zOffset', 'cutPriority'];
Group.customProperties = ['layerId', 'cutOverride', 'imageAdjust', 'zOffset', 'cutPriority'];

const SELECTION_ACCENT = '#3f8fdd';

/**
 * On-screen thickness of design strokes in device pixels. A value of 1 draws a
 * hairline regardless of zoom, matching how LightBurn renders the laser path
 * (the real cut width is decided by the machine, not the artwork).
 */
const HAIRLINE_PX = 1;

/** Space left for the viewport rulers (top band + left band) when fitting. */
const RULER_INSET = 34;

/** Stroke width used when writing vector artwork to SVG (mm). */
const EXPORT_STROKE_MM = 0.1;

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

  /** Monotonic counter backing `objectId` for snap targets. */
  private snapIds = 0;
  /** Guides drawn while a drag snaps to an object edge/centre. */
  private snapGuides: Line[] = [];
  /** Objects being dragged, so a selection never snaps to itself. */
  private dragSnap: Set<string> | null = null;

  private drawing: DrawState | null = null;
  private panning = false;
  private spaceDown = false;
  private lastPan = { x: 0, y: 0 };
  private disposed = false;

  /** Interactive "mirror across a line" tool (Ctrl+Shift+M). */
  private mirrorMode: {
    start: Point | null;
    end: Point | null;
    targets: FabricObject[];
    guide?: Line;
  } | null = null;

  /** Interactive "rotate by two points" tool (Ctrl+2). */
  private rotate2Mode: {
    base: Point | null;
    end: Point | null;
    targets: FabricObject[];
    guide?: Line;
  } | null = null;

  private nodeTarget: FabricPath | null = null;
  private nodeHandles: { circle: Circle; subIndex: number; nodeIndex: number }[] = [];
  /** Bézier handles of the edited path: movable squares plus their guides. */
  private nodeControls: { shape: Rect; guide: Line }[] = [];
  /** Selected nodes as `subIndex:nodeIndex` keys. */
  private nodeSelected = new Set<string>();
  private nodeDragging = false;

  /** Box/angle captured when a move/scale/rotate gesture starts. */
  private measureStart: { left: number; top: number; width: number; height: number } | null = null;
  private measureAngleStart = 0;
  private measureLineLength: number | undefined;
  private lastMeasureAt = 0;
  private lastCursorStoreX = Number.NaN;
  private lastCursorStoreY = Number.NaN;

  /**
   * X11/Chromium turns a middle-click into a paste from the PRIMARY selection.
   * Panning with the wheel button must not paste, so paste events that follow a
   * middle-button press are ignored.
   */
  private suppressPasteUntil = 0;

  private history = new HistoryBuffer();
  private currentSnapshot = '';
  private suppressHistory = false;
  private editingText = false;
  private historyTimer: number | null = null;
  private clipboard: Record<string, unknown>[] = [];
  private layerSettingsClipboard: Partial<CutSettings> | null = null;
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
      // Fabric defaults this to false, which hides middle-button mouse:down
      // events and breaks panning with the mouse wheel button.
      fireMiddleClick: true,
      stopContextMenu: false,
      uniformScaling: state.lockAspect,
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
    // Capture phase: runs before Fabric and before the synthetic paste event.
    window.addEventListener('mousedown', this.onPointerButton, true);
    window.addEventListener('mouseup', this.onPointerButton, true);
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
    window.removeEventListener('mousedown', this.onPointerButton, true);
    window.removeEventListener('mouseup', this.onPointerButton, true);
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
    this.applyAspectLock();
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

  /**
   * Fabric decides whether a corner drag keeps the aspect ratio from
   * `canvas.uniformScaling`, flipping the behaviour while `uniScaleKey`
   * (Shift) is held. Mirror the panel's aspect lock: locked by default, and
   * Shift frees the scale so the user can still stretch freely.
   */
  private applyAspectLock(): void {
    this.canvas.uniformScaling = store.getState().lockAspect;
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
        // Middle-click would otherwise start the browser's autoscroll.
        if (e.button === 1) e.preventDefault();
        this.panning = true;
        this.lastPan = { x: e.clientX, y: e.clientY };
        this.canvas.defaultCursor = 'grabbing';
        return;
      }
      if (e.button === 2) return;
      if (this.mirrorMode || this.rotate2Mode) {
        if (e.button === 0) this.handleTransformClick(this.canvas.getScenePoint(e));
        return;
      }
      const tool = store.getState().tool;
      if (this.isDrawTool(tool)) {
        this.beginDraw(tool, this.canvas.getScenePoint(e));
      }
    });

    // Node editing: double-clicking a segment inserts a node there.
    this.canvas.on('mouse:dblclick', (opt) => {
      if (store.getState().tool !== 'node') return;
      const button = (opt.e as MouseEvent).button;
      if (button !== 0) return;
      const target = opt.target;
      if (target instanceof FabricPath) {
        this.canvas.setActiveObject(target);
        this.nodeTarget = target;
        this.insertNodeAt(target, this.canvas.getScenePoint(opt.e as MouseEvent));
        return;
      }
      if (this.nodeTarget) {
        this.insertNodeAt(this.nodeTarget, this.canvas.getScenePoint(opt.e as MouseEvent));
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
      if (this.mirrorMode || this.rotate2Mode) this.handleTransformMove(p);
      if (this.drawing) this.updateDraw(p);
      const now = performance.now();
      if (now - this.lastCursorPush > 50) {
        this.lastCursorPush = now;
        this.updateCursor(p.x, p.y);
      }
    });

    this.canvas.on('mouse:up', () => {
      this.endMeasure();
      if (this.panning) {
        this.panning = false;
        this.updateCursorStyle();
        return;
      }
      if (this.mirrorMode || this.rotate2Mode) return;
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

    // Live measurements: remember the box/angle when a gesture starts and
    // publish the delta (throttled) while it runs.
    const beginGesture = () => {
      this.beginMeasure();
      this.beginDragSnap();
    };
    const trackGesture = () => this.trackMeasure();
    this.canvas.on('before:transform', beginGesture);
    this.canvas.on('object:moving', (e) => {
      this.trackMeasure();
      this.applyDragSnap(e.target);
    });
    this.canvas.on('object:scaling', trackGesture);
    this.canvas.on('object:rotating', trackGesture);

    this.canvas.on('object:modified', () => {
      this.endMeasure();
      this.clearSnapGuides();
      this.setSnapHint(null);
      this.dragSnap = null;
      this.syncSelection();
      this.afterChange();
    });
    this.canvas.on('object:added', () => this.afterChange());
    this.canvas.on('object:removed', () => this.afterChange());

    // Leaving the canvas hides the pointer marker on the rulers.
    this.canvas.on('mouse:out', () => {
      this.bg.setCursor(null);
    });

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
    const width = HAIRLINE_PX / Math.max(zoom, 0.0001);
    this.forEachStyledObject((obj) => {
      if (this.isText(obj) || obj.type === 'image') return;
      obj.set({ strokeWidth: width, strokeUniform: true, objectCaching: false });
    });
    this.canvas.requestRenderAll();
  }

  /**
   * Walk every drawable object, descending into groups so nested artwork keeps
   * the layer colour and hairline stroke (Fabric groups do not inherit either).
   */
  private forEachStyledObject(fn: (obj: FabricObject) => void): void {
    const walk = (objs: FabricObject[], inheritedLayer?: string): void => {
      for (const obj of objs) {
        if (this.isNodeHandle(obj)) continue;
        const tagged = obj as FabricObject & { layerId?: string };
        if (!tagged.layerId && inheritedLayer) tagged.layerId = inheritedLayer;
        if (obj instanceof Group) {
          walk(obj.getObjects(), tagged.layerId);
          continue;
        }
        fn(obj);
      }
    };
    walk(this.canvas.getObjects());
  }

  private hairlineWidth(): number {
    return HAIRLINE_PX / Math.max(this.canvas.getZoom(), 0.0001);
  }

  zoomToPage(notify = true): void {
    const { bed } = store.getState().doc;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const margin = RULER_INSET;
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
    const target = this.snapTargetFor(p);
    return target ?? p;
  }

  // -------------------------------------------------------------------------
  // Snapping
  // -------------------------------------------------------------------------

  /** Engine options derived from the store and the current zoom. */
  private snapOptions(exclude?: ReadonlySet<string>): SnapOptions {
    const s = store.getState();
    // In Fabric `getZoom()` is device pixels per scene unit, while the engine
    // works in scene units per pixel.
    const zoom = 1 / Math.max(this.canvas.getZoom(), 0.0001);
    return {
      enabled: s.snapSettings.enabled,
      grid: s.snapSettings.grid,
      objects: s.snapSettings.objects,
      intersections: s.snapSettings.intersections,
      radiusPx: s.snapSettings.radiusPx,
      gridSize: s.gridSize,
      zoom,
      ...(exclude ? { exclude } : {}),
    };
  }

  /**
   * Corners of every non-handle object in the given list, in scene space.
   * Images and paths use their bounding box, which is what LightBurn snaps to
   * for shapes whose vertices are not meaningful.
   */
  private snapShapes(objects?: FabricObject[]): SnapShape[] {
    const list = objects ?? this.canvas.getObjects();
    const shapes: SnapShape[] = [];
    for (const obj of list) {
      if (this.isNodeHandle(obj) || this.isAuxiliaryObject(obj)) continue;
      let rect: { left: number; top: number; width: number; height: number };
      try {
        const b = obj.getBoundingRect();
        rect = { left: b.left, top: b.top, width: b.width, height: b.height };
      } catch {
        continue;
      }
      const corners: Pt[] = [
        { x: rect.left, y: rect.top },
        { x: rect.left + rect.width, y: rect.top },
        { x: rect.left + rect.width, y: rect.top + rect.height },
        { x: rect.left, y: rect.top + rect.height },
      ];
      shapes.push({ id: this.objectId(obj), corners });
    }
    return shapes;
  }

  /** Every snap target of the current scene, including intersections. */
  private collectSnapTargets(shapes?: SnapShape[]): SnapTarget[] {
    const list = shapes ?? this.snapShapes();
    const targets: SnapTarget[] = [];
    for (const shape of list) targets.push(...targetsForShape(shape));
    if (store.getState().snapSettings.intersections && list.length > 1) {
      targets.push(...intersectionTargets(list));
    }
    return targets;
  }

  /** Snap a scene point against the scene and publish the visual hint. */
  private snapTargetFor(
    p: Point,
    mode: 'objects' | 'grid' | 'both' = 'both',
    exclude?: ReadonlySet<string>,
  ): Point | null {
    const options = this.snapOptions(exclude);
    if (!options.enabled) {
      this.setSnapHint(null);
      return null;
    }
    const scoped: SnapOptions = {
      ...options,
      objects: mode === 'grid' ? false : options.objects,
      grid: mode === 'both' ? options.grid : false,
    };
    const shapes = scoped.objects ? this.snapShapes() : [];
    const hit = snapPoint(p, scoped.objects ? this.collectSnapTargets(shapes) : [], scoped);
    this.setSnapHint(hit ? { kind: hit.kind, x: hit.point.x, y: hit.point.y } : null);
    return hit ? new Point(hit.point.x, hit.point.y) : null;
  }

  private setSnapHint(hint: { kind: SnapKind; x: number; y: number } | null): void {
    const current = store.getState().snapHint;
    if (!hint && !current) return;
    if (hint && current && current.kind === hint.kind && current.x === hint.x && current.y === hint.y) return;
    store.setState({ snapHint: hint });
  }

  /** Stable id per canvas object, used to stop objects snapping to themselves. */
  private objectId(obj: FabricObject): string {
    const tagged = obj as FabricObject & { __snapId?: string };
    if (!tagged.__snapId) {
      this.snapIds += 1;
      tagged.__snapId = `o${this.snapIds}`;
    }
    return tagged.__snapId;
  }

  /** Helpers drawn by the editor (node handles, guides) are not snap targets. */
  private isAuxiliaryObject(obj: FabricObject): boolean {
    const tagged = obj as FabricObject & { isNodeHandle?: boolean; isSnapGuide?: boolean; isAuxiliary?: boolean };
    return tagged.isNodeHandle === true || tagged.isSnapGuide === true || tagged.isAuxiliary === true;
  }

  /**
   * Snap a drawn shape while it is created: the start point uses the objects
   * and the grid, the current point prefers the grid so the size stays round.
   */
  private snapDrawPoint(p: Point, phase: 'start' | 'current'): Point {
    return this.snapTargetFor(p, phase === 'start' ? 'both' : 'grid') ?? p;
  }

  // -------------------------------------------------------------------------
  // Snapping while dragging a selection
  // -------------------------------------------------------------------------

  /**
   * Capture the selection box and the starting position of every dragged
   * object. Snapping is applied as a delta on top of Fabric's own movement, so
   * the drag never fights the built-in transform.
   */
  private beginDragSnap(): void {
    const active = this.canvas.getActiveObject();
    if (!active) {
      this.dragSnap = null;
      return;
    }
    const objects = active instanceof ActiveSelection ? active.getObjects() : [active];
    const targets = objects.filter((o) => !this.isNodeHandle(o) && !this.isAuxiliaryObject(o));
    if (targets.length === 0) {
      this.dragSnap = null;
      return;
    }
    this.dragSnap = new Set(targets.map((o) => this.objectId(o)));
  }

  /**
   * Resolve the snapped delta for the current drag frame and shift the active
   * object (or selection) accordingly. Runs on every `object:moving`; the
   * expensive target collection is skipped while snapping is off.
   */
  private applyDragSnap(target: FabricObject | undefined): void {
    if (!target || this.isNodeHandle(target)) return;
    const s = store.getState();
    if (!s.snapSettings.enabled || !s.snapSettings.objects || !this.dragSnap) return;
    const drag = this.dragSnap;
    if (!drag) return;
    const options = this.snapOptions(drag);
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const box = active instanceof ActiveSelection
      ? this.selectionBounds(active.getObjects())
      : this.selectionBounds([active]);
    const shapes = this.snapShapes(this.canvas.getObjects().filter((o) => !drag.has(this.objectId(o))));
    const targets = this.collectSnapTargets(shapes);
    const snap = snapDragDelta(box, targets, options);
    this.setSnapHint(
      snap.guideX !== null || snap.guideY !== null
        ? { kind: 'vertex', x: snap.guideX ?? box.left, y: snap.guideY ?? box.top }
        : null,
    );
    this.drawSnapGuides(snap.guideX, snap.guideY);
    if (snap.dx === 0 && snap.dy === 0) return;
    if (active instanceof ActiveSelection) {
      for (const obj of active.getObjects()) {
        obj.left = (obj.left ?? 0) + snap.dx;
        obj.top = (obj.top ?? 0) + snap.dy;
        obj.setCoords();
      }
    } else {
      active.left = (active.left ?? 0) + snap.dx;
      active.top = (active.top ?? 0) + snap.dy;
      active.setCoords();
    }
  }

  private clearSnapGuides(): void {
    if (this.snapGuides.length === 0) return;
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    for (const guide of this.snapGuides) this.canvas.remove(guide);
    this.snapGuides = [];
    this.suppressHistory = previous;
    this.canvas.requestRenderAll();
  }

  /**
   * Full-height/width dashed guides at the snapped edge. They are marked as
   * auxiliary objects so they never become selection, export or snap targets.
   */
  private drawSnapGuides(x: number | null, y: number | null): void {
    this.clearSnapGuides();
    const { bed } = store.getState().doc;
    const zoom = Math.max(this.canvas.getZoom(), 0.0001);
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    const add = (x1: number, y1: number, x2: number, y2: number) => {
      const line = new Line([x1, y1, x2, y2], {
        stroke: '#e0663f',
        strokeDashArray: [6 / zoom, 4 / zoom],
        strokeWidth: HAIRLINE_PX / zoom,
        strokeUniform: true,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
      });
      (line as Line & { isSnapGuide?: boolean }).isSnapGuide = true;
      this.snapGuides.push(line);
      this.canvas.add(line);
    };
    if (x !== null) add(x, -10, x, bed.height + 10);
    if (y !== null) add(-10, y, bed.width + 10, y);
    this.suppressHistory = previous;
    this.canvas.requestRenderAll();
  }

  private beginDraw(tool: ToolId, raw: Point): void {
    const p = this.snapDrawPoint(raw, 'start');
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
        strokeWidth: this.hairlineWidth(),
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
        strokeWidth: this.hairlineWidth(),
        objectCaching: false,
      });
    } else if (tool === 'line') {
      obj = new Line([p.x, p.y, p.x, p.y], {
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: this.hairlineWidth(),
        objectCaching: false,
      });
    } else if (tool === 'polygon') {
      const sides = store.getState().polygonSides;
      const poly = this.buildPolygon(sides, 0.001, p);
      poly.set({
        fill: 'transparent',
        stroke: layer.color,
        strokeUniform: true,
        strokeWidth: this.hairlineWidth(),
        objectCaching: false,
      });
      obj = poly;
    } else if (tool === 'measure') {
      obj = new Line([p.x, p.y, p.x, p.y], {
        stroke: '#e0b84a',
        strokeDashArray: [4, 3],
        strokeUniform: true,
        strokeWidth: this.hairlineWidth(),
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
    const s = this.snapDrawPoint(p, 'current');
    const start = d.start;
    const obj = d.obj;

    if (d.tool === 'rect' || d.tool === 'roundedRect') {
      // Snap the dragged corner, not only the fixed one, so a rectangle can be
      // drawn edge-to-edge against another shape (like LightBurn).
      // The dragged corner snaps to objects too, so a rectangle can be pulled
      // to another shape's edge (its visible edge meets the target).
      const dragged = this.snapTargetFor(new Point(p.x, p.y), 'both');
      const end = dragged ?? s;
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
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
  // Live measurements
  // -------------------------------------------------------------------------

  private beginMeasure(): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.measureStart = null;
      return;
    }
    this.measureStart = this.selectionBounds(objs);
    this.measureAngleStart = this.currentSelectionAngle(objs);
    this.measureLineLength = this.selectionLineLength(objs);
    this.lastMeasureAt = 0;
  }

  private trackMeasure(): void {
    if (!this.measureStart) return;
    const now = performance.now();
    if (now - this.lastMeasureAt < 16) return;
    this.lastMeasureAt = now;

    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return;
    const current = this.selectionBounds(objs);
    const angle = this.currentSelectionAngle(objs);
    const line = this.selectionLineLength(objs);
    store.setState({
      measure: liveMeasure(this.measureStart, current, angle, line ?? this.measureLineLength),
    });
  }

  private endMeasure(): void {
    this.measureStart = null;
    if (store.getState().measure) store.setState({ measure: null });
  }

  private currentSelectionAngle(objs: FabricObject[]): number {
    if (objs.length === 1) return objs[0].angle ?? 0;
    return this.canvas.getActiveObject()?.angle ?? 0;
  }

  /** Length of the selection when it is a single line-like object. */
  private selectionLineLength(objs: FabricObject[]): number | undefined {
    if (objs.length !== 1) return undefined;
    const obj = objs[0];
    const isLine = obj instanceof Line || (obj as FabricObject & { isMeasure?: boolean }).isMeasure;
    if (!isLine) return undefined;
    const scale = obj.getTotalObjectScaling();
    return (obj.width || 0) * ((Math.abs(scale.x) + Math.abs(scale.y)) / 2);
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
    const width = this.hairlineWidth();

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
    const validLayer = (obj: FabricObject): void => {
      const id = (obj as FabricObject & { layerId?: string }).layerId;
      if (id && !layerIds.has(id)) {
        (obj as FabricObject & { layerId?: string }).layerId = this.activeLayer().id;
      }
    };
    for (const obj of this.canvas.getObjects()) {
      validLayer(obj);
      if (obj instanceof Group) obj.getObjects().forEach(validLayer);
    }
    this.forEachStyledObject((obj) => this.styleObject(obj, true));
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
    // A multi-object ActiveSelection carries the real rotation of the group.
    const active = this.canvas.getActiveObject();
    store.setState({
      selection: {
        count: objs.length,
        x: b.left,
        y: b.top,
        width: b.width,
        height: b.height,
        angle: single ? single.angle ?? 0 : active?.angle ?? 0,
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
        cutPriority: Number((objs[0] as FabricObject & { cutPriority?: number }).cutPriority ?? 0),
      },
    });
    if (store.getState().tool === 'node') this.rebuildNodeHandles();
  }

  // -------------------------------------------------------------------------
  // Node editing
  //
  // The editable model lives in `nodes.ts` (canonical M/L/C/Z + typed handles).
  // The controller only mirrors it on screen: one white circle per anchor, one
  // small square per handle, and every interaction rewrites the whole path.
  // -------------------------------------------------------------------------

  private isNodeHandle(obj: FabricObject | null): boolean {
    return !!obj && (obj as FabricObject & { isNodeHandle?: boolean }).isNodeHandle === true;
  }

  private commandToScene(path: FabricPath, x: number, y: number): Point {
    const offset = path.pathOffset;
    const local = new Point(x - offset.x, y - offset.y);
    return util.transformPoint(local, path.calcTransformMatrix());
  }

  private sceneToPathPoint(path: FabricPath, p: { x: number; y: number }): Pt {
    const inverse = util.invertTransform(path.calcTransformMatrix());
    const local = util.transformPoint(new Point(p.x, p.y), inverse);
    return { x: local.x + path.pathOffset.x, y: local.y + path.pathOffset.y };
  }

  /** Current editable model of the path being edited, or `null`. */
  private nodeModel(): Subpath[] | null {
    const path = this.nodeTarget;
    if (!path) return null;
    return parsePath(path.path as unknown as (string | number)[][]);
  }

  /**
   * Write an edited model back to the path. `positionNodeHandles` is given the
   * same model so it never re-parses an intermediate path: rebuilding the
   * handles from a half-updated path (e.g. right after deleting nodes) would
   * fold those handles back into it.
   */
  private commitNodeModel(subpaths: Subpath[]): void {
    const path = this.nodeTarget;
    if (!path) return;
    path._setPath(buildPath(subpaths) as never, false);
    path.setCoords();
    this.positionNodeHandles(subpaths);
    this.canvas.requestRenderAll();
    this.afterChange();
  }

  private clearNodeHandles(): void {
    if (this.nodeHandles.length === 0) {
      this.nodeTarget = null;
      return;
    }
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    for (const h of this.nodeHandles) this.canvas.remove(h.circle);
    for (const c of this.nodeControls) this.canvas.remove(c.shape);
    this.nodeHandles = [];
    this.nodeControls = [];
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
    this.nodeSelected.clear();
    active.set({ hasControls: false, hasBorders: true });

    const previous = this.suppressHistory;
    this.suppressHistory = true;
    const model = this.nodeModel() ?? [];
    model.forEach((sub, subIndex) => {
      sub.nodes.forEach((node, nodeIndex) => {
        const circle = new Circle({
          radius: 4 / this.canvas.getZoom(),
          originX: 'center',
          originY: 'center',
          fill: '#f5f6f7',
          stroke: SELECTION_ACCENT,
          strokeWidth: HAIRLINE_PX / this.canvas.getZoom(),
          strokeUniform: true,
          hasControls: false,
          hasBorders: false,
          lockRotation: true,
          excludeFromExport: true,
          objectCaching: false,
        });
        const tagged = circle as Circle & { isNodeHandle?: boolean; subIndex?: number; nodeIndex?: number };
        tagged.isNodeHandle = true;
        tagged.subIndex = subIndex;
        tagged.nodeIndex = nodeIndex;
        circle.on('mousedown', (e) => {
          const evt = e.e as MouseEvent;
          this.nodeDragging = true;
          this.selectNode(subIndex, nodeIndex, evt.shiftKey);
        });
        circle.on('moving', () => this.moveAnchorHandle(circle));
        this.nodeHandles.push({ circle, subIndex, nodeIndex });
        this.canvas.add(circle);
      });
    });
    this.suppressHistory = previous;
    this.positionNodeHandles();
    this.setStatus(this.nodeStatusText());
  }

  /** Rebuild the overlay for `path` from an explicit model (after insert). */
  private rebuildNodeHandlesFor(path: FabricPath, model: Subpath[], selectKey: string): void {
    this.canvas.setActiveObject(path);
    this.nodeTarget = path;
    this.rebuildNodeHandles();
    this.nodeSelected.clear();
    this.nodeSelected.add(selectKey);
    this.commitNodeModel(model);
    this.setStatus(`Node added — ${this.nodeHandles.length} node(s)`);
  }

  private nodeStatusText(): string {
    const count = this.nodeHandles.length;
    const selected = this.nodeSelected.size;
    const extra = selected > 0 ? ` — ${selected} selected` : '';
    return `Node editing — ${count} node(s)${extra}. Drag to reshape, double-click a segment to add, Del removes.`;
  }

  private selectNode(subIndex: number, nodeIndex: number, additive: boolean): void {
    const key = `${subIndex}:${nodeIndex}`;
    if (!additive) this.nodeSelected.clear();
    if (additive && this.nodeSelected.has(key)) this.nodeSelected.delete(key);
    else this.nodeSelected.add(key);
    this.positionNodeHandles();
    this.setStatus(this.nodeStatusText());
  }

  /**
   * Recompute the on-screen position of every anchor and handle. The path is
   * re-parsed instead of using the cached `commandIndex` because inserting or
   * deleting a node renumbers everything.
   */
  private positionNodeHandles(modelOverride?: Subpath[]): void {
    const path = this.nodeTarget;
    if (!path) return;
    const zoom = this.canvas.getZoom();
    const model = modelOverride ?? this.nodeModel() ?? [];
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    for (const handle of this.nodeHandles) {
      const node = model[handle.subIndex]?.nodes[handle.nodeIndex];
      if (!node) continue;
      const scene = this.commandToScene(path, node.anchor.x, node.anchor.y);
      const selected = this.nodeSelected.has(`${handle.subIndex}:${handle.nodeIndex}`);
      handle.circle.set({
        left: scene.x,
        top: scene.y,
        radius: 4 / zoom,
        strokeWidth: HAIRLINE_PX / zoom,
        fill: selected ? SELECTION_ACCENT : '#f5f6f7',
      });
      handle.circle.setCoords();
    }
    this.rebuildNodeControls(model, zoom);
    this.suppressHistory = previous;
  }

  /** Small squares on the Bezier handles, plus the guideline to the anchor. */
  private rebuildNodeControls(model: Subpath[], zoom: number): void {
    const path = this.nodeTarget;
    if (!path) return;
    for (const control of this.nodeControls) this.canvas.remove(control.shape);
    this.nodeControls = [];
    model.forEach((sub, subIndex) => {
      sub.nodes.forEach((node, nodeIndex) => {
        const sides: ('in' | 'out')[] = [];
        if (node.handleIn) sides.push('in');
        if (node.handleOut) sides.push('out');
        const anchor = this.commandToScene(path, node.anchor.x, node.anchor.y);
        for (const side of sides) {
          const point = side === 'in' ? node.handleIn! : node.handleOut!;
          const scene = this.commandToScene(path, point.x, point.y);
          const guide = new Line([anchor.x, anchor.y, scene.x, scene.y], {
            stroke: SELECTION_ACCENT,
            strokeWidth: HAIRLINE_PX / zoom,
            strokeUniform: true,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            objectCaching: false,
            opacity: 0.75,
          });
          (guide as Line & { isAuxiliary?: boolean }).isAuxiliary = true;
          this.canvas.add(guide);
          const square = new Rect({
            left: scene.x,
            top: scene.y,
            width: 6 / zoom,
            height: 6 / zoom,
            originX: 'center',
            originY: 'center',
            fill: '#2b2f36',
            stroke: SELECTION_ACCENT,
            strokeWidth: HAIRLINE_PX / zoom,
            strokeUniform: true,
            hasControls: false,
            hasBorders: false,
            lockRotation: true,
            excludeFromExport: true,
            objectCaching: false,
          });
          const tagged = square as Rect & { isNodeControl?: boolean; subIndex?: number; nodeIndex?: number; side?: 'in' | 'out' };
          tagged.isNodeControl = true;
          tagged.subIndex = subIndex;
          tagged.nodeIndex = nodeIndex;
          tagged.side = side;
          square.on('mousedown', () => {
            this.nodeDragging = true;
          });
          square.on('moving', () => this.moveNodeControl(square, side, subIndex, nodeIndex));
          this.canvas.add(square);
          this.nodeControls.push({ shape: square, guide });
        }
      });
    });
  }

  private moveAnchorHandle(circle: Circle): void {
    if (!this.nodeTarget) return;
    const tagged = circle as Circle & { subIndex?: number; nodeIndex?: number };
    if (tagged.subIndex === undefined || tagged.nodeIndex === undefined) return;
    const model = this.nodeModel();
    if (!model) return;
    // Snap the anchor to its own path (so it merges with a vertex), to other
    // objects and to the grid.
    const raw = { x: circle.left ?? 0, y: circle.top ?? 0 };
    const snapped = this.snapTargetFor(
      new Point(raw.x, raw.y),
      'both',
      new Set(this.canvas.getObjects().filter((o) => o !== this.nodeTarget && !this.isNodeHandle(o) && !this.isAuxiliaryObject(o)).map((o) => this.objectId(o))),
    );
    const scenePoint = snapped ?? new Point(raw.x, raw.y);
    const local = this.sceneToPathPoint(this.nodeTarget, { x: scenePoint.x, y: scenePoint.y });
    const next = moveAnchor(model, tagged.subIndex, tagged.nodeIndex, local);
    this.commitNodeModel(next);
  }

  private moveNodeControl(shape: Rect, side: 'in' | 'out', subIndex: number, nodeIndex: number): void {
    const path = this.nodeTarget;
    if (!path) return;
    const model = this.nodeModel();
    if (!model) return;
    // Alt (or the node being a corner) keeps the handles independent.
    const independent = (window.event as MouseEvent | undefined)?.altKey === true;
    const working = independent
      ? model.map((sub, si) =>
          si === subIndex
            ? { ...sub, nodes: sub.nodes.map((n, ni) => (ni === nodeIndex ? { ...n, type: 'corner' as const } : n)) }
            : sub,
        )
      : model;
    const local = this.sceneToPathPoint(path, { x: shape.left ?? 0, y: shape.top ?? 0 });
    const next = moveHandle(working, subIndex, nodeIndex, side, local);
    this.commitNodeModel(next);
  }

  /** Double-click on a path segment inserts a node at the clicked position. */
  private insertNodeAt(path: FabricPath, scenePoint: Point): boolean {
    const model = parsePath(path.path as unknown as (string | number)[][]);
    const local = this.sceneToPathPoint(path, { x: scenePoint.x, y: scenePoint.y });
    const best: { subIndex: number; nodeIndex: number; t: number; distance: number } | null = model.reduce(
      (found, sub, subIndex) => {
        const hit = nearestOnSubpath(sub, local, 24);
        if (!hit) return found;
        if (found && found.distance <= hit.distance) return found;
        return { subIndex, nodeIndex: hit.nodeIndex, t: hit.t, distance: hit.distance };
      },
      null as { subIndex: number; nodeIndex: number; t: number; distance: number } | null,
    );
    if (!best) return false;
    this.nodeTarget = path;
    const result = insertNode(model, best.subIndex, best.nodeIndex, best.t);
    if (result.insertedIndex < 0) return false;
    // Drop the current overlay and rebuild it from the edited model.
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    for (const h of this.nodeHandles) this.canvas.remove(h.circle);
    for (const control of this.nodeControls) this.canvas.remove(control.shape);
    this.nodeHandles = [];
    this.nodeControls = [];
    this.suppressHistory = previous;
    this.nodeTarget = null;
    this.rebuildNodeHandlesFor(path, result.subpaths, `${best.subIndex}:${result.insertedIndex}`);
    return true;
  }

  /** Delete the selected nodes (or the whole path when none is selected). */
  deleteSelectedNodes(): boolean {
    if (store.getState().tool !== 'node' || !this.nodeTarget) return false;
    const keys = [...this.nodeSelected].map((k) => k.split(':').map(Number) as [number, number]);
    if (keys.length === 0) return false;
    const model = this.nodeModel();
    if (!model) return false;
    const next = removeNodes(
      model,
      keys.map(([subIndex, nodeIndex]) => ({ subIndex, nodeIndex })),
    );
    this.nodeSelected.clear();
    this.commitNodeModel(next);
    this.rebuildNodeHandles();
    this.setStatus(`Nodes deleted — ${this.nodeHandles.length} left`);
    return true;
  }

  /** Context-menu actions on the selected node. */
  setSelectedNodeType(type: NodeType): void {
    if (store.getState().tool !== 'node' || !this.nodeTarget) return;
    const [key] = [...this.nodeSelected];
    if (!key) return;
    const [subIndex, nodeIndex] = key.split(':').map(Number);
    const model = this.nodeModel();
    if (!model) return;
    this.commitNodeModel(setNodeType(model, subIndex, nodeIndex, type));
    this.setStatus(`Node is now ${type}`);
  }

  /** Convert the segment that starts at the selected node between line/curve. */
  toggleSelectedSegment(): void {
    if (store.getState().tool !== 'node' || !this.nodeTarget) return;
    const [key] = [...this.nodeSelected];
    if (!key) return;
    const [subIndex, nodeIndex] = key.split(':').map(Number);
    const model = this.nodeModel();
    if (!model) return;
    const curved = model[subIndex] && isCurvedSegment(model[subIndex], nodeIndex);
    this.commitNodeModel(toggleSegmentType(model, subIndex, nodeIndex));
    this.setStatus(curved ? 'Segment converted to line' : 'Segment converted to curve');
  }

  selectAllNodes(): void {
    if (store.getState().tool !== 'node' || !this.nodeTarget) return;
    this.nodeSelected.clear();
    this.nodeHandles.forEach((h) => this.nodeSelected.add(`${h.subIndex}:${h.nodeIndex}`));
    this.positionNodeHandles();
    this.setStatus(this.nodeStatusText());
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
    this.history.push(this.currentSnapshot);
    this.currentSnapshot = snap;
    store.setHistoryState(this.history.canUndo, false);
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
    const prev = this.history.undo(this.currentSnapshot);
    if (prev === null) return;
    this.currentSnapshot = prev;
    void this.loadSnapshot(prev).then(() => {
      store.setHistoryState(this.history.canUndo, this.history.canRedo);
      store.markDirty(true);
      this.setStatus('Undo');
    });
  }

  redo(): void {
    const next = this.history.redo(this.currentSnapshot);
    if (next === null) return;
    this.currentSnapshot = next;
    void this.loadSnapshot(next).then(() => {
      store.setHistoryState(this.history.canUndo, this.history.canRedo);
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

  /** Current document, exactly as it would be written to `.obrn`. */
  snapshotDocument(): OpenBurnDocument {
    const s = store.getState();
    return buildDocument({
      name: s.doc.meta.name,
      units: s.doc.units,
      bed: s.doc.bed,
      layers: s.doc.layers,
      canvas: this.canvas.toObject(['layerId']),
      pages: s.doc.pages,
      createdAt: s.doc.meta.createdAt,
    });
  }

  getScenePointFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const point = this.canvas.getScenePoint({ clientX, clientY } as MouseEvent);
    return { x: point.x, y: point.y };
  }

  /** Re-open a project from a known path (recent files, command line, drop). */
  async openPath(filePath: string): Promise<void> {
    const api = window.openburn;
    if (!api) return;
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    try {
      const text = await api.readFile(filePath);
      if (/\.(lbrn|lbrn2)$/i.test(name)) {
        const result = await parseLightBurn(text);
        await this.applyLightBurnImport(result, baseName(name));
        await addRecentFile(filePath);
        return;
      }
      const doc = parseDocument(text);
      // The window title follows the file name, like LightBurn.
      doc.meta = { ...doc.meta, name };
      // Legacy .ovbrn files are read-only: save as .obrn on the next Ctrl+S.
      const legacy = /\.ovbrn$/i.test(name);
      await this.applyDocument(doc, legacy ? null : filePath);
      this.setStatus(
        legacy
          ? `Opened legacy ${name} — use Save As to convert it to .obrn`
          : `Opened ${name}`,
      );
      if (!legacy) await addRecentFile(filePath);
    } catch (err) {
      this.setStatus(`Open failed: ${(err as Error).message}`);
    }
  }

  /**
   * Import files dropped onto the canvas. Projects replace the document;
   * artwork is added to the active layer at the drop position.
   */
  async dropFiles(files: DroppedFile[], at?: { x: number; y: number }): Promise<void> {
    let placed = false;
    for (const file of files) {
      const kind = dropKindForFile(file.name);
      try {
        if (kind === 'project' || kind === 'lightburn') {
          if (file.path) {
            await this.openPath(file.path);
            continue;
          }
          if (!file.text) continue;
          if (kind === 'lightburn') {
            const result = await parseLightBurn(file.text);
            await this.applyLightBurnImport(result, baseName(file.name));
          } else {
            await this.applyDocument(parseDocument(file.text), null);
          }
          continue;
        }

        if (kind === 'svg') {
          const text = await this.readDroppedText(file);
          if (text) await this.importSvg(text, placed ? undefined : at);
          placed = true;
          continue;
        }

        if (kind === 'dxf') {
          const text = await this.readDroppedText(file);
          if (text) this.importDxf(text, placed ? undefined : at);
          placed = true;
          continue;
        }

        if (kind === 'image') {
          const dataUrl = await this.readDroppedImage(file);
          if (dataUrl) await this.importImage(dataUrl, placed ? undefined : at);
          placed = true;
          continue;
        }

        this.setStatus(`Unsupported file type: ${file.name}`);
      } catch (err) {
        this.setStatus(`Could not open ${file.name}: ${(err as Error).message}`);
      }
    }
  }

  /** Restore the autosaved draft after a crash. */
  async applyRecoveredDocument(doc: unknown, filePath: string | null): Promise<boolean> {
    try {
      const parsed = parseDocument(JSON.stringify(doc));
      await this.applyDocument(parsed, filePath);
      store.markDirty(true);
      this.setStatus('Recovered unsaved work');
      return true;
    } catch (err) {
      this.setStatus(`Recovery failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async readDroppedText(file: DroppedFile): Promise<string | null> {
    if (file.text !== undefined) return file.text;
    if (file.path && window.openburn?.readFile) return window.openburn.readFile(file.path);
    return null;
  }

  private async readDroppedImage(file: DroppedFile): Promise<string | null> {
    if (file.dataUrl) return file.dataUrl;
    if (!file.path || !window.openburn?.readBinary) return null;
    const bin = await window.openburn.readBinary(file.path);
    return `data:${mimeForFile(file.name)};base64,${bin.data}`;
  }

  private async applyDocument(
    doc: ReturnType<typeof parseDocument>,
    filePath: string | null,
  ): Promise<void> {
    this.cancelTransformMode();
    this.suppressHistory = true;
    try {
      store.replaceDocument(doc, filePath);
      await this.canvas.loadFromJSON(doc.canvas as Record<string, unknown>);
      this.applyLayerStyles();
      this.currentSnapshot = this.snapshot();
      this.history.clear();
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
    if (!file) return;
    if (file.path) {
      await this.openPath(file.path);
      return;
    }
    if (!file.text) return;
    // Browser fallback: no absolute path, so the file cannot become "recent".
    try {
      if (/\.(lbrn|lbrn2)$/i.test(file.name)) {
        const result = await parseLightBurn(file.text);
        await this.applyLightBurnImport(result, baseName(file.name));
        return;
      }
      const doc = parseDocument(file.text);
      doc.meta = { ...doc.meta, name: file.name };
      const legacyProject = /\.ovbrn$/i.test(file.name);
      await this.applyDocument(doc, null);
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
      if (file.path) await addRecentFile(file.path);
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
      this.history.clear();
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
    const doc = this.snapshotDocument();
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
    await addRecentFile(path);
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

  private async importSvg(text: string, at?: { x: number; y: number }): Promise<void> {
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
    this.placeImportedAt([target], at);
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

  private importDxf(text: string, at?: { x: number; y: number }): void {
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
      this.placeImportedAt(objects, at);
      first.setCoords();
      this.canvas.setActiveObject(first);
      this.zoomToFitSelection();
    }
    this.afterChange();
    this.syncSelection();
    this.setStatus('DXF imported');
  }

  private async importImage(dataUrl: string, at?: { x: number; y: number }): Promise<void> {
    const img = await FabricImage.fromURL(dataUrl);
    const bed = store.getState().doc.bed;
    const maxW = bed.width * 0.8;
    const maxH = bed.height * 0.8;
    const scale = Math.min(1, maxW / (img.width || 1), maxH / (img.height || 1));
    img.set({
      left: at ? Math.max(0, at.x) : 10,
      top: at ? Math.max(0, at.y) : 10,
      scaleX: scale,
      scaleY: scale,
      objectCaching: false,
    });
    // Like LightBurn, images belong on an Image-mode layer; otherwise the job
    // skips them as "image in line mode" and they never reach the preview.
    const layer = this.ensureImageLayer();
    this.assignLayerDeep(img, layer.id);
    this.canvas.add(img);
    img.setCoords();
    this.canvas.setActiveObject(img);
    this.zoomToFitSelection();
    this.afterChange();
    this.syncSelection();
    this.setStatus(`Image imported on ${layer.name}`);
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

  /** Move a group of freshly imported objects so its top-left sits at `at`. */
  private placeImportedAt(objects: FabricObject[], at?: { x: number; y: number }): void {
    if (!at || objects.length === 0) return;
    const boxes = objects.map((obj) => obj.getBoundingRect());
    const minLeft = Math.min(...boxes.map((b) => b.left));
    const minTop = Math.min(...boxes.map((b) => b.top));
    const dx = at.x - minLeft;
    const dy = at.y - minTop;
    for (const obj of objects) {
      obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
      obj.setCoords();
    }
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
    // On-screen strokes scale with zoom; normalise them to a fixed hairline so
    // exported artwork keeps thin contours when opened elsewhere.
    const restore = this.setExportStrokeWidth();
    let svg: string;
    try {
      svg = applySvgPhysicalSize(this.canvas.toSVG());
    } finally {
      restore();
    }
    const name = (store.getState().doc.meta.name || 'openburn').replace(/\s+/g, '_');
    const ok = await saveTextFile(`${name}.svg`, svg, 'svg', 'image/svg+xml', [
      { name: 'SVG', extensions: ['svg'] },
    ]);
    if (ok) this.setStatus('Exported SVG');
  }

  private setExportStrokeWidth(): () => void {
    const changed: Array<{ obj: FabricObject; width: number }> = [];
    this.forEachStyledObject((obj) => {
      if (this.isText(obj) || obj.type === 'image') return;
      changed.push({ obj, width: obj.strokeWidth ?? 0 });
      obj.set({ strokeWidth: EXPORT_STROKE_MM });
    });
    return () => changed.forEach(({ obj, width }) => obj.set({ strokeWidth: width }));
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

  /**
   * LightBurn-style paste: use the internal clipboard when it has content,
   * otherwise fall back to the system clipboard. Shared by Ctrl+V and every
   * "Paste" entry in the menus, so they all behave the same.
   */
  async pasteSmart(offset = 10): Promise<void> {
    if (this.clipboard.length > 0) {
      await this.pasteClipboard(offset);
      return;
    }
    await this.pasteFromSystem();
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
    await this.pasteSmart(0);
  }

  duplicateSelection(): void {
    this.copySelection();
    void this.pasteClipboard();
  }

  selectAll(): void {
    const objs = this.canvas.getObjects();
    this.reselect(objs);
  }

  /** Ctrl+Shift+I — select everything that is not currently selected. */
  invertSelection(): void {
    const selected = new Set(this.canvas.getActiveObjects());
    const inverted = this.canvas
      .getObjects()
      .filter((o) => !this.isNodeHandle(o) && !selected.has(o));
    if (inverted.length === 0) {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
      this.syncSelection();
      this.setStatus('Inverted selection — nothing else to select');
      return;
    }
    this.reselect(inverted);
    this.setStatus(`Inverted selection — ${inverted.length} object(s)`);
  }

  /** Alt+D — remove objects whose geometry and position are identical. */
  deleteDuplicates(): void {
    const seen = new Set<string>();
    const duplicates: FabricObject[] = [];
    for (const obj of this.canvas.getObjects()) {
      if (this.isNodeHandle(obj)) continue;
      const fingerprint = this.objectFingerprint(obj);
      if (seen.has(fingerprint)) duplicates.push(obj);
      else seen.add(fingerprint);
    }

    if (duplicates.length === 0) {
      this.setStatus('No duplicates found');
      return;
    }

    this.canvas.discardActiveObject();
    duplicates.forEach((o) => this.canvas.remove(o));
    this.canvas.requestRenderAll();
    this.afterChange();
    this.syncSelection();
    this.setStatus(`Removed ${duplicates.length} duplicate(s)`);
  }

  private objectFingerprint(obj: FabricObject): string {
    const r = (value: number | undefined): string =>
      (Math.round((value ?? 0) * 1000) / 1000).toFixed(3);
    const any = obj as FabricObject & Record<string, unknown>;
    const parts: unknown[] = [
      obj.type,
      r(obj.left),
      r(obj.top),
      r(obj.width),
      r(obj.height),
      r(obj.scaleX),
      r(obj.scaleY),
      r(obj.angle),
      r(obj.skewX),
      r(obj.skewY),
      obj.flipX ? 1 : 0,
      obj.flipY ? 1 : 0,
    ];

    if (obj instanceof FabricPath) parts.push(any.pathData ?? JSON.stringify(any.path));
    if (obj instanceof Group) {
      parts.push(obj.getObjects().map((child) => this.objectFingerprint(child)).join(';'));
    }
    if (obj instanceof Line) parts.push(r(any.x1 as number), r(any.y1 as number), r(any.x2 as number), r(any.y2 as number));
    if (obj instanceof Polygon) parts.push(JSON.stringify(any.points));
    if (obj instanceof Ellipse) parts.push(r(any.rx as number), r(any.ry as number));
    if (obj instanceof Rect) parts.push(r(any.rx as number), r(any.ry as number));
    if (this.isText(obj))
      parts.push(
        any.text,
        r(any.fontSize as number),
        any.fontFamily,
        any.fontWeight ?? '',
        any.fontStyle ?? '',
        any.textAlign ?? '',
        r(any.charSpacing as number),
        r(any.lineHeight as number),
      );
    if (obj.type === 'image') parts.push(any.src ?? '', r(any.cropX as number), r(any.cropY as number));
    parts.push(obj.fill ?? '', obj.stroke ?? '');

    return parts.map((p) => String(p)).join('|');
  }

  // -------------------------------------------------------------------------
  // Interactive transform tools (mirror line, two-point rotate)
  // -------------------------------------------------------------------------

  private beginTransformMode(kind: 'mirror' | 'rotate2'): void {
    const targets = this.canvas.getActiveObjects().filter((o) => !this.isNodeHandle(o));
    if (targets.length === 0) {
      this.setStatus('Select objects first');
      return;
    }
    this.cancelTransformMode();
    this.canvas.selection = false;
    this.canvas.skipTargetFind = true;
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.requestRenderAll();

    if (kind === 'mirror') {
      this.mirrorMode = { start: null, end: null, targets };
      this.setStatus('Mirror: click two points for the axis, Enter to apply, Esc to cancel');
    } else {
      this.rotate2Mode = { base: null, end: null, targets };
      this.setStatus('Rotate: click two points, Enter to apply, Esc to cancel');
    }
  }

  private makeGuide(start: Point): Line {
    const guide = new Line([start.x, start.y, start.x, start.y], {
      stroke: SELECTION_ACCENT,
      strokeWidth: this.hairlineWidth(),
      strokeUniform: true,
      strokeDashArray: [6, 4],
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    });
    (guide as FabricObject & { isGuide?: boolean }).isGuide = true;
    this.canvas.add(guide);
    return guide;
  }

  private handleTransformClick(point: Point): void {
    if (this.mirrorMode) {
      const mode = this.mirrorMode;
      if (!mode.start) {
        mode.start = point;
        mode.guide = this.makeGuide(point);
        this.setStatus('Mirror: click the second point of the axis');
      } else {
        mode.end = point;
        mode.guide?.set({ x2: point.x, y2: point.y });
        this.canvas.requestRenderAll();
        this.setStatus('Mirror: press Enter to apply, Esc to cancel');
      }
      return;
    }
    if (this.rotate2Mode) {
      const mode = this.rotate2Mode;
      if (!mode.base) {
        mode.base = point;
        mode.guide = this.makeGuide(point);
        this.setStatus('Rotate: click the second point');
      } else {
        mode.end = point;
        mode.guide?.set({ x2: point.x, y2: point.y });
        this.canvas.requestRenderAll();
        const deg = this.twoPointAngle(mode.base, point);
        this.setStatus(`Rotate: ${deg.toFixed(1)}° — press Enter to apply, Esc to cancel`);
      }
    }
  }

  private handleTransformMove(point: Point): void {
    const guide = this.mirrorMode?.guide ?? this.rotate2Mode?.guide;
    const started = this.mirrorMode?.start ?? this.rotate2Mode?.base;
    if (!guide || !started) return;
    const hasEnd = this.mirrorMode ? this.mirrorMode.end : this.rotate2Mode?.end;
    if (hasEnd) return;
    guide.set({ x2: point.x, y2: point.y });
    this.canvas.requestRenderAll();
  }

  private twoPointAngle(a: Point, b: Point): number {
    // Absolute X axis reference, like LightBurn's two-point rotate.
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }

  private applyTransformMode(): void {
    if (this.mirrorMode?.start && this.mirrorMode.end) {
      this.applyMirror();
      return;
    }
    if (this.rotate2Mode?.base && this.rotate2Mode.end) {
      const degrees = this.twoPointAngle(this.rotate2Mode.base, this.rotate2Mode.end);
      const targets = this.rotate2Mode.targets;
      this.cancelTransformMode();
      this.rotateObjects(targets, degrees);
      this.setStatus(`Rotated ${degrees.toFixed(1)}°`);
      return;
    }
    this.setStatus('Click two points first');
  }

  private applyMirror(): void {
    const mode = this.mirrorMode;
    if (!mode?.start || !mode.end) return;
    const { start, end } = mode;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.hypot(dx, dy) < 0.001) {
      this.setStatus('The mirror axis needs two different points');
      return;
    }
    const targets = mode.targets;
    const theta = Math.atan2(dy, dx);
    const twiceDeg = (theta * 2 * 180) / Math.PI;

    this.cancelTransformMode();
    this.canvas.discardActiveObject();

    for (const obj of targets) {
      const center = obj.getCenterPoint();
      const mirrored = reflectPoint(center, start, end);
      obj.set({
        angle: twiceDeg - (obj.angle ?? 0),
        scaleY: -(obj.scaleY ?? 1),
      });
      obj.setCoords();
      const current = obj.getCenterPoint();
      obj.set({
        left: (obj.left ?? 0) + (mirrored.x - current.x),
        top: (obj.top ?? 0) + (mirrored.y - current.y),
      });
      obj.setCoords();
    }

    this.reselect(targets);
    this.afterChange();
    this.setStatus('Mirrored across line');
  }

  cancelTransformMode(): void {
    const guide = this.mirrorMode?.guide ?? this.rotate2Mode?.guide;
    if (guide) this.canvas.remove(guide);
    this.mirrorMode = null;
    this.rotate2Mode = null;
    this.canvas.selection = true;
    this.canvas.skipTargetFind = false;
    this.canvas.defaultCursor = 'default';
    this.canvas.requestRenderAll();
  }

  private rotateObjects(targets: FabricObject[], degrees: number): void {
    if (targets.length === 0) return;
    const bounds = this.selectionBounds(targets);
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    this.canvas.discardActiveObject();
    for (const obj of targets) {
      obj.set({ angle: (obj.angle ?? 0) + degrees });
      const dx = (obj.left ?? 0) - cx;
      const dy = (obj.top ?? 0) - cy;
      obj.set({ left: cx + dx * cos - dy * sin, top: cy + dx * sin + dy * cos });
      obj.setCoords();
    }
    this.reselect(targets);
    this.afterChange();
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

  mirrorAcrossLine(): void {
    this.beginTransformMode('mirror');
  }

  rotateByTwoPoints(): void {
    this.beginTransformMode('rotate2');
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
        strokeWidth: HAIRLINE_PX / this.canvas.getZoom(),
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
        strokeWidth: HAIRLINE_PX / this.canvas.getZoom(),
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

  setSelectionCutPriority(priority: number): void {
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) {
      this.setStatus('Select an object first');
      return;
    }
    for (const obj of objs) {
      (obj as FabricObject & { cutPriority?: number }).cutPriority = Number.isFinite(priority)
        ? Math.max(0, Math.round(priority))
        : 0;
    }
    this.syncSelection();
    this.afterChange();
    this.setStatus(`Cut order priority set to ${Math.round(priority)}`);
  }

  /** Select every object assigned to a layer (LightBurn "Select all on layer"). */
  selectLayerObjects(layerId: string): void {
    const matches = this.canvas
      .getObjects()
      .filter((o) => !this.isNodeHandle(o))
      .filter((o) => (o as FabricObject & { layerId?: string }).layerId === layerId);
    if (matches.length === 0) {
      this.setStatus('No objects on that layer');
      return;
    }
    this.reselect(matches);
    this.setStatus(`Selected ${matches.length} object(s)`);
  }

  /** Briefly flash the contents of a layer (LightBurn layer context menu). */
  flashLayer(layerId: string): void {
    const matches = this.canvas
      .getObjects()
      .filter((o) => (o as FabricObject & { layerId?: string }).layerId === layerId);
    if (matches.length === 0) return;
    const previous = matches.map((o) => o.opacity);
    matches.forEach((o) => o.set({ opacity: 1 }));
    this.canvas.requestRenderAll();
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      matches.forEach((o, i) => o.set({ opacity: ticks % 2 === 1 ? 0.15 : previous[i] ?? 1 }));
      this.canvas.requestRenderAll();
      if (ticks >= 4) {
        window.clearInterval(timer);
        matches.forEach((o, i) => o.set({ opacity: previous[i] ?? 1 }));
        this.canvas.requestRenderAll();
      }
    }, 140);
  }

  /** Copy the active layer's cut settings into an internal clipboard. */
  copyLayerSettings(layerId: string): void {
    const layer = store.getState().doc.layers.find((l) => l.id === layerId);
    if (!layer) return;
    this.layerSettingsClipboard = { ...layer.settings };
    this.setStatus(`Copied settings from ${layer.name}`);
  }

  pasteLayerSettings(layerId: string): void {
    if (!this.layerSettingsClipboard) {
      this.setStatus('Copy a layer first');
      return;
    }
    store.updateCutSettings(layerId, { ...this.layerSettingsClipboard });
    this.setStatus('Pasted layer settings');
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
    const before = this.selectionBounds(objs);
    if (before.width <= 0 || before.height <= 0) return;
    const lockAspect = store.getState().lockAspect;

    if (objs.length === 1) {
      const obj = objs[0];
      this.withSelectionObjects(() => {
        applyNumericSingle(
          {
            get angle() {
              return obj.angle ?? 0;
            },
            setAngle: (a) => obj.set({ angle: a }),
            getScaledSize: () => {
              const dim = obj._getTransformedDimensions({
                scaleX: 1,
                scaleY: 1,
                strokeWidth: 0,
              });
              return { x: Math.max(1e-6, dim.x), y: Math.max(1e-6, dim.y) };
            },
            getScale: () => ({ x: obj.scaleX || 1, y: obj.scaleY || 1 }),
            setScale: (x, y) => obj.set({ scaleX: x, scaleY: y }),
            getBounds: () => {
              obj.setCoords();
              const r = obj.getBoundingRect();
              return { left: r.left, top: r.top, width: r.width, height: r.height };
            },
            move: (dx, dy) => obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy }),
            syncCoords: () => obj.setCoords(),
          },
          patch,
          { lockAspect },
        );
      });
    } else {
      const resolved = resolveSizePatch(before, patch, lockAspect);
      this.withSelectionObjects(() => this.applyNumericGroup(objs, before, resolved));
    }
  }

  /** Scale a multi-object selection from its top-left corner and rotate it. */
  private applyNumericGroup(
    objs: FabricObject[],
    box: { left: number; top: number; width: number; height: number },
    patch: Partial<{ x: number; y: number; width: number; height: number; angle: number }>,
  ): void {
    const active = this.canvas.getActiveObject();
    const currentAngle = active?.angle ?? 0;
    const dx = patch.x !== undefined ? patch.x - box.left : 0;
    const dy = patch.y !== undefined ? patch.y - box.top : 0;
    const fx = patch.width !== undefined && box.width > 0 ? patch.width / box.width : 1;
    const fy = patch.height !== undefined && box.height > 0 ? patch.height / box.height : 1;
    const deltaAngle = patch.angle !== undefined ? patch.angle - currentAngle : 0;

    if (dx !== 0 || dy !== 0) {
      objs.forEach((o) => o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy }));
    }
    if (fx !== 1 || fy !== 1) {
      objs.forEach((o) => {
        const r = o.getBoundingRect();
        o.set({
          left: box.left + dx + (r.left - box.left) * fx,
          top: box.top + dy + (r.top - box.top) * fy,
          scaleX: (o.scaleX ?? 1) * fx,
          scaleY: (o.scaleY ?? 1) * fy,
        });
      });
    }
    if (deltaAngle !== 0) {
      const cx = box.left + dx + box.width / 2;
      const cy = box.top + dy + box.height / 2;
      const rad = (deltaAngle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      objs.forEach((o) => {
        o.set({ angle: (o.angle ?? 0) + deltaAngle });
        const ox = (o.left ?? 0) - cx;
        const oy = (o.top ?? 0) - cy;
        o.set({ left: cx + ox * cos - oy * sin, top: cy + ox * sin + oy * cos });
      });
    }
    objs.forEach((o) => o.setCoords());
  }

  applyTextStyle(patch: {
    fontSize?: number;
    charSpacing?: number;
    lineHeight?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    textAlign?: TextAlign;
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
        if (patch.textAlign !== undefined) next.textAlign = patch.textAlign;
        t.set(next as never);
        touched += 1;
      }
    }
    if (touched > 0) {
      // Group children need their parent box recomputed after a line gets
      // narrower or wider.
      for (const o of objs) {
        if (o instanceof Group) o.setCoords();
      }
      this.canvas.requestRenderAll();
      this.afterChange();
      this.setStatus(patch.textAlign ? `Text aligned ${patch.textAlign}` : 'Text updated');
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
          strokeWidth: HAIRLINE_PX / zoom,
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
        strokeWidth: HAIRLINE_PX / zoom,
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
      optimization: { ...s.optimization, enabled: s.optimization.enabled && s.device.optimizeTravel !== false },
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

  /**
   * Pick the layer that raster images should live on, mirroring LightBurn's
   * "Image" layer mode: reuse the active layer when it is already an image
   * layer, otherwise reuse the first image layer, otherwise create one with the
   * usual C00/C01 palette naming so images are visible and cut immediately.
   */
  private ensureImageLayer(): LayerDef {
    const state = store.getState();
    const existing = findImageLayer(state.doc.layers, state.activeLayerId);
    if (existing) return existing;

    const created = store.addLayer();
    // New image layers burn white as "no power"; the palette default of
    // Min power 20 % would engrave the whole rectangle in grayscale mode.
    store.updateCutSettings(created.id, {
      mode: 'image',
      output: true,
      visible: true,
      minPower: 0,
    });
    return store.getState().doc.layers.find((l) => l.id === created.id) ?? created;
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
          strokeWidth: HAIRLINE_PX / zoom,
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
        strokeWidth: HAIRLINE_PX / zoom,
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
          strokeWidth: HAIRLINE_PX / zoom,
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
          strokeWidth: HAIRLINE_PX / zoom,
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
        strokeWidth: HAIRLINE_PX / zoom,
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
        if (options.mode === 'color' && options.separateColors) {
          const groups = await traceImageByColor(img, options);
          if (groups.length === 0) continue;
          for (const { color, object } of groups) {
            const colorLayer = this.ensureTraceLayer(color);
            this.assignLayerDeep(object, colorLayer.id);
            this.canvas.add(object);
            object.setCoords();
            created.push(object);
          }
        } else {
          const group = await traceImageObject(img, options);
          if (!group) continue;
          this.assignLayerDeep(group, layer.id);
          this.canvas.add(group);
          group.setCoords();
          created.push(group);
        }
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

  /** Find or create a layer named after a traced colour. */
  private ensureTraceLayer(color: string): LayerDef {
    const name = `Trace ${color.toUpperCase()}`;
    const existing = store.getState().doc.layers.find((l) => l.name === name);
    if (existing) return existing;

    const previous = store.getState().activeLayerId;
    const created = store.addLayer();
    store.updateLayer(created.id, { name, color });
    const current = store.getState().doc.layers.find((l) => l.id === created.id) ?? created;
    store.setState({ activeLayerId: previous });
    return current;
  }

  /**
   * Clip one selected image with the selected vector shape(s) (even-odd), then
   * replace it with the masked bitmap and consume the mask shape.
   */
  async applyMaskToImage(): Promise<void> {
    const objs = this.canvas.getActiveObjects().filter((o) => !this.isNodeHandle(o));
    const images = objs.filter((o): o is FabricImage => o instanceof FabricImage);
    const masks = objs.filter((o) => !(o instanceof FabricImage));
    if (images.length !== 1 || masks.length === 0) {
      this.setStatus('Select one image plus the shape to use as a mask');
      return;
    }

    const image = images[0];
    const contours = masks
      .flatMap((mask) => objectContours(mask))
      .filter((contour) => contour.closed && contour.points.length >= 3);
    if (contours.length === 0) {
      this.setStatus('The mask needs at least one closed shape');
      return;
    }

    const element = image.getElement() as
      | HTMLImageElement
      | HTMLCanvasElement
      | HTMLVideoElement
      | null;
    const naturalW =
      (element as HTMLImageElement)?.naturalWidth || (element as HTMLCanvasElement)?.width || 0;
    const naturalH =
      (element as HTMLImageElement)?.naturalHeight || (element as HTMLCanvasElement)?.height || 0;
    if (!element || !naturalW || !naturalH) {
      this.setStatus('The image has no bitmap data to mask');
      return;
    }

    const bounds = image.getBoundingRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const maxSide = 2048;
    const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(element as CanvasImageSource, 0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    const sx = width / bounds.width;
    const sy = height / bounds.height;
    for (const contour of contours) {
      contour.points.forEach((point, index) => {
        const x = (point.x - bounds.left) * sx;
        const y = (point.y - bounds.top) * sy;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'source-over';

    const dataUrl = canvas.toDataURL('image/png');
    const masked = await FabricImage.fromURL(dataUrl);
    const layerId =
      (image as FabricObject & { layerId?: string }).layerId ?? this.activeLayer().id;
    masked.set({
      left: bounds.left,
      top: bounds.top,
      scaleX: bounds.width / width,
      scaleY: bounds.height / height,
    });
    (masked as FabricObject & { imageAdjust?: ImageAdjust }).imageAdjust = (
      image as FabricObject & { imageAdjust?: ImageAdjust }
    ).imageAdjust;
    this.assignLayer(masked, layerId);
    masked.setCoords();

    this.canvas.discardActiveObject();
    this.canvas.remove(image);
    masks.forEach((mask) => this.canvas.remove(mask));
    this.canvas.add(masked);
    this.reselect([masked]);
    this.afterChange();
    this.setStatus(image.angle ? 'Masked image (rotation reset)' : 'Masked image');
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
        strokeWidth: HAIRLINE_PX / zoom,
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

  private onPointerButton = (e: MouseEvent): void => {
    if (e.button === 1) this.suppressPasteUntil = performance.now() + 500;
  };

  private onPaste = (e: ClipboardEvent): void => {
    if (performance.now() < this.suppressPasteUntil) {
      e.preventDefault();
      return;
    }
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

  /** Decode an Inkscape clipboard SVG (plain text, gzip, zlib or raw deflate). */
  private async decompressSvgBlob(blob: Blob): Promise<string> {
    // Some platforms hand over the SVG uncompressed under the compressed type.
    try {
      const plain = await blob.text();
      if (/<svg[\s>]/i.test(plain)) return plain;
    } catch {
      /* fall through to decompression */
    }
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
      // Plain-text fallback (some editors put the SVG source in text/plain).
      /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(payload.text ?? '') ? payload.text : null,
      // HTML fallback: only when the vector is effectively the whole payload.
      htmlHasProse ? null : htmlSvg,
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
    this.bg.setCursor({ x, y });
    // React consumers only need ~20 updates/second; the rulers are redrawn on
    // every move independently.
    if (this.lastCursorStoreX === x && this.lastCursorStoreY === y) return;
    this.lastCursorStoreX = x;
    this.lastCursorStoreY = y;
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

    // Interactive transform tools own the keyboard until confirmed/cancelled.
    if (this.mirrorMode || this.rotate2Mode) {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyTransformMode();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelTransformMode();
        this.setStatus('Cancelled');
        return;
      }
      return;
    }

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
      // On macOS Option+letter yields a special character in e.key, so prefer
      // the physical key code when available.
      const letter = /^Key([A-Z])$/.exec(e.code)?.[1].toLowerCase() ?? e.key.toLowerCase();
      switch (letter) {
        case 'b':
          e.preventDefault();
          this.breakApart();
          return;
        case 'v':
          e.preventDefault();
          void this.pasteInPlace();
          return;
        case 'd':
          e.preventDefault();
          this.deleteDuplicates();
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
        case 'm':
          // LightBurn: Mirror across line
          if (e.shiftKey) {
            e.preventDefault();
            this.beginTransformMode('mirror');
            return;
          }
          return;
        case '2':
          // LightBurn: Rotate by two points
          e.preventDefault();
          this.beginTransformMode('rotate2');
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
          if (e.shiftKey) {
            // Ctrl+Shift+V always reads the system clipboard.
            if (window.openburn?.readClipboard) {
              e.preventDefault();
              void this.pasteFromSystem();
            }
          } else if (this.clipboard.length > 0 || window.openburn?.readClipboard) {
            e.preventDefault();
            void this.pasteSmart();
          }
          // In the browser without internal content, let the paste event fire.
          return;
        case 'd':
          e.preventDefault();
          this.duplicateSelection();
          return;
        case 'a':
          e.preventDefault();
          // LightBurn: Ctrl+Shift+A = Frame Selection; in node mode Ctrl+A
          // selects every node of the path being edited.
          if (e.shiftKey) this.zoomToFitSelection();
          else if (store.getState().tool === 'node' && this.nodeTarget) this.selectAllNodes();
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
          void requestDiscardConfirmation().then((ok) => {
            if (ok) void this.openDocument();
          });
          return;
        case 'n':
          e.preventDefault();
          void requestDiscardConfirmation().then((ok) => {
            if (ok) this.newDocument();
          });
          return;
        case 'i':
          e.preventDefault();
          // LightBurn: Ctrl+Shift+I = Invert selection
          if (e.shiftKey) this.invertSelection();
          else void this.importFile();
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
      // Node mode deletes the selected nodes, never the whole path unless
      // nothing is selected (the old behaviour deleted the path by surprise).
      if (store.getState().tool === 'node' && this.deleteSelectedNodes()) return;
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

/** Reflect a scene point across the line through `a` and `b`. */
function reflectPoint(p: Point, a: Point, b: Point): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return { x: 2 * projX - p.x, y: 2 * projY - p.y };
}

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, '');
}

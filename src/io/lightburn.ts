import {
  FabricImage,
  FabricObject,
  Path as FabricPath,
  Textbox,
} from 'fabric';
import { PALETTE_COLORS, type CutSettings, type LayerDef } from '@/types/document';
import { objectContours } from '@/gcode/geometry';
import { textToScenePath } from '@/text/outline';

export type LightBurnFormat = 'lbrn' | 'lbrn2';

export interface LightBurnImportResult {
  layers: LayerDef[];
  objects: FabricObject[];
  warnings: string[];
  /** Scene-space bounds after normalisation (mm, Y down) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

type Mat = [number, number, number, number, number, number];

interface Cmd {
  type: 'M' | 'L' | 'C';
  points: [number, number][];
}

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const MARGIN = 10;

// ---------------------------------------------------------------------------
// Small XML helpers
// ---------------------------------------------------------------------------

function childElement(parent: Element, name: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === name) return child;
  }
  return null;
}

function childText(parent: Element, name: string): string | null {
  const el = childElement(parent, name);
  return el ? el.textContent ?? '' : null;
}

function childValue(parent: Element, name: string): string | null {
  const el = childElement(parent, name);
  return el ? el.getAttribute('Value') : null;
}

function num(value: string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function attrNum(el: Element, name: string, fallback = 0): number {
  return num(el.getAttribute(name), fallback);
}

function attrStr(el: Element, names: string[]): string | null {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value != null && value !== '') return value;
  }
  return null;
}

function boolAttr(el: Element, name: string, fallback = false): boolean {
  const value = el.getAttribute(name);
  if (value == null) return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function parseXForm(el: Element): Mat {
  const text = childText(el, 'XForm');
  if (!text) return [...IDENTITY] as Mat;
  const nums = text
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseFloat(n))
    .filter((n) => Number.isFinite(n));
  return nums.length === 6 ? (nums as Mat) : ([...IDENTITY] as Mat);
}

function compose(parent: Mat, local: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = parent;
  const [a2, b2, c2, d2, e2, f2] = local;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMat(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function fmt(n: number): string {
  const rounded = Math.round(n * 10000) / 10000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function commandsToPathData(cmds: Cmd[], matrix: Mat): string {
  const parts: string[] = [];
  const pt = (p: [number, number]) => {
    const mapped = applyMat(matrix, p[0], p[1]);
    // LightBurn is Y-up; the workspace is Y-down.
    return `${fmt(mapped.x)} ${fmt(-mapped.y)}`;
  };
  for (const cmd of cmds) {
    if (cmd.type === 'M') parts.push(`M${pt(cmd.points[0])}`);
    else if (cmd.type === 'L') parts.push(`L${pt(cmd.points[0])}`);
    else parts.push(`C${pt(cmd.points[0])} ${pt(cmd.points[1])} ${pt(cmd.points[2])}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Geometry builders (local coordinates, LightBurn Y-up)
// ---------------------------------------------------------------------------

function rectCommands(w: number, h: number, cr: number): Cmd[] {
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.max(0, Math.min(cr, halfW, halfH));
  if (r <= 0.0001) {
    const corners: [number, number][] = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ];
    return [
      { type: 'M', points: [corners[0]] },
      { type: 'L', points: [corners[1]] },
      { type: 'L', points: [corners[2]] },
      { type: 'L', points: [corners[3]] },
      { type: 'L', points: [corners[0]] },
    ];
  }

  const k = r * 0.5522847498;
  const x = halfW;
  const y = halfH;
  return [
    { type: 'M', points: [[-x + r, -y]] },
    { type: 'L', points: [[x - r, -y]] },
    { type: 'C', points: [[x - r + k, -y], [x, -y + r - k], [x, -y + r]] },
    { type: 'L', points: [[x, y - r]] },
    { type: 'C', points: [[x, y - r + k], [x - r + k, y], [x - r, y]] },
    { type: 'L', points: [[-x + r, y]] },
    { type: 'C', points: [[-x + r - k, y], [-x, y - r + k], [-x, y - r]] },
    { type: 'L', points: [[-x, -y + r]] },
    { type: 'C', points: [[-x, -y + r - k], [-x + r - k, -y], [-x + r, -y]] },
  ];
}

function ellipseCommands(rx: number, ry: number): Cmd[] {
  const kx = rx * 0.5522847498;
  const ky = ry * 0.5522847498;
  return [
    { type: 'M', points: [[rx, 0]] },
    { type: 'C', points: [[rx, ky], [kx, ry], [0, ry]] },
    { type: 'C', points: [[-kx, ry], [-rx, ky], [-rx, 0]] },
    { type: 'C', points: [[-rx, -ky], [-kx, -ry], [0, -ry]] },
    { type: 'C', points: [[kx, -ry], [rx, -ky], [rx, 0]] },
  ];
}

function polygonCommands(rx: number, ry: number, sides: number): Cmd[] {
  const n = Math.max(3, Math.min(64, Math.round(sides || 3)));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i * Math.PI * 2) / n;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return [
    { type: 'M', points: [pts[0]] },
    ...pts.slice(1).map((p) => ({ type: 'L' as const, points: [p] })),
    { type: 'L', points: [pts[0]] },
  ];
}

interface Vert {
  x: number;
  y: number;
  c0?: [number, number];
  c1?: [number, number];
}

interface Prim {
  type: 0 | 1;
  p0: number;
  p1: number;
}

function parseEncodedVerts(encoded: string): Vert[] {
  const verts: Vert[] = [];
  const parts = encoded.split('V');
  for (const part of parts) {
    const head = part.match(/^\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)/);
    if (!head) continue;
    const vert: Vert = { x: num(head[1]), y: num(head[2]) };
    const c0x = part.match(/c0x([-+0-9.eE]+)/);
    const c0y = part.match(/c0y([-+0-9.eE]+)/);
    const c1x = part.match(/c1x([-+0-9.eE]+)/);
    const c1y = part.match(/c1y([-+0-9.eE]+)/);
    if (c0x && c0y) vert.c0 = [num(c0x[1]), num(c0y[1])];
    if (c1x && c1y) vert.c1 = [num(c1x[1]), num(c1y[1])];
    verts.push(vert);
  }
  return verts;
}

function parseEncodedPrims(
  encoded: string,
  vertCount: number,
): { prims: Prim[]; closed: boolean | null } {
  const trimmed = encoded.trim();
  if (!/[LB]\s*\d/.test(trimmed)) {
    if (/Line/i.test(trimmed)) {
      const closed = /Closed/i.test(trimmed) || !/Open/i.test(trimmed);
      const count = closed ? vertCount : Math.max(0, vertCount - 1);
      const prims: Prim[] = [];
      for (let i = 0; i < count; i += 1) {
        prims.push({ type: 0, p0: i, p1: (i + 1) % vertCount });
      }
      return { prims, closed };
    }
    return { prims: [], closed: null };
  }

  const prims: Prim[] = [];
  const regex = /([LB])\s*(\d+)\s+(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    prims.push({ type: match[1] === 'B' ? 1 : 0, p0: Number(match[2]), p1: Number(match[3]) });
  }
  return { prims, closed: null };
}

function parseLegacyVerts(element: Element): Vert[] {
  const verts: Vert[] = [];
  for (const child of Array.from(element.children)) {
    if (child.tagName !== 'V') continue;
    const vert: Vert = { x: attrNum(child, 'vx'), y: attrNum(child, 'vy') };
    const c0x = child.getAttribute('c0x');
    const c0y = child.getAttribute('c0y');
    const c1x = child.getAttribute('c1x');
    const c1y = child.getAttribute('c1y');
    if (c0x != null && c0y != null) vert.c0 = [num(c0x), num(c0y)];
    if (c1x != null && c1y != null) vert.c1 = [num(c1x), num(c1y)];
    verts.push(vert);
  }
  return verts;
}

function parseLegacyPrims(element: Element): Prim[] {
  const prims: Prim[] = [];
  for (const child of Array.from(element.children)) {
    if (child.tagName !== 'P') continue;
    prims.push({
      type: /^B/i.test(child.getAttribute('T') ?? 'L') ? 1 : 0,
      p0: attrNum(child, 'p0'),
      p1: attrNum(child, 'p1'),
    });
  }
  return prims;
}

function vertsToCommands(verts: Vert[], prims: Prim[], closed: boolean): Cmd[] {
  const cmds: Cmd[] = [];
  const pointsOf = (v: Vert): [number, number] => [v.x, v.y];

  if (prims.length === 0) {
    if (verts.length === 0) return cmds;
    cmds.push({ type: 'M', points: [pointsOf(verts[0])] });
    for (let i = 1; i < verts.length; i += 1) cmds.push({ type: 'L', points: [pointsOf(verts[i])] });
    if (closed) cmds.push({ type: 'L', points: [pointsOf(verts[0])] });
    return cmds;
  }

  let current = -1;
  for (const prim of prims) {
    const a = verts[prim.p0];
    const b = verts[prim.p1];
    if (!a || !b) continue;
    if (current !== prim.p0) {
      cmds.push({ type: 'M', points: [pointsOf(a)] });
      current = prim.p0;
    }
    if (prim.type === 1) {
      const c0 = a.c0 ?? [a.x, a.y];
      const c1 = b.c1 ?? [b.x, b.y];
      cmds.push({ type: 'C', points: [c0, c1, pointsOf(b)] });
    } else {
      cmds.push({ type: 'L', points: [pointsOf(b)] });
    }
    current = prim.p1;
  }

  if (closed && current !== prims[0]?.p0) {
    const first = verts[prims[0]?.p0 ?? 0];
    if (first) cmds.push({ type: 'L', points: [pointsOf(first)] });
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function cutSettingsFromElement(el: Element, index: number): LayerDef {
  const rawType = (el.getAttribute('type') ?? 'Cut').toLowerCase();
  const mode = rawType === 'scan' ? 'fill' : rawType === 'image' ? 'image' : 'line';
  const speed = num(childValue(el, 'speed'), 20);
  const power = num(childValue(el, 'maxPower'), 50);
  const passes = Math.max(1, Math.round(num(childValue(el, 'numPasses'), 1)));
  const interval = Math.max(0.01, num(childValue(el, 'interval'), 0.1));
  const kerf = num(childValue(el, 'kerf'), 0);
  const scanOffset = num(childValue(el, 'scanOffset'), 0);
  const angle = num(childValue(el, 'angle'), 0);
  const crossHatch = num(childValue(el, 'crossHatch'), 0) !== 0;
  const name = childValue(el, 'name') || `C${String(index).padStart(2, '0')}`;
  const color = PALETTE_COLORS[index % PALETTE_COLORS.length];

  const settings: CutSettings = {
    mode,
    speed,
    power,
    passes,
    interval,
    offsetDistance: 0.2,
    overscan: 2.5,
    angle,
    crossHatch,
    kerf,
    scanOffset,
    dither: 'none',
    output: true,
    visible: true,
    airAssist: false,
  };

  return {
    id: `lb-${index}`,
    name,
    color,
    settings,
  };
}

async function importBitmap(el: Element, matrix: Mat, layerId: string): Promise<FabricImage | null> {
  const data = el.getAttribute('Data');
  if (!data) return null;
  const width = attrNum(el, 'W');
  const height = attrNum(el, 'H');
  if (width <= 0 || height <= 0) return null;
  const url = data.startsWith('data:') ? data : `data:image/png;base64,${data}`;
  let image: FabricImage;
  try {
    image = await FabricImage.fromURL(url);
  } catch {
    return null;
  }

  const angle = (-Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  const center = applyMat(matrix, 0, 0);
  const scaleX = width / (image.width || width);
  const scaleY = height / (image.height || height);
  image.set({
    originX: 'center',
    originY: 'center',
    left: center.x,
    top: -center.y,
    scaleX,
    scaleY,
    angle,
    objectCaching: false,
  });
  image.set('layerId', layerId);
  return image;
}

interface ParseContext {
  layers: LayerDef[];
  layerById: Map<string, LayerDef>;
  objects: FabricObject[];
  warnings: string[];
  defaultLayerId: string;
  templates: Map<string, { verts: Vert[]; prims: Prim[]; closed: boolean | null }>;
}

async function parseShapeElement(el: Element, parentMatrix: Mat, ctx: ParseContext): Promise<void> {
  const type = el.getAttribute('Type') ?? '';
  const cutIndex = Number.parseInt(el.getAttribute('CutIndex') ?? '0', 10) || 0;
  const layer =
    ctx.layerById.get(`lb-${cutIndex}`) ?? ctx.layerById.get(ctx.defaultLayerId) ?? ctx.layers[0];

  const matrix = compose(parentMatrix, parseXForm(el));

  if (type === 'Group') {
    const children = childElement(el, 'Children');
    if (children) {
      for (const child of Array.from(children.children)) {
        if (child.tagName === 'Shape') await parseShapeElement(child, matrix, ctx);
      }
    }
    return;
  }

  if (type === 'Rect') {
    const w = attrNum(el, 'W');
    const h = attrNum(el, 'H');
    if (w <= 0 || h <= 0) return;
    const cmds = rectCommands(w, h, attrNum(el, 'Cr'));
    addPath(cmds, matrix, layer.id, ctx);
    return;
  }

  if (type === 'Ellipse') {
    const rx = attrNum(el, 'Rx');
    const ry = attrNum(el, 'Ry');
    if (rx <= 0 || ry <= 0) return;
    addPath(ellipseCommands(rx, ry), matrix, layer.id, ctx);
    return;
  }

  if (type === 'Polygon') {
    const rx = attrNum(el, 'Rx');
    const ry = attrNum(el, 'Ry');
    const sides = attrNum(el, 'N', 6);
    addPath(polygonCommands(rx, ry, sides), matrix, layer.id, ctx);
    return;
  }

  if (type === 'Path') {
    let verts: Vert[] = [];
    let prims: Prim[] = [];
    let closed: boolean | null = null;
    const vertID = el.getAttribute('VertID');
    const primID = el.getAttribute('PrimID');
    const templateKey = vertID && primID ? `${vertID}_${primID}` : null;

    const vertList = childElement(el, 'VertList');
    const primList = childElement(el, 'PrimList');
    if (vertList || primList) {
      if (vertList?.textContent && vertList.textContent.includes('V')) {
        verts.push(...parseEncodedVerts(vertList.textContent));
      } else if (vertList) {
        for (const v of Array.from(vertList.children)) {
          if (v.tagName === 'Vert') {
            const vert: Vert = { x: attrNum(v, 'x', attrNum(v, 'vx')), y: attrNum(v, 'y', attrNum(v, 'vy')) };
            verts.push(vert);
          }
        }
      }
      if (primList?.textContent) {
        const parsed = parseEncodedPrims(primList.textContent, verts.length);
        prims.push(...parsed.prims);
        if (parsed.closed != null) closed = parsed.closed;
      }
    } else {
      verts.push(...parseLegacyVerts(el));
      prims.push(...parseLegacyPrims(el));
    }

    if (verts.length === 0 && templateKey) {
      const template = ctx.templates.get(templateKey);
      if (template) {
        verts = template.verts.map((v) => ({ ...v }));
        prims = template.prims.map((p) => ({ ...p }));
        closed = template.closed;
      }
    }
    if (verts.length === 0) return;
    if (prims.length === 0) {
      closed = closed ?? true;
    } else if (closed == null) {
      closed = prims.some((p) => p.p1 === prims[0]?.p0);
    }
    if (templateKey) {
      ctx.templates.set(templateKey, {
        verts: verts.map((v) => ({ ...v })),
        prims: prims.map((p) => ({ ...p })),
        closed,
      });
    }

    addPath(vertsToCommands(verts, prims, closed ?? false), matrix, layer.id, ctx, closed ?? false);
    return;
  }

  if (type === 'Text') {
    const backup = childElement(el, 'BackupPath');
    if (backup) {
      const backupMatrix = parseXForm(backup);
      const vertList = childElement(backup, 'VertList');
      const primList = childElement(backup, 'PrimList');
      let verts: Vert[] = [];
      let prims: Prim[] = [];
      let closed: boolean | null = null;
      if (vertList?.textContent) verts = parseEncodedVerts(vertList.textContent);
      if (primList?.textContent) {
        const parsed = parseEncodedPrims(primList.textContent, verts.length);
        prims = parsed.prims;
        closed = parsed.closed;
      }
      if (verts.length > 0) {
        if (prims.length === 0) closed = closed ?? true;
        else if (closed == null) closed = prims.some((p) => p.p1 === prims[0]?.p0);
        addPath(vertsToCommands(verts, prims, closed ?? false), backupMatrix, layer.id, ctx, closed ?? false);
        return;
      }
    }

    const text = attrStr(el, ['Str', 'Text']) ?? '';
    if (!text.trim()) return;
    const height = attrNum(el, 'H', 10);
    const angle = (-Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
    const origin = applyMat(matrix, 0, 0);
    const fontFamily = (attrStr(el, ['Font']) ?? 'Inter').split(',')[0] || 'Inter';
    const box = new Textbox(text, {
      left: origin.x,
      top: -origin.y - height,
      fontSize: height,
      fontFamily,
      angle,
      fill: '#000000',
      objectCaching: false,
    });
    box.set('layerId', layer.id);
    ctx.objects.push(box);
    return;
  }

  if (type === 'Bitmap') {
    const image = await importBitmap(el, matrix, layer.id);
    if (image) ctx.objects.push(image);
    else ctx.warnings.push('Bitmap without data was skipped');
    return;
  }

  if (type) ctx.warnings.push(`Unsupported shape type: ${type}`);
}

function addPath(
  cmds: Cmd[],
  matrix: Mat,
  layerId: string,
  ctx: ParseContext,
  closed = true,
): void {
  const data = commandsToPathData(cmds, matrix);
  if (!data) return;
  // Ensure closed contours are explicit for fills.
  const pathData = closed && !/Z\s*$/i.test(data) ? `${data} Z` : data;
  const path = new FabricPath(pathData, {
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 0.1,
    strokeUniform: true,
    objectCaching: false,
  });
  path.set('layerId', layerId);
  ctx.objects.push(path);
}

export async function parseLightBurn(xmlText: string): Promise<LightBurnImportResult> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error('Invalid LightBurn XML file');

  const root = doc.documentElement;
  if (!root || root.tagName !== 'LightBurnProject') {
    throw new Error('Not a LightBurn project (.lbrn/.lbrn2)');
  }

  const warnings: string[] = [];
  const cutSettings: LayerDef[] = [];
  let autoIndex = 0;
  for (const child of Array.from(root.children)) {
    if (child.tagName !== 'CutSetting') continue;
    const index = Number.parseInt(childValue(child, 'index') ?? String(autoIndex), 10);
    cutSettings.push(cutSettingsFromElement(child, Number.isFinite(index) ? index : autoIndex));
    autoIndex += 1;
  }

  if (cutSettings.length === 0) {
    cutSettings.push({
      id: 'lb-0',
      name: 'C00',
      color: PALETTE_COLORS[0],
      settings: {
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
      },
    });
  }

  const layerById = new Map(cutSettings.map((l) => [l.id, l]));
  const ctx: ParseContext = {
    layers: cutSettings,
    layerById,
    objects: [],
    warnings,
    defaultLayerId: cutSettings[0].id,
    templates: new Map(),
  };

  for (const child of Array.from(root.children)) {
    if (child.tagName !== 'Shape') continue;
    try {
      await parseShapeElement(child, IDENTITY, ctx);
    } catch (err) {
      warnings.push(`Shape skipped: ${(err as Error).message}`);
    }
  }

  // Normalise into the positive quadrant with a small margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of ctx.objects) {
    const b = obj.getBoundingRect();
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.left + b.width);
    maxY = Math.max(maxY, b.top + b.height);
  }
  if (!Number.isFinite(minX)) {
    return { layers: cutSettings, objects: [], warnings, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  for (const obj of ctx.objects) {
    obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
    obj.setCoords();
  }

  return {
    layers: cutSettings,
    objects: ctx.objects,
    warnings,
    bounds: {
      minX: minX + dx,
      minY: minY + dy,
      maxX: maxX + dx,
      maxY: maxY + dy,
    },
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layerIndexMap(layers: LayerDef[]): Map<string, number> {
  const map = new Map<string, number>();
  layers.forEach((layer, index) => map.set(layer.id, index));
  return map;
}

function cutSettingXml(layer: LayerDef, index: number): string {
  const s = layer.settings;
  const type = s.mode === 'fill' || s.mode === 'image' ? 'Scan' : 'Cut';
  const lines = [
    `  <CutSetting type="${type}">`,
    `    <index Value="${index}"/>`,
    `    <name Value="${escapeXml(layer.name)}"/>`,
    `    <priority Value="${index}"/>`,
    `    <minPower Value="${fmt(s.power)}"/>`,
    `    <maxPower Value="${fmt(s.power)}"/>`,
    `    <speed Value="${fmt(s.speed)}"/>`,
    `    <kerf Value="${fmt(s.kerf)}"/>`,
    `    <numPasses Value="${Math.max(1, Math.round(s.passes))}"/>`,
    `    <interval Value="${fmt(s.interval)}"/>`,
    `    <angle Value="${fmt(s.angle)}"/>`,
    `    <crossHatch Value="${s.crossHatch ? 1 : 0}"/>`,
    `    <scanOffset Value="${fmt(s.scanOffset)}"/>`,
    `    <overScanning Value="${fmt(s.overscan)}"/>`,
    '  </CutSetting>',
  ];
  return lines.join('\n');
}

function shapeVertList(points: { x: number; y: number }[]): string {
  return points.map((p) => `V${fmt(p.x)} ${fmt(p.y)}`).join('');
}

function shapePrimList(count: number, closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < count - 1; i += 1) parts.push(`L${i} ${i + 1}`);
  if (closed) parts.push(`L${count - 1} 0`);
  return parts.join('');
}

function shapeLegacyPrims(count: number, closed: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < count - 1; i += 1) parts.push(`    <P T="L" p0="${i}" p1="${i + 1}"/>`);
  if (closed) parts.push(`    <P T="L" p0="${count - 1}" p1="0"/>`);
  return parts.join('\n');
}

function shapeLegacyVerts(points: { x: number; y: number }[]): string {
  return points.map((p) => `    <V vx="${fmt(p.x)}" vy="${fmt(p.y)}"/>`).join('\n');
}

async function imageDataUrl(image: FabricImage): Promise<string | null> {
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | null;
  if (!element) return null;
  if (typeof HTMLImageElement !== 'undefined' && element instanceof HTMLImageElement) {
    return element.src.startsWith('data:') ? element.src : null;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement) {
    return element.toDataURL('image/png');
  }
  return null;
}

export async function serializeLightBurn(
  objects: FabricObject[],
  layers: LayerDef[],
  bed: { width: number; height: number },
  format: LightBurnFormat,
): Promise<{ xml: string; warnings: string[]; shapes: number }> {
  const warnings: string[] = [];
  const indexMap = layerIndexMap(layers);
  const shapes: string[] = [];
  let shapeCount = 0;
  let overrideWarning = false;

  const pushPath = (points: { x: number; y: number }[], closed: boolean, cutIndex: number) => {
    if (points.length < 2) return;
    const lbPoints = points.map((p) => ({ x: p.x, y: bed.height - p.y }));
    if (format === 'lbrn2') {
      shapes.push(
        [
          `  <Shape Type="Path" CutIndex="${cutIndex}">`,
          '    <XForm>1 0 0 1 0 0</XForm>',
          `    <VertList>${shapeVertList(lbPoints)}</VertList>`,
          `    <PrimList>${shapePrimList(lbPoints.length, closed)}</PrimList>`,
          '  </Shape>',
        ].join('\n'),
      );
    } else {
      shapes.push(
        [
          `  <Shape Type="Path" CutIndex="${cutIndex}">`,
          '    <XForm>1 0 0 1 0 0</XForm>',
          shapeLegacyVerts(lbPoints),
          shapeLegacyPrims(lbPoints.length, closed),
          '  </Shape>',
        ].join('\n'),
      );
    }
    shapeCount += 1;
  };

  for (const obj of objects) {
    if ((obj as FabricObject & { isNodeHandle?: boolean }).isNodeHandle) continue;
    if (obj.type === 'activeselection') continue;
    const layerId = (obj as FabricObject & { layerId?: string }).layerId ?? layers[0]?.id;
    const cutIndex = layerId ? indexMap.get(layerId) ?? 0 : 0;
    if ((obj as FabricObject & { cutOverride?: unknown }).cutOverride != null && !overrideWarning) {
      warnings.push('Per-object cut overrides are exported as layer settings');
      overrideWarning = true;
    }
    if ((obj as FabricObject & { zOffset?: number }).zOffset) {
      warnings.push('Per-object Z offsets are not exported to LightBurn');
    }

    if (obj instanceof FabricImage) {
      const dataUrl = await imageDataUrl(obj);
      const bounds = obj.getBoundingRect();
      if (Math.abs(obj.angle ?? 0) > 0.01) {
        warnings.push('Rotated images are exported without rotation');
      }
      if (dataUrl) {
        const base64 = dataUrl.split(',')[1] ?? '';
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        shapes.push(
          [
            `  <Shape Type="Bitmap" CutIndex="${cutIndex}" W="${fmt(bounds.width)}" H="${fmt(bounds.height)}" Gamma="1" Contrast="0" Brightness="0" Data="${base64}">`,
            `    <XForm>1 0 0 1 ${fmt(centerX)} ${fmt(bed.height - centerY)}</XForm>`,
            '  </Shape>',
          ].join('\n'),
        );
        shapeCount += 1;
      } else {
        warnings.push('An image could not be embedded and was skipped');
      }
      continue;
    }

    if (obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text') {
      const outlined = await textToScenePath(obj as Textbox);
      if (!outlined) {
        warnings.push('A text object without outline data was skipped');
        continue;
      }
      const temp = new FabricPath(outlined.pathData, { objectCaching: false });
      const contours = objectContours(temp);
      for (const contour of contours) {
        pushPath(contour.points, true, cutIndex);
      }
      continue;
    }

    const contours = objectContours(obj);
    for (const contour of contours) {
      pushPath(contour.points, contour.closed, cutIndex);
    }
  }

  if (shapeCount === 0) {
    warnings.push('No exportable vector shapes were found');
  }

  const cutSettingsXml = layers
    .map((layer) => cutSettingXml(layer, indexMap.get(layer.id) ?? 0))
    .join('\n');

  const formatVersion = format === 'lbrn2' ? '1' : '0';
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LightBurnProject AppVersion="1.7.03" FormatVersion="${formatVersion}" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    cutSettingsXml,
    shapes.join('\n'),
    '</LightBurnProject>',
    '',
  ].join('\n');

  return { xml, warnings, shapes: shapeCount };
}

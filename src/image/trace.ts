import ImageTracer from 'imagetracerjs';
import { FabricImage, Group, type FabricObject, loadSVGFromString, util } from 'fabric';

export interface TraceOptions {
  mode: 'mono' | 'color';
  colors: number;
  threshold: number;
  pathomit: number;
  invert: boolean;
  /** In colour mode, split the result into one group per colour. */
  separateColors?: boolean;
}

export interface TracedColorGroup {
  /** Normalised hex colour of the group (#rrggbb). */
  color: string;
  object: FabricObject;
}

type TraceElement = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

const MAX_TRACE_SIDE = 700;

function luminanceFromFill(fill: unknown): number | null {
  const rgb = parseFill(fill);
  if (!rgb) return null;
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** Parse a CSS colour from a traced SVG element into [r, g, b]. */
function parseFill(fill: unknown): [number, number, number] | null {
  if (typeof fill !== 'string') return null;
  const value = fill.trim().toLowerCase();
  if (value === 'white' || value === '#fff' || value === '#ffffff') return [255, 255, 255];
  if (value === 'black' || value === '#000' || value === '#000000') return [0, 0, 0];

  const rgb = value.match(/rgba?\(([^)]+)\)/);
  let r: number;
  let g: number;
  let b: number;
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => Number.parseFloat(p));
    [r, g, b] = parts;
  } else {
    const hex = value.match(/^#([0-9a-f]{6})$/);
    const short = value.match(/^#([0-9a-f]{3})$/);
    if (hex) {
      const n = Number.parseInt(hex[1], 16);
      r = (n >> 16) & 255;
      g = (n >> 8) & 255;
      b = n & 255;
    } else if (short) {
      const n = Number.parseInt(short[1], 16);
      r = ((n >> 8) & 15) * 17;
      g = ((n >> 4) & 15) * 17;
      b = (n & 15) * 17;
    } else {
      return null;
    }
  }
  if ([r, g, b].some((c) => !Number.isFinite(c))) return null;
  return [r, g, b];
}

function colorToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Rasterise an image element to the trace working resolution. */
function prepareImageData(element: TraceElement, options: TraceOptions): ImageData | null {
  const naturalWidth =
    (element as HTMLImageElement).naturalWidth || (element as HTMLCanvasElement).width;
  const naturalHeight =
    (element as HTMLImageElement).naturalHeight || (element as HTMLCanvasElement).height;
  if (!naturalWidth || !naturalHeight) return null;

  const scale = Math.min(1, MAX_TRACE_SIDE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(element as CanvasImageSource, 0, 0, width, height);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }

  const data = imageData.data;
  const threshold = Math.max(0, Math.min(255, options.threshold));
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (options.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (options.mode === 'mono') {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = gray < threshold ? 0 : 255;
      r = v;
      g = v;
      b = v;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return imageData;
}

function traceToSvg(element: TraceElement, options: TraceOptions): string | null {
  const imageData = prepareImageData(element, options);
  if (!imageData) return null;
  return ImageTracer.imagedataToSVG(imageData, {
    numberofcolors: options.mode === 'mono' ? 2 : Math.max(2, Math.round(options.colors)),
    colorsampling: options.mode === 'mono' ? 0 : 2,
    pathomit: Math.max(0, Math.round(options.pathomit)),
    ltres: 1,
    qtres: 1,
    rightangleenhance: false,
    strokewidth: 0,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    blurradius: 0,
    blurdelta: 20,
  });
}

/**
 * Vectorise an image element into an SVG string. Used by the trace preview,
 * which must not touch the workspace.
 */
export function traceElementToSvg(element: TraceElement, options: TraceOptions): string | null {
  return traceToSvg(element, options);
}

/** Load a data URL into an image element and return its trace preview SVG. */
export async function traceDataUrlToSvg(
  dataUrl: string,
  options: TraceOptions,
): Promise<string | null> {
  const image = await loadImage(dataUrl);
  if (!image) return null;
  const svg = traceToSvg(image, options);
  return svg ? stylePreviewSvg(svg) : null;
}

/**
 * The preview mirrors what gets added to the canvas: contour-only paths on a
 * dark background (near-white background shapes are dropped, like on apply).
 */
function stylePreviewSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;
    const shapes = Array.from(
      doc.querySelectorAll('path, rect, polygon, polyline, circle, ellipse'),
    );
    for (const shape of shapes) {
      const fill = shape.getAttribute('fill') ?? shape.getAttribute('style') ?? '';
      const lum = luminanceFromFill(fill);
      if (lum !== null && lum >= 245) {
        shape.remove();
        continue;
      }
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', '#d7dadd');
      shape.setAttribute('stroke-width', '0.6');
      shape.setAttribute('stroke-linejoin', 'round');
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch {
    return svg;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

interface ParsedTrace {
  objects: FabricObject[];
}

async function parseTrace(element: TraceElement, options: TraceOptions): Promise<ParsedTrace | null> {
  const svg = traceToSvg(element, options);
  if (!svg) return null;
  const parsed = await loadSVGFromString(svg);
  const objects = (parsed.objects.filter(Boolean) as FabricObject[]).filter((obj) => {
    const lum = luminanceFromFill((obj as FabricObject & { fill?: unknown }).fill);
    return lum === null || lum < 245;
  });
  if (objects.length === 0) return null;
  return { objects };
}

function elementOf(image: FabricImage): TraceElement | null {
  return image.getElement() as TraceElement | null;
}

/** Fit a group of traced paths onto the image's bounding rectangle. */
function fitToImage(group: Group, image: FabricImage): boolean {
  const target = image.getBoundingRect();
  group.setCoords();
  const bounds = group.getBoundingRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;

  const sx = target.width / bounds.width;
  const sy = target.height / bounds.height;
  group.set({
    scaleX: (group.scaleX ?? 1) * sx,
    scaleY: (group.scaleY ?? 1) * sy,
  });
  group.setCoords();
  group.set({ left: target.left, top: target.top });
  group.setCoords();
  return true;
}

/**
 * Vectorise a Fabric image with ImageTracer (marching-squares based) and return
 * a group of paths fitted to the image's bounding box.
 */
export async function traceImageObject(
  image: FabricImage,
  options: TraceOptions,
): Promise<FabricObject | null> {
  const element = elementOf(image);
  if (!element) return null;

  const parsed = await parseTrace(element, options);
  if (!parsed) return null;

  const grouped = util.groupSVGElements(parsed.objects);
  const group = grouped instanceof Group ? grouped : new Group([grouped]);
  for (const child of group.getObjects()) {
    child.set({ fill: 'transparent', strokeUniform: true });
  }
  group.setCoords();

  if (!fitToImage(group, image)) return null;
  return group;
}

/**
 * Colour mode with one group per traced colour, all fitted with the same
 * transform so shapes keep their relative positions.
 */
export async function traceImageByColor(
  image: FabricImage,
  options: TraceOptions,
): Promise<TracedColorGroup[]> {
  const element = elementOf(image);
  if (!element) return [];

  const parsed = await parseTrace(element, options);
  if (!parsed) return [];

  const buckets = new Map<string, FabricObject[]>();
  let fallback: [number, number, number] = [0, 0, 0];
  for (const obj of parsed.objects) {
    const fill = (obj as FabricObject & { fill?: unknown }).fill;
    const rgb = parseFill(fill) ?? fallback;
    const color = colorToHex(rgb);
    fallback = rgb;
    const list = buckets.get(color) ?? [];
    list.push(obj);
    buckets.set(color, list);
  }

  const groups: Array<{ color: string; object: FabricObject }> = [];
  for (const [color, objects] of buckets) {
    const grouped = util.groupSVGElements(objects);
    const group = grouped instanceof Group ? grouped : new Group([grouped]);
    for (const child of group.getObjects()) {
      child.set({ fill: 'transparent', strokeUniform: true });
    }
    group.setCoords();
    groups.push({ color, object: group });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { object } of groups) {
    object.setCoords();
    const b = object.getBoundingRect();
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.left + b.width);
    maxY = Math.max(maxY, b.top + b.height);
  }
  if (!Number.isFinite(minX)) return [];

  const target = image.getBoundingRect();
  const bounds = { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  if (bounds.width <= 0 || bounds.height <= 0) return [];

  const sx = target.width / bounds.width;
  const sy = target.height / bounds.height;

  for (const { object } of groups) {
    object.setCoords();
    const b = object.getBoundingRect();
    object.set({
      scaleX: (object.scaleX ?? 1) * sx,
      scaleY: (object.scaleY ?? 1) * sy,
    });
    object.setCoords();
    const scaled = object.getBoundingRect();
    object.set({
      left: (object.left ?? 0) + (target.left + (b.left - bounds.left) * sx - scaled.left),
      top: (object.top ?? 0) + (target.top + (b.top - bounds.top) * sy - scaled.top),
    });
    object.setCoords();
  }

  return groups;
}

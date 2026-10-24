import ImageTracer from 'imagetracerjs';
import { FabricImage, Group, type FabricObject, loadSVGFromString, util } from 'fabric';

export interface TraceOptions {
  mode: 'mono' | 'color';
  colors: number;
  threshold: number;
  pathomit: number;
  invert: boolean;
}

function luminanceFromFill(fill: unknown): number | null {
  if (typeof fill !== 'string') return null;
  const value = fill.trim().toLowerCase();
  if (value === 'white' || value === '#fff' || value === '#ffffff') return 255;
  if (value === 'black' || value === '#000' || value === '#000000') return 0;

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
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Vectorise a Fabric image with ImageTracer (marching-squares based) and return
 * a group of paths fitted to the image's bounding box.
 */
export async function traceImageObject(
  image: FabricImage,
  options: TraceOptions,
): Promise<FabricObject | null> {
  const element = image.getElement() as
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
    | null;
  if (!element) return null;

  const naturalWidth =
    (element as HTMLImageElement).naturalWidth || (element as HTMLCanvasElement).width;
  const naturalHeight =
    (element as HTMLImageElement).naturalHeight || (element as HTMLCanvasElement).height;
  if (!naturalWidth || !naturalHeight) return null;

  const maxDimension = 700;
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
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

  const svg = ImageTracer.imagedataToSVG(imageData, {
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

  const parsed = await loadSVGFromString(svg);
  const valid = (parsed.objects.filter(Boolean) as FabricObject[]).filter((obj) => {
    const lum = luminanceFromFill((obj as FabricObject & { fill?: unknown }).fill);
    return lum === null || lum < 245;
  });
  if (valid.length === 0) return null;

  const grouped = util.groupSVGElements(valid);
  const group = grouped instanceof Group ? grouped : new Group([grouped]);
  for (const child of group.getObjects()) {
    child.set({ fill: 'transparent', strokeUniform: true });
  }
  group.setCoords();

  const target = image.getBoundingRect();
  const bounds = group.getBoundingRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const sx = target.width / bounds.width;
  const sy = target.height / bounds.height;
  group.set({
    scaleX: (group.scaleX ?? 1) * sx,
    scaleY: (group.scaleY ?? 1) * sy,
  });
  group.setCoords();
  group.set({ left: target.left, top: target.top });
  group.setCoords();

  return group;
}

import {
  Ellipse,
  FabricObject,
  Group,
  Line,
  Polygon,
  Polyline,
  Textbox,
} from 'fabric';

interface Pair {
  code: number;
  value: string;
}

interface Vec {
  x: number;
  y: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    out.push({ code, value: lines[i + 1] ?? '' });
  }
  return out;
}

function num(p: Pair[]): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  for (const pair of p) {
    (map[pair.code] ??= []).push(pair.value);
  }
  return map;
}

function toVec(map: Record<number, string[]>, xCode = 10, yCode = 20): Vec {
  return {
    x: Number.parseFloat(map[xCode]?.[0] ?? '0') || 0,
    y: Number.parseFloat(map[yCode]?.[0] ?? '0') || 0,
  };
}

/**
 * Minimal DXF reader: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC and TEXT.
 * Enough for the vector artwork commonly exported by CAD tools.
 */
export function parseDxf(text: string): FabricObject[] {
  if (!/SECTION/i.test(text)) throw new Error('Not a DXF file');

  const all = pairs(text);

  // Header units: 1 inch, 5 cm, 6 m. Default: millimetres.
  let unitScale = 1;
  for (let i = 0; i < all.length - 1; i += 1) {
    if (all[i].code === 9 && all[i].value === '$INSUNITS') {
      const value = Number.parseInt(all[i + 1].value, 10);
      if (value === 1) unitScale = 25.4;
      else if (value === 5) unitScale = 10;
      else if (value === 6) unitScale = 1000;
      break;
    }
  }

  const objects: FabricObject[] = [];
  let i = 0;
  while (i < all.length && !(all[i].code === 2 && all[i].value === 'ENTITIES')) i += 1;
  i += 1;

  let activePolyline: { points: Vec[]; closed: boolean } | null = null;

  const flushPolyline = () => {
    if (!activePolyline) return;
    if (activePolyline.points.length >= 2) {
      objects.push(makePolyline(activePolyline.points, activePolyline.closed));
    }
    activePolyline = null;
  };

  while (i < all.length) {
    const pair = all[i];
    if (pair.code === 0 && pair.value === 'ENDSEC') break;
    if (pair.code !== 0) {
      i += 1;
      continue;
    }

    const type = pair.value;
    let j = i + 1;
    const body: Pair[] = [];
    while (j < all.length && all[j].code !== 0) {
      body.push(all[j]);
      j += 1;
    }
    const map = num(body);

    switch (type) {
      case 'LINE': {
        const a = toVec(map);
        const b = toVec(map, 11, 21);
        objects.push(
          new Line(
            [a.x * unitScale, -a.y * unitScale, b.x * unitScale, -b.y * unitScale],
            { fill: 'transparent', objectCaching: false },
          ),
        );
        break;
      }
      case 'CIRCLE': {
        const c = toVec(map);
        const r = (Number.parseFloat(map[40]?.[0] ?? '0') || 0) * unitScale;
        objects.push(
          new Ellipse({
            left: c.x * unitScale - r,
            top: -c.y * unitScale - r,
            rx: r,
            ry: r,
            fill: 'transparent',
            objectCaching: false,
          }),
        );
        break;
      }
      case 'ARC': {
        const c = toVec(map);
        const r = (Number.parseFloat(map[40]?.[0] ?? '0') || 0) * unitScale;
        const start = Number.parseFloat(map[50]?.[0] ?? '0') || 0;
        const end = Number.parseFloat(map[51]?.[0] ?? '0') || 0;
        objects.push(makeArc(c, r, start, end, unitScale));
        break;
      }
      case 'LWPOLYLINE': {
        const xs = map[10] ?? [];
        const ys = map[20] ?? [];
        const pts: Vec[] = [];
        for (let k = 0; k < Math.min(xs.length, ys.length); k += 1) {
          pts.push({
            x: (Number.parseFloat(xs[k]) || 0) * unitScale,
            y: -(Number.parseFloat(ys[k]) || 0) * unitScale,
          });
        }
        const flags = Number.parseInt(map[70]?.[0] ?? '0');
        objects.push(makePolyline(pts, (flags & 1) !== 0));
        break;
      }
      case 'POLYLINE': {
        const flags = Number.parseInt(map[70]?.[0] ?? '0');
        activePolyline = { points: [], closed: (flags & 1) !== 0 };
        break;
      }
      case 'VERTEX': {
        if (activePolyline) {
          const v = toVec(map);
          activePolyline.points.push({ x: v.x * unitScale, y: -v.y * unitScale });
        }
        break;
      }
      case 'SEQEND': {
        flushPolyline();
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const at = toVec(map);
        const height = (Number.parseFloat(map[40]?.[0] ?? '2.5') || 2.5) * unitScale;
        const content = (map[1]?.[0] ?? '').replace(/\\P/g, '\n');
        objects.push(
          new Textbox(content, {
            left: at.x * unitScale,
            top: -at.y * unitScale,
            fontSize: height,
            width: height * Math.max(4, content.length) * 0.62,
            fontFamily: 'Inter, sans-serif',
            fill: '#000000',
            objectCaching: false,
          }),
        );
        break;
      }
      default:
        break;
    }
    i = j;
  }
  flushPolyline();

  if (objects.length === 0) throw new Error('No supported DXF entities found');

  // Normalise the imported geometry to the positive quadrant.
  let minX = Infinity;
  let minY = Infinity;
  for (const obj of objects) {
    const b = obj.getBoundingRect();
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
  }
  if (Number.isFinite(minX) && Number.isFinite(minY)) {
    for (const obj of objects) {
      obj.set({ left: (obj.left ?? 0) - minX, top: (obj.top ?? 0) - minY });
      obj.setCoords();
    }
  }

  if (objects.length === 1) return objects;
  return [new Group(objects)];
}

function makePolyline(points: Vec[], closed: boolean): FabricObject {
  if (points.length < 2) {
    return new Line([0, 0, 0, 0], { fill: 'transparent' });
  }
  if (closed && points.length >= 3) {
    return new Polygon(points, { fill: 'transparent', objectCaching: false });
  }
  return new Polyline(points, { fill: 'transparent', objectCaching: false });
}

function makeArc(
  center: Vec,
  radius: number,
  startDeg: number,
  endDeg: number,
  scale: number,
): FabricObject {
  const steps = Math.max(8, Math.ceil(Math.abs(endDeg - startDeg) / 6));
  const pts: Vec[] = [];
  let end = endDeg;
  if (end < startDeg) end += 360;
  for (let s = 0; s <= steps; s += 1) {
    const a = deg(startDeg + ((end - startDeg) * s) / steps);
    pts.push({
      x: (center.x + Math.cos(a) * radius) * scale,
      y: -(center.y + Math.sin(a) * radius) * scale,
    });
  }
  return new Polyline(pts, { fill: 'transparent', objectCaching: false });
}

import paper from 'paper';
import { Path as FabricPath, type FabricObject } from 'fabric';
import type { BooleanOp } from '@/state/store';
import { clearPaperProject, ensurePaper } from './paperSetup';

function collectPaths(item: paper.Item, out: paper.PathItem[]): void {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    out.push(item);
    return;
  }
  const children = (item as unknown as { children?: paper.Item[] }).children;
  if (Array.isArray(children)) children.forEach((child) => collectPaths(child, out));
}

function fabricToPaths(obj: FabricObject): paper.PathItem[] {
  ensurePaper();
  const svg = obj.toSVG();
  const imported = paper.project.importSVG(svg, { expandShapes: true });
  const paths: paper.PathItem[] = [];
  collectPaths(imported, paths);
  imported.remove();
  return paths;
}

/** Convert a Fabric object (in scene coordinates) into a single paper path item. */
function fabricToPaper(obj: FabricObject): paper.PathItem | null {
  ensurePaper();
  const paths = fabricToPaths(obj);
  if (paths.length === 0) return null;

  // Normalise stroke/fill so boolean results behave predictably.
  let result: paper.PathItem | null = null;
  for (const p of paths) {
    p.fillColor = new paper.Color('black');
    p.strokeColor = null;
    const cloned = p.clone({ insert: false }) as paper.PathItem;
    result = result ? (result.unite(cloned, { insert: false }) as paper.PathItem) : cloned;
  }
  return result;
}

export interface BooleanResult {
  pathData: string;
}

export function booleanObjects(objects: FabricObject[], op: BooleanOp): BooleanResult | null {
  ensurePaper();
  clearPaperProject();
  const items: paper.PathItem[] = [];
  for (const obj of objects) {
    const p = fabricToPaper(obj);
    if (p) items.push(p);
  }
  if (items.length < 2) return null;

  let acc = items[0];
  for (let i = 1; i < items.length; i += 1) {
    const b = items[i];
    switch (op) {
      case 'union':
        acc = acc.unite(b, { insert: false }) as paper.PathItem;
        break;
      case 'subtract':
        acc = acc.subtract(b, { insert: false }) as paper.PathItem;
        break;
      case 'intersect':
        acc = acc.intersect(b, { insert: false }) as paper.PathItem;
        break;
      case 'exclude':
        acc = acc.exclude(b, { insert: false }) as paper.PathItem;
        break;
    }
  }

  const pathData = (acc as unknown as { pathData?: string }).pathData;
  if (!pathData) return null;
  clearPaperProject();
  return { pathData };
}

export function objectToPathData(obj: FabricObject): string | null {
  ensurePaper();
  clearPaperProject();
  const item = fabricToPaper(obj);
  const pathData = (item as unknown as { pathData?: string }).pathData ?? null;
  clearPaperProject();
  return pathData;
}

/**
 * Scene-space path data. Paper normalises imported SVG coordinates to the
 * origin, so we re-align the result to the source object's bounding box.
 */
export function objectToScenePathData(obj: FabricObject): string | null {
  const data = objectToPathData(obj);
  if (!data) return null;
  try {
    ensurePaper();
    const item = new paper.CompoundPath(data);
    const bounds = item.bounds;
    const target = obj.getBoundingRect();
    item.translate(new paper.Point(target.left - bounds.x, target.top - bounds.y));
    const out = item.pathData;
    item.remove();
    return out ?? null;
  } catch {
    return null;
  }
}

/** Import a Fabric object's geometry as scene-space Paper items (holes kept). */
export function objectToScenePathItems(obj: FabricObject): paper.PathItem[] {
  ensurePaper();
  clearPaperProject();
  try {
    const svg = obj.toSVG();
    const imported = paper.project.importSVG(svg, { expandShapes: true });
    const paths: paper.PathItem[] = [];
    collectPaths(imported, paths);
    if (paths.length === 0) return [];
    const bounds = imported.bounds;
    const target = obj.getBoundingRect();
    const dx = target.left - bounds.x;
    const dy = target.top - bounds.y;
    const out: paper.PathItem[] = [];
    for (const p of paths) {
      p.fillColor = new paper.Color('black');
      p.strokeColor = null;
      // Even-odd keeps letter counters / holes empty regardless of the winding
      // direction used by the source file (Inkscape, Illustrator, fonts…).
      p.fillRule = 'evenodd';
      const cloned = p.clone({ insert: false }) as paper.PathItem;
      cloned.fillRule = 'evenodd';
      cloned.translate(new paper.Point(dx, dy));
      out.push(cloned);
    }
    imported.remove();
    return out;
  } catch {
    return [];
  } finally {
    clearPaperProject();
  }
}

/**
 * Scene-space path data that keeps every sub-path separate (no union), so
 * holes stay as holes. Used by fill/hatch, which apply the even-odd rule.
 */
export function objectToSceneCompoundPathData(obj: FabricObject): string | null {
  ensurePaper();
  clearPaperProject();
  try {
    const imported = paper.project.importSVG(obj.toSVG(), { expandShapes: true });
    const paths: paper.PathItem[] = [];
    collectPaths(imported, paths);
    if (paths.length === 0) return null;

    const bounds = imported.bounds;
    const target = obj.getBoundingRect();
    const dx = target.left - bounds.x;
    const dy = target.top - bounds.y;

    const data = paths
      .map((p) => (p as unknown as { pathData?: string }).pathData ?? '')
      .filter(Boolean)
      .join(' ');
    if (!data) return null;

    const item = new paper.CompoundPath(data);
    item.fillRule = 'evenodd';
    item.translate(new paper.Point(dx, dy));
    const out = item.pathData ?? null;
    item.remove();
    return out;
  } catch {
    return null;
  } finally {
    clearPaperProject();
  }
}

/** Best-effort detection: can this object be converted to path geometry? */
export function isConvertible(obj: FabricObject): boolean {
  return !/text/i.test(obj.type ?? '');
}

export function makeFabricPath(
  pathData: string,
  style: { stroke: string; strokeWidth: number },
): FabricPath {
  return new FabricPath(pathData, {
    fill: 'transparent',
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeUniform: true,
    objectCaching: false,
  });
}

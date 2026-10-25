/**
 * SVG import helpers.
 *
 * Fabric.js converts SVG lengths (mm/cm/in/pt) to pixels using 96 DPI, but the
 * OpenBurn canvas works in millimetres (1 canvas unit = 1 mm). Importing an SVG
 * as-is therefore scales it by 96/25.4 (~3.78x): a 50 mm artwork becomes ~189 mm.
 *
 * `normalizeSvgDimensions` rewrites the root width/height to their physical size
 * in millimetres expressed as unitless user units, so Fabric's resulting object
 * matches the real-world dimensions while the original viewBox is preserved for
 * geometry fidelity.
 */

const MM_PER_INCH = 25.4;
const CSS_PX_PER_INCH = 96;

/** Parse an SVG/CSS length and return millimetres, or null if not absolute. */
export function lengthToMm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  switch (match[2].toLowerCase()) {
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'in':
      return value * MM_PER_INCH;
    case 'pt':
      return (value * MM_PER_INCH) / 72;
    case 'pc':
      return (value * MM_PER_INCH) / 6;
    case 'px':
      return (value * MM_PER_INCH) / CSS_PX_PER_INCH;
    case '':
      // Unitless user units are CSS pixels in SVG.
      return (value * MM_PER_INCH) / CSS_PX_PER_INCH;
    default:
      // Percentages and relative units (em/ex/%) have no absolute size.
      return null;
  }
}

function readAttr(tag: string, name: string): string | null {
  // Require a whitespace (or tag start) boundary so `width` does not match
  // `stroke-width`, and `height` does not match `line-height`.
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`((?:^|\\s)${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i');
  if (re.test(tag)) return tag.replace(re, `$1"${value}"`);
  return tag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

function readStyleProp(tag: string, name: string): string | null {
  const style = readAttr(tag, 'style');
  if (!style) return null;
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim().toLowerCase() === name.toLowerCase()) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

/** Remove width/height declarations from an inline style (they override attributes). */
function stripStyleSize(tag: string): string {
  const style = readAttr(tag, 'style');
  if (!style) return tag;
  const cleaned = style
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/^width\s*:/i.test(part) && !/^height\s*:/i.test(part))
    .join('; ');
  return setAttr(tag, 'style', cleaned);
}

const fmt = (n: number) => (Math.round(n * 1e3) / 1e3).toString();

function readViewBox(
  tag: string,
): { x: number; y: number; width: number; height: number } | null {
  const raw = readAttr(tag, 'viewBox');
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return { x: parts[0], y: parts[1], width: Math.abs(parts[2]), height: Math.abs(parts[3]) };
}

/**
 * Rewrite the root `<svg>` so width/height match the viewBox extent (scale 1)
 * and report the physical size in millimetres. The caller applies that size
 * itself after parsing, which avoids Fabric's own DPI/viewBox double scaling.
 */
export interface SvgImportPrep {
  svg: string;
  widthMm: number | null;
  heightMm: number | null;
}

export function prepareSvgForImport(svg: string): SvgImportPrep {
  const tagMatch = svg.match(/<svg\b[^>]*>/i);
  if (!tagMatch) return { svg, widthMm: null, heightMm: null };

  const tag = tagMatch[0];
  const vb = readViewBox(tag);
  // Some editors put the size in `style`, which overrides the attributes.
  const bare = stripStyleSize(tag);
  const declaredWidth =
    lengthToMm(readAttr(tag, 'width')) ?? lengthToMm(readStyleProp(tag, 'width'));
  const declaredHeight =
    lengthToMm(readAttr(tag, 'height')) ?? lengthToMm(readStyleProp(tag, 'height'));

  const widthMm =
    declaredWidth ?? (vb && vb.width > 0 ? (vb.width * MM_PER_INCH) / CSS_PX_PER_INCH : null);
  const heightMm =
    declaredHeight ?? (vb && vb.height > 0 ? (vb.height * MM_PER_INCH) / CSS_PX_PER_INCH : null);

  let next = bare;
  if (vb && vb.width > 0 && vb.height > 0) {
    // 1 user unit === 1 canvas unit while parsing; we scale afterwards.
    next = setAttr(next, 'width', fmt(vb.width));
    next = setAttr(next, 'height', fmt(vb.height));
  } else if (declaredWidth && declaredHeight) {
    next = setAttr(next, 'width', fmt(declaredWidth));
    next = setAttr(next, 'height', fmt(declaredHeight));
  }

  return { svg: svg.replace(tag, next), widthMm, heightMm };
}


/**
 * Tag the SVG with its physical size in millimetres derived from the viewBox
 * (OpenBurn's world units are mm), so exported files round-trip correctly.
 */
export function applySvgPhysicalSize(svg: string): string {
  const tagMatch = svg.match(/<svg\b[^>]*>/i);
  if (!tagMatch) return svg;
  const tag = tagMatch[0];
  const vb = readViewBox(tag);
  if (!vb || vb.width <= 0 || vb.height <= 0) return svg;
  let next = setAttr(tag, 'width', `${fmt(vb.width)}mm`);
  next = setAttr(next, 'height', `${fmt(vb.height)}mm`);
  return svg.replace(tag, next);
}


import {
  DEFAULT_CUT_SETTINGS,
  createEmptyDocument,
  type OpenBurnDocument,
} from '@/types/document';

export interface SaveInput {
  name: string;
  units: OpenBurnDocument['units'];
  bed: OpenBurnDocument['bed'];
  layers: OpenBurnDocument['layers'];
  canvas: unknown;
  guides?: OpenBurnDocument['guides'];
  pages?: OpenBurnDocument['pages'];
  createdAt?: string;
}

export function buildDocument(input: SaveInput): OpenBurnDocument {
  const now = new Date().toISOString();
  return {
    format: 'openburn',
    version: 1,
    units: input.units,
    bed: input.bed,
    layers: input.layers,
    canvas: input.canvas,
    guides: input.guides,
    pages: input.pages,
    meta: {
      name: input.name,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    },
  };
}

/** Keep only well-formed guides; older documents simply have none. */
export function normalizeGuides(input: unknown): OpenBurnDocument['guides'] {
  if (!Array.isArray(input)) return [];
  const out: NonNullable<OpenBurnDocument['guides']> = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const guide = entry as Partial<{ axis: unknown; position: unknown }>;
    if (guide.axis !== 'x' && guide.axis !== 'y') continue;
    if (typeof guide.position !== 'number' || !Number.isFinite(guide.position)) continue;
    out.push({ axis: guide.axis, position: guide.position });
  }
  return out;
}

export function serializeDocument(doc: OpenBurnDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function parseDocument(text: string): OpenBurnDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project file');
  const obj = raw as Partial<OpenBurnDocument>;
  if (obj.format !== 'openburn' && !Array.isArray(obj.layers)) {
    throw new Error('Not an OpenBurn project (.obrn)');
  }
  const base = createEmptyDocument(obj.meta?.name ?? 'Untitled');
  const doc: OpenBurnDocument = {
    ...base,
    ...obj,
    version: 1,
    format: 'openburn',
    units: obj.units === 'in' ? 'in' : 'mm',
    bed: { ...base.bed, ...(obj.bed ?? {}) },
    layers:
      Array.isArray(obj.layers) && obj.layers.length > 0
        ? obj.layers.map((layer) => ({
            ...layer,
            settings: { ...DEFAULT_CUT_SETTINGS, ...(layer.settings ?? {}) },
          }))
        : base.layers,
    canvas: obj.canvas ?? base.canvas,
    guides: normalizeGuides(obj.guides),
    meta: { ...base.meta, ...(obj.meta ?? {}) },
  };
  return doc;
}

/** Very small heuristic used to decide between project-open and import. */
export function looksLikeProject(fileName: string): boolean {
  return /\.(obrn|ovbrn|json)$/i.test(fileName);
}

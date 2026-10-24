import { createEmptyDocument, type OpenBurnDocument } from '@/types/document';

export interface SaveInput {
  name: string;
  units: OpenBurnDocument['units'];
  bed: OpenBurnDocument['bed'];
  layers: OpenBurnDocument['layers'];
  canvas: unknown;
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
    pages: input.pages,
    meta: {
      name: input.name,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    },
  };
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
    layers: Array.isArray(obj.layers) && obj.layers.length > 0 ? obj.layers : base.layers,
    canvas: obj.canvas ?? base.canvas,
    meta: { ...base.meta, ...(obj.meta ?? {}) },
  };
  return doc;
}

/** Very small heuristic used to decide between project-open and import. */
export function looksLikeProject(fileName: string): boolean {
  return /\.(obrn|ovbrn|json)$/i.test(fileName);
}

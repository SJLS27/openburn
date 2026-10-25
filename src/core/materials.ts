import type { LayerDef } from '@/types/document';

export interface MaterialEntry {
  id: string;
  name: string;
  thickness: string;
  speed: number;
  power: number;
  passes: number;
  mode: 'line' | 'fill';
  kerf: number;
}

export const MATERIAL_STORAGE_KEY = 'openburn.materials.v1';
export const MATERIALS_UPDATED_EVENT = 'openburn:materials-updated';

export const DEFAULT_MATERIALS: MaterialEntry[] = [
  { id: 'ply-3', name: 'Plywood', thickness: '3 mm', speed: 18, power: 55, passes: 1, mode: 'line', kerf: 0 },
  { id: 'ply-6', name: 'Plywood', thickness: '6 mm', speed: 10, power: 75, passes: 2, mode: 'line', kerf: 0 },
  { id: 'acry-3', name: 'Acrylic (cast)', thickness: '3 mm', speed: 15, power: 60, passes: 1, mode: 'line', kerf: 0 },
  { id: 'acry-3-fill', name: 'Acrylic (cast)', thickness: '3 mm', speed: 120, power: 45, passes: 1, mode: 'fill', kerf: 0 },
  { id: 'mdf-3', name: 'MDF', thickness: '3 mm', speed: 22, power: 50, passes: 1, mode: 'line', kerf: 0 },
  { id: 'leather-2', name: 'Leather', thickness: '2 mm', speed: 90, power: 25, passes: 1, mode: 'fill', kerf: 0 },
  { id: 'steel-mark', name: 'Stainless (marking)', thickness: '—', speed: 200, power: 40, passes: 1, mode: 'fill', kerf: 0 },
];

export function loadMaterials(): MaterialEntry[] {
  try {
    const raw = localStorage.getItem(MATERIAL_STORAGE_KEY);
    if (!raw) return DEFAULT_MATERIALS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_MATERIALS;
    const valid = parsed.filter(
      (m): m is MaterialEntry =>
        m && typeof m.name === 'string' && Number.isFinite(m.speed) && Number.isFinite(m.power),
    );
    return valid.length > 0 ? valid : DEFAULT_MATERIALS;
  } catch {
    return DEFAULT_MATERIALS;
  }
}

export function saveMaterials(materials: MaterialEntry[]): void {
  try {
    localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(materials));
  } catch {
    /* storage may be unavailable */
  }
}

export function materialFromLayer(layer: LayerDef): MaterialEntry {
  return {
    id: `mat-${Date.now()}`,
    name: layer.name,
    thickness: '',
    speed: layer.settings.speed,
    power: layer.settings.power,
    passes: layer.settings.passes,
    mode: layer.settings.mode === 'fill' ? 'fill' : 'line',
    kerf: layer.settings.kerf ?? 0,
  };
}

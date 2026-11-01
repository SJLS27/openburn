export type DropKind = 'project' | 'lightburn' | 'svg' | 'dxf' | 'image' | 'unsupported';

const PROJECT_EXTENSIONS = new Set(['obrn', 'ovbrn']);
const LIGHTBURN_EXTENSIONS = new Set(['lbrn', 'lbrn2']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

/** Extensions that can be read as UTF-8 text instead of binary data. */
export const TEXT_DROP_EXTENSIONS = new Set([
  'obrn',
  'ovbrn',
  'lbrn',
  'lbrn2',
  'svg',
  'dxf',
]);

export function fileExtension(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

/** What to do with a file dropped onto the workspace. */
export function dropKindForFile(name: string): DropKind {
  const ext = fileExtension(name);
  if (PROJECT_EXTENSIONS.has(ext)) return 'project';
  if (LIGHTBURN_EXTENSIONS.has(ext)) return 'lightburn';
  if (ext === 'svg') return 'svg';
  if (ext === 'dxf') return 'dxf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'unsupported';
}

export function isTextDrop(name: string): boolean {
  return TEXT_DROP_EXTENSIONS.has(fileExtension(name));
}

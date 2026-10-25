export interface PickedFile {
  name: string;
  path?: string;
  text?: string;
  bytes?: Uint8Array;
  dataUrl?: string;
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export const PROJECT_FILTER = [{ name: 'OpenBurn Project', extensions: ['obrn'] }];
export const PROJECT_OPEN_FILTERS = [
  { name: 'OpenBurn Project', extensions: ['obrn', 'ovbrn'] },
];

const TEXT_EXTENSIONS = new Set(['svg', 'dxf', 'json', 'obrn', 'ovbrn', 'lbrn', 'lbrn2']);
export const LIGHTBURN_FILTER = [
  { name: 'LightBurn Project', extensions: ['lbrn2', 'lbrn'] },
];
export const ARTWORK_FILTER = [
  { name: 'Artwork', extensions: ['svg', 'dxf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
  { name: 'All Files', extensions: ['*'] },
];

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.openburn?.isElectron;
}

async function browserPick(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const name = file.name;
      const e = ext(name);
      if (TEXT_EXTENSIONS.has(e)) {
        resolve({ name, text: await file.text() });
      } else {
        const buf = await file.arrayBuffer();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        resolve({ name, bytes: new Uint8Array(buf), dataUrl });
      }
    };
    input.click();
  });
}

export async function pickArtwork(): Promise<PickedFile | null> {
  if (isElectron()) {
    const api = window.openburn!;
    const path = await api.openFile(ARTWORK_FILTER);
    if (!path) return null;
    const name = path.split(/[\\/]/).pop() ?? 'file';
    const e = ext(name);
    if (e === 'svg' || e === 'dxf') {
      return { name, path, text: await api.readFile(path) };
    }
    const bin = await api.readBinary(path);
    const mime = MIME[e] ?? 'application/octet-stream';
    return { name, path, dataUrl: `data:${mime};base64,${bin.data}` };
  }
  return browserPick('.svg,.dxf,.png,.jpg,.jpeg,.gif,.bmp,.webp');
}

export async function pickProject(): Promise<PickedFile | null> {
  if (isElectron()) {
    const api = window.openburn!;
    const path = await api.openFile([
      ...PROJECT_OPEN_FILTERS,
      ...LIGHTBURN_FILTER,
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!path) return null;
    return { name: path.split(/[\\/]/).pop() ?? 'project.obrn', path, text: await api.readFile(path) };
  }
  return browserPick('.obrn,.ovbrn,.json,.lbrn,.lbrn2');
}

export async function saveProjectFile(
  suggestedName: string,
  content: string,
  existingPath: string | null,
): Promise<string | null> {
  if (isElectron()) {
    const api = window.openburn!;
    let path = existingPath;
    if (!path) {
      const fileName = /\.(obrn|ovbrn)$/i.test(suggestedName) ? suggestedName : `${suggestedName}.obrn`;
      path = await api.saveFile({
        defaultPath: fileName,
        filters: PROJECT_FILTER,
      });
    }
    if (!path) return null;
    await api.writeFile(path, content);
    return path;
  }

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = /\.(obrn|ovbrn)$/i.test(suggestedName) ? suggestedName : `${suggestedName}.obrn`;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return a.download;
}

export async function saveTextFile(
  suggestedName: string,
  content: string,
  extension: string,
  mime = 'text/plain',
  filters?: { name: string; extensions: string[] }[],
): Promise<boolean> {
  if (isElectron()) {
    const api = window.openburn!;
    const path = await api.saveFile({
      defaultPath: suggestedName,
      filters: filters ?? [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    await api.writeFile(path, content);
    return true;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function readAsDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Load a file bundled in `public/`. In the packaged app the renderer is loaded
 * over file://, where fetch() cannot read local files, so we go through IPC.
 */
export async function loadBinaryAsset(relativePath: string): Promise<ArrayBuffer> {
  const rel = relativePath.replace(/^\/+/, '');
  if (isElectron() && window.location.protocol === 'file:') {
    const b64 = await window.openburn!.readAppAsset(rel);
    return base64ToArrayBuffer(b64);
  }
  const url = `${import.meta.env.BASE_URL}${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${relativePath} (${res.status})`);
  return res.arrayBuffer();
}

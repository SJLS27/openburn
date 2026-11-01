import fs from 'node:fs';
import path from 'node:path';

/** Read JSON without throwing; a corrupted or missing file is simply `null`. */
export function readJsonFile<T>(file: string): T | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    return (parsed ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * Write JSON atomically (temp file + rename) so a crash mid-write cannot leave
 * a truncated file behind. Returns false instead of throwing.
 */
export function writeJsonFileAtomic(file: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function removeFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* nothing to clean up */
  }
}

// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile, removeFile, writeJsonFileAtomic } from './storage';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-storage-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('electron/storage', () => {
  it('creates parent directories and round-trips JSON', () => {
    const file = path.join(tempDir(), 'nested', 'state.json');
    expect(writeJsonFileAtomic(file, { a: 1 })).toBe(true);
    expect(readJsonFile(file)).toEqual({ a: 1 });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('overwrites existing files', () => {
    const file = path.join(tempDir(), 'state.json');
    writeJsonFileAtomic(file, { value: 1 });
    writeJsonFileAtomic(file, { value: 2 });
    expect(readJsonFile(file)).toEqual({ value: 2 });
  });

  it('returns null for missing or corrupt files', () => {
    const file = path.join(tempDir(), 'state.json');
    expect(readJsonFile(file)).toBeNull();
    fs.writeFileSync(file, '{oops');
    expect(readJsonFile(file)).toBeNull();
  });

  it('removes files without throwing when they are missing', () => {
    const file = path.join(tempDir(), 'state.json');
    writeJsonFileAtomic(file, { ok: true });
    removeFile(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeFile(file)).not.toThrow();
  });
});

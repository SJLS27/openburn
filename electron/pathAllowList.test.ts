// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_GRANTS,
  allowedPathCount,
  grantPath,
  isPathAllowed,
  isWriteTargetAllowed,
  promotePendingPath,
  resetAllowedPaths,
} from './pathAllowList';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-paths-'));
  resetAllowedPaths();
});

afterEach(() => {
  resetAllowedPaths();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pathAllowList', () => {
  it('denies everything by default', () => {
    expect(isPathAllowed('/etc/passwd')).toBe(false);
    expect(isPathAllowed('/etc/passwd', 'write')).toBe(false);
  });

  it('allows a path granted for reading, but not for writing', () => {
    const file = path.join(tmp, 'design.obrn');
    fs.writeFileSync(file, '{}');
    grantPath(file, 'read');
    expect(isPathAllowed(file, 'read')).toBe(true);
    expect(isPathAllowed(file, 'write')).toBe(false);
  });

  it('saving implies reading, because the same file comes back', () => {
    const file = path.join(tmp, 'out.nc');
    fs.writeFileSync(file, '');
    grantPath(file, 'write');
    expect(isPathAllowed(file, 'write')).toBe(true);
    expect(isPathAllowed(file, 'read')).toBe(true);
  });

  it('grants a save target that does not exist yet, so the first save works', () => {
    const file = path.join(tmp, 'new-project.obrn');
    grantPath(file, 'write');
    expect(isWriteTargetAllowed(file)).toBe(true);
  });

  it('a new file cannot be read before it exists', () => {
    const file = path.join(tmp, 'new-project.obrn');
    grantPath(file, 'write');
    expect(isPathAllowed(file, 'read')).toBe(false);
  });

  it('promotes a pending target once it has been written', () => {
    const file = path.join(tmp, 'new-project.obrn');
    grantPath(file, 'write');
    fs.writeFileSync(file, '{}');
    promotePendingPath(file);
    expect(isPathAllowed(file, 'write')).toBe(true);
    expect(isPathAllowed(file, 'read')).toBe(true);
  });

  it('does not let a pending write grant read someone else\'s file', () => {
    const file = path.join(tmp, 'elsewhere.obrn');
    fs.writeFileSync(file, 'secret');
    expect(isWriteTargetAllowed(file)).toBe(false);
    expect(isPathAllowed(file, 'read')).toBe(false);
  });

  it('normalises .. and . segments before comparing', () => {
    const file = path.join(tmp, 'a.obrn');
    fs.writeFileSync(file, '');
    grantPath(file, 'read');
    expect(isPathAllowed(path.join(tmp, 'sub', '..', 'a.obrn'), 'read')).toBe(true);
  });

  it('refuses a sibling that merely shares a prefix', () => {
    const file = path.join(tmp, 'a.obrn');
    fs.writeFileSync(file, '');
    grantPath(file, 'read');
    expect(isPathAllowed(path.join(tmp, 'a.obrn.bak'), 'read')).toBe(false);
    expect(isPathAllowed(path.join(tmp, 'other', 'a.obrn'), 'read')).toBe(false);
  });

  it('refuses empty or non-string input', () => {
    expect(isPathAllowed('')).toBe(false);
    expect(isPathAllowed('   ')).toBe(false);
    expect(isPathAllowed(undefined as unknown as string)).toBe(false);
  });

  it('does not grant a directory through a file inside it', () => {
    const dir = path.join(tmp, 'folder');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'inside.svg');
    fs.writeFileSync(file, '<svg/>');
    grantPath(file, 'read');
    expect(isPathAllowed(dir, 'read')).toBe(false);
  });

  // Regression: a symlink inside an allowed folder must not become a key to the
  // outside, because paths are compared after resolving them.
  it('resolves symlinks so they cannot escape the granted path', () => {
    const real = path.join(tmp, 'secret.txt');
    fs.writeFileSync(real, 'secret');
    const allowedFile = path.join(tmp, 'public.svg');
    fs.writeFileSync(allowedFile, '<svg/>');
    grantPath(allowedFile, 'read');

    const link = path.join(tmp, 'link.svg');
    fs.symlinkSync(real, link);
    expect(isPathAllowed(link, 'read')).toBe(false);
  });

  it('keeps the grant when a file is opened by its symlink', () => {
    const real = path.join(tmp, 'design.obrn');
    fs.writeFileSync(real, '{}');
    const link = path.join(tmp, 'link.obrn');
    fs.symlinkSync(real, link);
    grantPath(link, 'read');
    expect(isPathAllowed(real, 'read')).toBe(true);
    expect(isPathAllowed(link, 'read')).toBe(true);
  });

  it('upgrades an existing read grant to write', () => {
    const file = path.join(tmp, 'a.obrn');
    fs.writeFileSync(file, '');
    grantPath(file, 'read');
    grantPath(file, 'write');
    expect(isPathAllowed(file, 'write')).toBe(true);
  });

  it('forgets the oldest grants past MAX_GRANTS', () => {
    const files: string[] = [];
    for (let i = 0; i < MAX_GRANTS + 5; i += 1) {
      const file = path.join(tmp, `f${i}.obrn`);
      fs.writeFileSync(file, '');
      files.push(file);
      grantPath(file, 'read');
    }
    expect(allowedPathCount()).toBe(MAX_GRANTS);
    expect(isPathAllowed(files[0], 'read')).toBe(false);
    expect(isPathAllowed(files[files.length - 1], 'read')).toBe(true);
  });

  it('resetAllowedPaths revokes everything (renderer reload)', () => {
    const file = path.join(tmp, 'a.obrn');
    fs.writeFileSync(file, '');
    grantPath(file, 'read');
    resetAllowedPaths();
    expect(isPathAllowed(file, 'read')).toBe(false);
  });
});

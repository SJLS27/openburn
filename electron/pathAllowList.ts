import fs from 'node:fs';
import path from 'node:path';

/**
 * Allow-list for the main-process file IPC.
 *
 * `fs:readFile`, `fs:writeFile` and `fs:readBinary` used to accept any path the
 * renderer asked for, so a compromised renderer (a malicious SVG, a bug in the
 * importers) could read or overwrite anything the user can. Now a path is only
 * honoured when the user picked it — through a native dialog, a drag & drop or
 * the recent-files list — or when it was already opened from one of those.
 *
 * Paths are compared after `realpath`, so a symlink inside an allowed directory
 * cannot be used to reach a different file, and a file renamed on disk keeps the
 * permission it was granted.
 *
 * Kept free of Electron imports so it can be unit tested directly.
 */

export type PathKind = 'read' | 'write';

interface Grant {
  path: string;
  write: boolean;
}

/** How many grants to keep; opening files all day must not grow forever. */
export const MAX_GRANTS = 200;

const grants = new Map<string, Grant>();
const pending = new Map<string, Grant>();

/** Resolve the real path, falling back to the input if it cannot be resolved. */
function canonical(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // Missing file (a save target that does not exist yet): resolve its parent
    // instead so `..` segments still normalise away.
    try {
      const parent = fs.realpathSync(path.dirname(resolved));
      return path.join(parent, path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

/**
 * Remember a path the user chose. Every grant includes reading, because saving
 * and re-reading a project is the same file; writing needs a `write` grant.
 */
export function grantPath(filePath: string, kind: PathKind = 'read'): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return '';
  // A brand-new save target cannot be canonicalised yet: remember the resolved
  // path and promote it to a real grant the first time it is written.
  if (!fs.existsSync(filePath)) {
    const resolved = path.resolve(filePath);
    pending.set(resolved, {
      path: resolved,
      write: pending.get(resolved)?.write === true || kind === 'write',
    });
    while (pending.size > MAX_GRANTS) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      pending.delete(oldest);
    }
    return resolved;
  }
  const real = canonical(filePath);
  const write = grants.get(real)?.write === true || kind === 'write';
  grants.delete(real);
  grants.set(real, { path: real, write });

  // Oldest first: Map preserves insertion order.
  while (grants.size > MAX_GRANTS) {
    const oldest = grants.keys().next().value;
    if (oldest === undefined) break;
    grants.delete(oldest);
  }
  return real;
}

/** Whether `filePath` may be used for `kind`. */
export function isPathAllowed(filePath: string, kind: PathKind = 'read'): boolean {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return false;
  const grant = grants.get(canonical(filePath));
  if (!grant) return false;
  // Reading is part of every grant; writing needs the stronger one.
  return kind === 'read' ? true : grant.write;
}

/**
 * Resolve a save target: a file that already exists is checked like a read,
 * a new one against the pending grants (it is then promoted on the first write).
 */
export function isWriteTargetAllowed(filePath: string): boolean {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return false;
  if (fs.existsSync(filePath)) return isPathAllowed(filePath, 'write');
  const grant = pending.get(path.resolve(filePath));
  return grant?.write === true;
}

/** Promote a pending save target once it exists, so later reads see it. */
export function promotePendingPath(filePath: string): void {
  const entry = pending.get(path.resolve(filePath));
  if (!entry) return;
  pending.delete(path.resolve(filePath));
  const real = canonical(filePath);
  const write = entry.write || grants.get(real)?.write === true;
  grants.delete(real);
  grants.set(real, { path: real, write });
}

/** Number of remembered paths (tests and diagnostics). */
export function allowedPathCount(): number {
  return grants.size + pending.size;
}

/** Forget everything. Called when the window reloads and by tests. */
export function resetAllowedPaths(): void {
  grants.clear();
  pending.clear();
}

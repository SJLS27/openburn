#!/usr/bin/env node
/**
 * Verify that flatpak/node-sources.json covers every npm tarball pinned in
 * package-lock.json. The Flatpak build runs `npm ci --offline`, so any package
 * missing from the generated sources makes the offline build fail.
 *
 * Run after adding or updating dependencies:
 *   npm run check:flatpak-sources
 *
 * Regenerate the sources with flatpak-node-generator (see flatpak/README.md).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'package-lock.json');
const sourcesPath = path.join(repoRoot, 'flatpak', 'node-sources.json');

const REGISTRY_PREFIX = 'https://registry.npmjs.org/';

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[flatpak] Could not read ${path.relative(repoRoot, file)}: ${err.message}`);
    process.exit(1);
  }
}

const lock = readJson(lockPath);
const sources = readJson(sourcesPath);

if (!Array.isArray(sources)) {
  console.error('[flatpak] flatpak/node-sources.json must be a JSON array');
  process.exit(1);
}

const sourceUrls = new Set(
  sources.map((entry) => entry?.url).filter((url) => typeof url === 'string'),
);

// Lockfile v3 stores packages in `packages`; fall back to v2 `dependencies`.
const locked = new Map();
for (const [name, meta] of Object.entries(lock.packages ?? {})) {
  if (!meta?.resolved || !meta.resolved.startsWith(REGISTRY_PREFIX)) continue;
  locked.set(meta.resolved, name || meta.name || '(root)');
}

const missing = [...locked.entries()]
  .filter(([url]) => !sourceUrls.has(url))
  .map(([url, name]) => `${name} → ${url}`);

// Flatpak only ships x86_64 and aarch64, and the generator emits exactly those.
const electronVersion = lock.packages?.['node_modules/electron']?.version;
const electronPlatforms = ['linux-x64', 'linux-arm64'];
const missingElectron =
  electronVersion == null
    ? []
    : electronPlatforms.filter(
        (platform) =>
          !sourceUrls.has(
            `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-${platform}.zip`,
          ),
      );

if (missing.length || missingElectron.length) {
  console.error('[flatpak] node-sources.json is out of date.');
  if (missing.length) {
    console.error(`\nMissing ${missing.length} npm package(s):`);
    for (const entry of missing.slice(0, 40)) console.error(`  - ${entry}`);
    if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);
  }
  if (missingElectron.length) {
    console.error(
      `\nMissing Electron ${electronVersion} runtime archive(s): ${missingElectron.join(', ')}`,
    );
  }
  console.error(
    '\nRegenerate it with:\n  flatpak-node-generator npm package-lock.json -o flatpak/node-sources.json',
  );
  process.exit(1);
}

console.log(
  `[flatpak] OK — ${locked.size} npm packages and Electron ${electronVersion ?? '(n/a)'} are covered by node-sources.json`,
);

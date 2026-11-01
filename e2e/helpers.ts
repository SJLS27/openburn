import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';

/** Isolated profile so tests never read or write the developer's real config. */
export function createTestProfile(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-e2e-'));
}

export function removeTestProfile(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* the Electron process may still be releasing its profile */
  }
}

export function launchEnv(profile: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = 'production';
  env.OPENBURN_USER_DATA_DIR = profile;
  return env;
}

/** Close the start screen when it is showing. */
export async function dismissWelcome(page: Page): Promise<boolean> {
  const welcome = page.locator('.dialog-header', { hasText: 'Welcome to OpenBurn' });
  try {
    await welcome.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return false;
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await welcome.waitFor({ state: 'detached' });
  return true;
}

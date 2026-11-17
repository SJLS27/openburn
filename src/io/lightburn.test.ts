import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLightBurn, type LightBurnImportResult } from './lightburn';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8');
}

function onlyText(result: LightBurnImportResult): import('fabric').Textbox {
  const texts = result.objects.filter((o) => o.type === 'textbox');
  expect(texts).toHaveLength(1);
  return texts[0] as import('fabric').Textbox;
}

describe('parseLightBurn text import', () => {
  it('imports a text with BackupPath as an editable textbox (GitHub #1)', async () => {
    const result = await parseLightBurn(fixture('text-backuppath.lbrn2'));

    const box = onlyText(result);
    expect(box.text).toBe('ZA VEDNO V\nNAŠIH SRCIH');
    expect(box.fontSize).toBe(25);
    expect(box.fontFamily).toBe('Arial Black');
    // Outlines are kept for a lossless round-trip but do not replace the text.
    expect(result.objects.some((o) => o.type === 'path')).toBe(false);
    expect(box.get('lightburnBackupPath')).toContain('VertList');
  });

  it('imports a text without BackupPath as an editable textbox', async () => {
    const result = await parseLightBurn(fixture('text-plain.lbrn2'));

    const box = onlyText(result);
    expect(box.text).toBe('Hello');
    expect(box.fontSize).toBe(10);
    expect(box.get('lightburnBackupPath')).toBeUndefined();
  });

  it('maps Ah/Av onto textAlign and vertical anchoring', async () => {
    const aligned = onlyText(await parseLightBurn(fixture('text-align.lbrn2')));
    expect(aligned.textAlign).toBe('right');
    expect(aligned.originY).toBe('bottom');

    const plain = onlyText(await parseLightBurn(fixture('text-plain.lbrn2')));
    expect(plain.textAlign).toBe('left');
    expect(plain.originY).toBe('top');
  });

  it('reads rotation from the XForm', async () => {
    const box = onlyText(await parseLightBurn(fixture('text-rotate.lbrn2')));
    expect(box.angle).toBeCloseTo(90, 3);
  });

  it('does not wrap a single imported line', async () => {
    const box = onlyText(await parseLightBurn(fixture('text-backuppath.lbrn2')));
    expect(box.textLines).toHaveLength(2);
    expect(box.textLines[0]).toBe('ZA VEDNO V');
    expect(box.textLines[1]).toBe('NAŠIH SRCIH');
  });

  it('falls back to the backup contours when there is no string', async () => {
    const result = await parseLightBurn(fixture('text-no-string.lbrn2'));

    expect(result.objects.some((o) => o.type === 'textbox')).toBe(false);
    const paths = result.objects.filter((o) => o.type === 'path');
    expect(paths).toHaveLength(1);
  });

  it('warns when the imported font is approximated with Inter', async () => {
    const result = await parseLightBurn(fixture('text-backuppath.lbrn2'));
    expect(result.warnings.join(' ')).toMatch(/Arial Black/);

    const inter = await parseLightBurn(fixture('text-plain.lbrn2'));
    expect(inter.warnings).toHaveLength(0);
  });
});

import opentype from 'opentype.js';
import type { Textbox } from 'fabric';
import { loadBinaryAsset } from '@/core/fileApi';

const FONT_FILES = {
  regular: 'Inter-Regular.ttf',
  bold: 'Inter-Bold.ttf',
  italic: 'Inter-Italic.ttf',
  boldItalic: 'Inter-BoldItalic.ttf',
} as const;

type FontKey = keyof typeof FONT_FILES;

const cache = new Map<string, opentype.Font>();

function pickFontKey(text: Textbox): FontKey {
  const weight = String(text.fontWeight ?? '400');
  const bold = weight === 'bold' || Number.parseInt(weight, 10) >= 600;
  const italic = String(text.fontStyle ?? 'normal') === 'italic';
  if (bold && italic) return 'boldItalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

async function getFont(key: FontKey): Promise<opentype.Font> {
  const file = FONT_FILES[key];
  const cached = cache.get(file);
  if (cached) return cached;
  const buffer = await loadBinaryAsset(`fonts/${file}`);
  const font = opentype.parse(buffer);
  cache.set(file, font);
  return font;
}

const FONT_SIZE_FRACTION = 0.222;

function commandsToPathData(commands: opentype.PathCommand[], matrix: number[]): string {
  const [a, b, c, d, e, f] = matrix;
  const pt = (x: number, y: number) =>
    `${(a * x + c * y + e).toFixed(4)} ${(b * x + d * y + f).toFixed(4)}`;

  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        parts.push(`M${pt(cmd.x, cmd.y)}`);
        break;
      case 'L':
        parts.push(`L${pt(cmd.x, cmd.y)}`);
        break;
      case 'C':
        parts.push(`C${pt(cmd.x1, cmd.y1)} ${pt(cmd.x2, cmd.y2)} ${pt(cmd.x, cmd.y)}`);
        break;
      case 'Q':
        parts.push(`Q${pt(cmd.x1, cmd.y1)} ${pt(cmd.x, cmd.y)}`);
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}

/**
 * Convert a Fabric Text/Textbox into scene-space path data using the bundled
 * Inter font. The original fontFamily is approximated with Inter, matching the
 * default UI font.
 */
export async function textToScenePath(
  text: Textbox,
): Promise<{ pathData: string; fontFile: string } | null> {
  const key = pickFontKey(text);
  const font = await getFont(key);

  const lines = text.textLines ?? [];
  if (lines.length === 0) return null;

  const matrix = text.calcTransformMatrix() as unknown as number[];
  const boxWidth = text.width;
  const boxHeight = text.height;
  const fontSize = text.fontSize;
  const charSpacing = text.charSpacing ?? 0;
  const align = String(text.textAlign ?? 'left');
  const lineHeightFactor = (text as Textbox & { lineHeight?: number }).lineHeight ?? 1.16;

  const parts: string[] = [];
  let cumulative = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const implHeight =
      (text as unknown as { getHeightOfLineImpl: (i: number) => number }).getHeightOfLineImpl(i) ||
      fontSize * 1.13;
    const lineHeight = text.getHeightOfLine(i) || implHeight * lineHeightFactor;
    const baseline =
      -boxHeight / 2 + cumulative + implHeight * (1 - FONT_SIZE_FRACTION);

    const lineWidth = text.getLineWidth(i) || 0;
    let x = -boxWidth / 2;
    if (align.includes('center')) x += (boxWidth - lineWidth) / 2;
    else if (align.includes('right')) x += boxWidth - lineWidth;

    if (line.trim().length > 0) {
      const path = font.getPath(line, x, baseline, fontSize, {
        kerning: true,
        letterSpacing: charSpacing / 1000,
      });
      const data = commandsToPathData(path.commands, matrix);
      if (data) parts.push(data);
    }

    cumulative += lineHeight;
  }

  if (parts.length === 0) return null;
  return { pathData: parts.join(' '), fontFile: FONT_FILES[key] };
}

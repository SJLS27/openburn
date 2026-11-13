#!/usr/bin/env node
/**
 * Builds the graphics used by the English and Spanish READMEs:
 *
 *   docs/brand/banner.svg         hero banner (used by both READMEs)
 *   docs/brand/stack-<name>.svg   one badge per technology in the stack
 *
 * Everything is generated from the brand palette and the app logo path, so the
 * images stay consistent with the app and the site. Regenerate with
 * `npm run docs:brand`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/brand');

const BRAND = {
  bg: '#1b1d21',
  bg2: '#25282e',
  accent: '#d2691e',
  accentLight: '#ffb066',
  text: '#f4f5f6',
  muted: '#aeb4bc',
  dim: '#7f8791',
};

/** Same outline as public/favicon.svg, in a 0–64 box. */
const FLAME =
  'M32 8c4.3 8.6.8 12.6-2.4 16.4-3.2 3.8-6.4 7.5-3.2 13.4 0-3.7 2.4-5.9 4.8-8 ' +
  '.5 2.9 2.1 5.1 4.3 6.7 2.4 1.8 3.2 4 1.9 7 5.9-3.2 9.4-8.8 9.4-15.3 0-9.7-6.7-16.6-14.8-20.2Z';

const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Badge glyphs, drawn on a 24 × 24 grid with the brand colour of each project
 * (text glyphs where the mark is lettering, like TypeScript).
 */
const MARKS = {
  electron: {
    color: '#9feaf9',
    body: `<circle cx="12" cy="12" r="2.2" fill="#9feaf9"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#9feaf9" stroke-width="1.2"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#9feaf9" stroke-width="1.2" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#9feaf9" stroke-width="1.2" transform="rotate(120 12 12)"/>`,
  },
  react: {
    color: '#61dafb',
    body: `<circle cx="12" cy="12" r="2" fill="#61dafb"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#61dafb" stroke-width="1.2"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#61dafb" stroke-width="1.2" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="10" ry="4.1" fill="none" stroke="#61dafb" stroke-width="1.2" transform="rotate(120 12 12)"/>`,
  },
  typescript: {
    color: '#3178c6',
    body: `<rect x="2" y="2" width="20" height="20" rx="3" fill="#3178c6"/>
      <text x="12" y="17" text-anchor="middle" font-family="Inter, 'Segoe UI', sans-serif" font-size="11" font-weight="800" fill="#ffffff">TS</text>`,
  },
  vite: {
    color: '#a259ff',
    body: `<path d="M12 1.6 1.6 4.4 12 22.4 22.4 4.4 12 1.6Z" fill="#a259ff"/>
      <path d="M12.4 6.2h4.2l-3.1 7.1h2.3l-5.8 7.9 1.7-6.1h-2.4l3.1-8.9Z" fill="#ffe2a8"/>`,
  },
  fabric: {
    color: '#f7a1c4',
    body: `<rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="#f7a1c4" stroke-width="2"/>
      <path d="M3 9h18M9 3v18" stroke="#f7a1c4" stroke-width="1.4" stroke-opacity="0.75"/>`,
  },
  paper: {
    color: '#7dcf5a',
    body: `<path d="M3 20 12 3l9 17H3Z" fill="none" stroke="#7dcf5a" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8.5 15h7" stroke="#7dcf5a" stroke-width="1.6"/>`,
  },
  grbl: {
    color: '#7ee787',
    body: `<path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7L12 2.2Z" fill="none" stroke="#7ee787" stroke-width="2" stroke-linejoin="round"/>
      <path d="M9 8v8M9 8h4.2a2.4 2.4 0 0 1 0 4.8H9M13 12.8l3 3.2" fill="none" stroke="#7ee787" stroke-width="1.6" stroke-linecap="round"/>`,
  },
  serial: {
    color: '#60c3f0',
    body: `<path d="M2.5 12h19M6.5 7 2.5 12l4 5M17.5 7l4 5-4 5" fill="none" stroke="#60c3f0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  offline: {
    color: '#e0b84a',
    body: `<circle cx="12" cy="12" r="9" fill="none" stroke="#e0b84a" stroke-width="2"/>
      <path d="M12 6.5V13l4 2.6" fill="none" stroke="#e0b84a" stroke-width="2" stroke-linecap="round"/>`,
  },
};

const STACK = [
  { id: 'electron', label: 'Electron' },
  { id: 'react', label: 'React 18' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'vite', label: 'Vite' },
  { id: 'fabric', label: 'Fabric.js' },
  { id: 'paper', label: 'Paper.js' },
  { id: 'grbl', label: 'GRBL' },
  { id: 'serial', label: 'Web Serial' },
  { id: 'offline', label: 'Runs offline' },
];

function badge({ id, label }) {
  const mark = MARKS[id];
  const width = Math.round(56 + label.length * 8.4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="32" viewBox="0 0 ${width} 32" role="img" aria-label="${escape(label)}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="31" rx="8" fill="${BRAND.bg2}" stroke="#3a3e45"/>
  <g transform="translate(9 6) scale(0.83)">${mark.body}</g>
  <text x="38" y="21" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="600" fill="${BRAND.text}">${escape(label)}</text>
</svg>
`;
}

function banner() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="360" viewBox="0 0 1280 360" role="img" aria-label="OpenBurn — open-source laser cutting and engraving software">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.bg}"/>
      <stop offset="0.55" stop-color="${BRAND.bg2}"/>
      <stop offset="1" stop-color="${BRAND.bg}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${BRAND.accent}" stop-opacity="0.55"/>
      <stop offset="0.6" stop-color="${BRAND.accent}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${BRAND.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND.accentLight}"/>
      <stop offset="0.55" stop-color="#e07a2c"/>
      <stop offset="1" stop-color="#b84d12"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BRAND.accent}"/>
      <stop offset="1" stop-color="${BRAND.accent}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1280" height="360" fill="url(#bg)"/>
  <rect width="1280" height="360" fill="url(#grid)"/>
  <circle cx="215" cy="180" r="230" fill="url(#glow)"/>

  <g transform="translate(96 78) scale(3.4)">
    <path d="${FLAME}" fill="url(#flame)"/>
  </g>

  <text x="336" y="178" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="78" font-weight="800" fill="${BRAND.text}" letter-spacing="0.5">OpenBurn</text>
  <text x="340" y="222" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="24" fill="${BRAND.muted}">Open-source laser cutting &amp; engraving software</text>
  <text x="340" y="264" font-family="'JetBrains Mono', 'Fira Code', monospace" font-size="15" fill="${BRAND.dim}" letter-spacing="1.3">GRBL CONTROL · LIGHTBURN .LBRN2 FILES · ANIMATED PREVIEW</text>

  <rect x="340" y="290" width="104" height="4" rx="2" fill="${BRAND.accent}"/>
  <rect x="452" y="290" width="72" height="4" rx="2" fill="url(#rule)"/>
  <text x="540" y="296" font-family="Inter, sans-serif" font-size="13" fill="#6f7680">Windows · macOS · Linux · MIT</text>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'banner.svg'), banner());
console.log('docs/brand/banner.svg');
for (const entry of STACK) {
  writeFileSync(path.join(OUT, `stack-${entry.id}.svg`), badge(entry));
  console.log(`docs/brand/stack-${entry.id}.svg`);
}

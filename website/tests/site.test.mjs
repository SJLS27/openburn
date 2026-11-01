import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = (path) => readFile(new URL(path, dist), 'utf8');
const exists = (path) => access(new URL(path, dist));

const pages = [
  'index.html',
  'features/index.html',
  'download/index.html',
  'open-source-lightburn-alternative/index.html',
  'privacy/index.html',
  'support/index.html',
  '404.html',
  'es/index.html',
  'es/funciones/index.html',
  'es/descargas/index.html',
  'es/alternativa-lightburn/index.html',
  'es/privacidad/index.html',
  'es/apoyar/index.html',
];

test('every page is generated', async () => {
  for (const page of pages) {
    await exists(page);
  }
});

test('English home has complete SEO metadata', async () => {
  const html = await read('index.html');

  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>OpenBurn — Open-source laser cutting &amp; engraving software<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openburn\.pages\.dev\/">/);
  assert.match(html, /hreflang="en" href="https:\/\/openburn\.pages\.dev\/"/);
  assert.match(html, /hreflang="es" href="https:\/\/openburn\.pages\.dev\/es\/"/);
  assert.match(html, /hreflang="x-default"/);
  assert.match(html, /property="og:image" content="https:\/\/openburn\.pages\.dev\/og-image\.png"/);
  assert.match(html, /"@type":"SoftwareApplication"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});

test('Spanish pages are localised and cross-linked', async () => {
  const html = await read('es/index.html');

  assert.match(html, /<html lang="es">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openburn\.pages\.dev\/es\/">/);
  assert.match(html, /hreflang="en" href="https:\/\/openburn\.pages\.dev\/"/);
  assert.match(html, /hreflang="es" href="https:\/\/openburn\.pages\.dev\/es\/"/);
  assert.match(html, /Software libre de corte y grabado láser/);
});

test('support actions point to the configured PayPal account', async () => {
  const home = await read('index.html');
  const support = await read('support/index.html');
  const supportEs = await read('es/apoyar/index.html');

  assert.match(home, /https:\/\/paypal\.me\/openburn/);
  assert.match(support, /https:\/\/paypal\.me\/openburn/);
  assert.match(supportEs, /https:\/\/paypal\.me\/openburn/);
});

test('Google Search Console verification file is published', async () => {
  const body = await read('google4d7ccb5ea511907c.html');
  assert.match(body, /^google-site-verification: google4d7ccb5ea511907c\.html$/);

  const redirects = await read('_redirects');
  assert.match(
    redirects,
    /\/google4d7ccb5ea511907c\.html\s+\/google-verify\.txt\s+200/,
  );
});

test('the 404 page is not indexable', async () => {
  const html = await read('404.html');
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test('sitemap, robots and social card exist', async () => {
  const sitemapIndex = await read('sitemap-index.xml');
  assert.match(sitemapIndex, /sitemap-0\.xml/);

  const sitemap = await read('sitemap-0.xml');
  assert.match(sitemap, /https:\/\/openburn\.pages\.dev\/features\//);
  assert.match(sitemap, /https:\/\/openburn\.pages\.dev\/es\/funciones\//);
  assert.match(sitemap, /https:\/\/openburn\.pages\.dev\/support\//);

  const robots = await read('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/openburn\.pages\.dev\/sitemap-index\.xml/);

  await exists('og-image.png');
  await exists('fonts/inter-latin.woff2');
});

test('every referenced screenshot and local asset exists', async () => {
  for (const page of pages) {
    const html = await read(page);
    const assets = new Set();

    for (const match of html.matchAll(/\/(?:screenshots\/[a-z-]+-\d+\.webp|fonts\/[a-z-]+\.woff2|og-image\.png|favicon\.(?:svg|ico)|icon\.png|apple-touch-icon\.png)/g)) {
      assets.add(match[0].slice(1));
    }

    for (const asset of assets) {
      await exists(asset);
    }
  }
});

test('internal navigation targets exist', async () => {
  const routes = new Set([
    '/',
    '/features/',
    '/download/',
    '/open-source-lightburn-alternative/',
    '/privacy/',
    '/support/',
    '/es/',
    '/es/funciones/',
    '/es/descargas/',
    '/es/alternativa-lightburn/',
    '/es/privacidad/',
    '/es/apoyar/',
  ]);

  for (const page of pages) {
    const html = await read(page);
    for (const match of html.matchAll(/href="(\/(?!\/)[^"#]*)"/g)) {
      const href = match[1];
      if (href.startsWith('/_astro/') || href.startsWith('/screenshots/') || href.startsWith('/fonts/')) continue;
      if (
        href.endsWith('.xml') ||
        href.endsWith('.txt') ||
        href.endsWith('.png') ||
        href.endsWith('.svg') ||
        href.endsWith('.ico')
      ) {
        continue;
      }
      assert.ok(routes.has(href), `Unknown internal link ${href} in ${page}`);
    }
  }
});

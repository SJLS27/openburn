import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = 'https://openburn.pages.dev';
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
);

const localePairs = [
  ['/', '/es/'],
  ['/features/', '/es/funciones/'],
  ['/download/', '/es/descargas/'],
  ['/open-source-lightburn-alternative/', '/es/alternativa-lightburn/'],
  ['/privacy/', '/es/privacidad/'],
  ['/support/', '/es/apoyar/'],
];

const alternates = new Map();
for (const [en, es] of localePairs) {
  const links = [
    { lang: 'en', url: `${site}${en}` },
    { lang: 'es', url: `${site}${es}` },
    { lang: 'x-default', url: `${site}${en}` },
  ];
  alternates.set(`${site}${en}`, links);
  alternates.set(`${site}${es}`, links);
}

export default defineConfig({
  site,
  trailingSlash: 'always',
  compressHTML: true,
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      serialize(item) {
        const links = alternates.get(item.url);
        if (links) item.links = links;
        return item;
      },
    }),
  ],
  build: {
    format: 'directory',
  },
});

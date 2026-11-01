import { en } from './en';
import { es } from './es';
import type { Lang, SiteContent } from './types';

export function getContent(lang: Lang): SiteContent {
  return lang === 'es' ? es : en;
}

export type { Lang, SiteContent };

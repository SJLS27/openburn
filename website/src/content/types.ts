export type Lang = 'en' | 'es';

export type IconName =
  | 'vector'
  | 'layers'
  | 'preview'
  | 'machine'
  | 'test'
  | 'image'
  | 'text'
  | 'route'
  | 'file'
  | 'update'
  | 'check'
  | 'plus'
  | 'cross'
  | 'partial'
  | 'windows'
  | 'apple'
  | 'linux'
  | 'github'
  | 'download'
  | 'arrow'
  | 'copy'
  | 'shield'
  | 'code'
  | 'offline'
  | 'spark'
  | 'heart'
  | 'menu'
  | 'close'
  | 'external';

export interface Meta {
  title: string;
  description: string;
}

export interface NavContent {
  features: string;
  download: string;
  docs: string;
  github: string;
  openMenu: string;
  closeMenu: string;
  switchTo: string;
}

export interface FooterContent {
  tagline: string;
  product: { title: string; links: { label: string; href: string }[] };
  resources: { title: string; links: { label: string; href: string }[] };
  community: { title: string; links: { label: string; href: string }[] };
  license: string;
  disclaimer: string;
  madeWith: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  accent: string;
  lead: string;
  primary: string;
  secondary: string;
  note: string;
  imageAlt: string;
}

export interface SectionHead {
  eyebrow: string;
  title: string;
  lead: string;
}

export interface FeatureItem {
  icon: IconName;
  title: string;
  body: string;
}

export interface ShowcaseTab {
  id: string;
  label: string;
  title: string;
  body: string;
  image: string;
  alt: string;
}

export type CellState = 'yes' | 'no' | 'partial' | 'text';

export interface CompareCell {
  text: string;
  state: CellState;
}

export interface CompareRow {
  label: string;
  openburn: CompareCell;
  lightburn: CompareCell;
}

export interface DownloadCard {
  os: 'windows' | 'macos' | 'linux';
  icon: IconName;
  title: string;
  file: string;
  meta: string;
  note: string;
  href: string;
  cta: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface StepItem {
  title: string;
  body: string;
}

export interface CtaContent {
  title: string;
  lead: string;
  primary: string;
  secondary: string;
}

export interface SupportBandContent {
  title: string;
  body: string;
  paypal: string;
  more: string;
}

export interface SupportPageContent {
  hero: SectionHead;
  reasonsTitle: string;
  paypalCta: string;
  reasons: FeatureItem[];
  ways: {
    title: string;
    lead: string;
    items: {
      icon: IconName;
      title: string;
      body: string;
      cta: string;
      href: string;
    }[];
  };
  transparency: { title: string; paragraphs: string[]; note: string };
  cta: CtaContent;
}

export interface HomeContent {
  hero: HeroContent;
  trust: string[];
  features: SectionHead & { items: FeatureItem[] };
  showcase: SectionHead & { tabs: ShowcaseTab[] };
  comparison: SectionHead & {
    note: string;
    headers: { openburn: string; lightburn: string };
    rows: CompareRow[];
  };
  downloads: SectionHead & {
    allReleases: string;
    recommended: string;
    cards: DownloadCard[];
  };
  steps: SectionHead & {
    items: StepItem[];
    dev: { title: string; body: string; code: string };
  };
  faq: SectionHead & { items: FaqItem[] };
  support: SupportBandContent;
  cta: CtaContent;
}

export interface FeaturesPageContent {
  hero: SectionHead;
  grid: SectionHead & { items: FeatureItem[] };
  cta: CtaContent;
}

export interface DownloadPageContent {
  hero: SectionHead;
  requirements: { title: string; items: string[] };
  install: {
    title: string;
    lead: string;
    items: { title: string; body: string; code?: string }[];
  };
  dev: { title: string; body: string; code: string; note: string };
  cta: CtaContent;
}

export interface AlternativePageContent {
  hero: SectionHead;
  cards: FeatureItem[];
  comparison: SectionHead & {
    note: string;
    headers: { openburn: string; lightburn: string };
    rows: CompareRow[];
  };
  migration: { title: string; lead: string; items: StepItem[] };
  limits: { title: string; lead: string; items: string[] };
  faq: { title: string; items: FaqItem[] };
  cta: CtaContent;
}

export interface PrivacyPageContent {
  hero: SectionHead;
  updated: string;
  sections: { title: string; paragraphs: string[] }[];
}

export interface NotFoundContent {
  title: string;
  lead: string;
  home: string;
  download: string;
}

export interface UiContent {
  skipToContent: string;
  recommended: string;
  copy: string;
  copied: string;
  version: string;
  license: string;
  docs: string;
  changelog: string;
  roadmap: string;
  contributing: string;
  issues: string;
  releases: string;
  source: string;
  privacy: string;
  features: string;
  download: string;
  home: string;
  notAffiliated: string;
  allReleases: string;
  readGuide: string;
  openExternal: string;
}

export interface SiteContent {
  lang: Lang;
  locale: string;
  meta: {
    home: Meta;
    features: Meta;
    download: Meta;
    alternative: Meta;
    privacy: Meta;
    support: Meta;
    notFound: Meta;
  };
  nav: NavContent;
  footer: FooterContent;
  ui: UiContent;
  home: HomeContent;
  featuresPage: FeaturesPageContent;
  downloadPage: DownloadPageContent;
  alternativePage: AlternativePageContent;
  privacyPage: PrivacyPageContent;
  supportPage: SupportPageContent;
  notFound: NotFoundContent;
}

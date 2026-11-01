/**
 * Set to true once https://github.com/sponsors/SJLS27 shows your sponsor tiers.
 * Until then the site uses the one-off sponsorship issue as the primary action,
 * so no visitor lands on a profile page instead of a checkout.
 */
export const githubSponsorsEnabled = false;

/**
 * Set to true after creating https://openburn.goatcounter.com.
 * Until the account exists the script returns 404 and hurts Lighthouse.
 */
export const goatcounterEnabled = false;

export const links = {
  github: 'https://github.com/SJLS27/openburn',
  paypal: 'https://paypal.me/openburn',
  githubSponsors: 'https://github.com/sponsors/SJLS27',
  sponsorshipIssue:
    'https://github.com/SJLS27/openburn/issues/new?labels=sponsorship&title=Sponsorship%20inquiry',
  releases: 'https://github.com/SJLS27/openburn/releases',
  latest: 'https://github.com/SJLS27/openburn/releases/latest',
  issues: 'https://github.com/SJLS27/openburn/issues',
  docs: 'https://github.com/SJLS27/openburn/tree/main/docs',
  changelog: 'https://github.com/SJLS27/openburn/blob/main/CHANGELOG.md',
  roadmap: 'https://github.com/SJLS27/openburn/blob/main/TODO.md',
  contributing: 'https://github.com/SJLS27/openburn/blob/main/CONTRIBUTING.md',
  license: 'https://github.com/SJLS27/openburn/blob/main/LICENSE',
  flatpak: 'https://github.com/SJLS27/openburn/tree/main/flatpak',
  fileFormats: 'https://github.com/SJLS27/openburn/blob/main/docs/FILE-FORMATS.md',
  architecture: 'https://github.com/SJLS27/openburn/blob/main/docs/ARCHITECTURE.md',
} as const;

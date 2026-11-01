# OpenBurn website

Marketing site for [OpenBurn](https://github.com/SJLS27/openburn), built with
[Astro](https://astro.build) as a fully static site.

- **Production:** <https://openburn.pages.dev>
- **Hosting:** Cloudflare Pages (free plan)
- **Languages:** English (default, `/`) and Spanish (`/es/`)
- **Analytics:** GoatCounter (cookieless)

## Local development

```bash
cd website
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # preview the production build
npm run check    # Astro + TypeScript checks
npm test         # smoke tests against dist/ (run after build)
```

## Structure

```
website/
├─ src/
│  ├─ layouts/Base.astro        # head, SEO, JSON-LD, header/footer
│  ├─ components/               # Hero, Features, Showcase, Downloads…
│  ├─ content/en.ts, es.ts      # all copy, typed by content/types.ts
│  ├─ pages/                    # EN pages (incl. support.astro)
│  │  └─ es/                    # Spanish pages (incl. apoyar.astro)
│  └─ styles/global.css         # design tokens + components
├─ public/
│  ├─ screenshots/              # responsive WebP (800/1200/1600)
│  ├─ fonts/inter-latin.woff2   # self-hosted variable subset
│  ├─ og-image.png              # 1200×630 social card
│  ├─ robots.txt
│  └─ _headers                  # CSP + cache rules (Cloudflare Pages)
└─ tests/site.test.mjs
```

## Content

All copy lives in `src/content/en.ts` and `src/content/es.ts`. Both files must
satisfy `SiteContent` in `src/content/types.ts`, so adding a field to one
language fails the type check until the other is updated too.

Screenshots are generated from `../docs/screenshots/*.png`:

```bash
for f in ../docs/screenshots/*.png; do
  n=$(basename "$f" .png)
  for w in 800 1200 1600; do
    magick "$f" -resize "${w}x" -quality 82 "public/screenshots/${n}-${w}.webp"
  done
done
```

## Deploy to Cloudflare Pages (free)

**Current deployment:** <https://openburn.pages.dev> — a **direct-upload**
Pages project named `openburn`, deployed with Wrangler from this machine.

Deploy an update after changing the site:

```bash
# from the repository root
npm run site:deploy

# or from website/
npm run build
npm run deploy
```

Both commands assume `npx wrangler login` has been run once. The project is
direct-upload, so a git push does **not** redeploy automatically. If you want
auto-deploy on push, create a token with **Account → Cloudflare Pages → Edit**
and add a GitHub Actions workflow with `cloudflare/wrangler-action`, or create a
new Git-connected Pages project.

### Alternative: Git-connected project

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Select `SJLS27/openburn`, branch `main`.
3. Build settings:
   - **Root directory:** `website`
   - **Build command:** `npm ci && npm run build`
   - **Output directory:** `dist`
   - **Environment variables:** `NODE_VERSION=22`
4. Deploy. Every push to `main` that touches the site redeploys it.

If the project slug differs, update `site` in `astro.config.mjs`, `robots.txt`,
`tests/site.test.mjs` and the deploy scripts accordingly.

## After the first deploy

- [ ] Set the repository **Website** field to `https://openburn.pages.dev` and
      add the topics `laser`, `lightburn`, `grbl`, `electron`.
- [ ] Add the URL to the README, release notes and Flathub/AlternativeTo
      listings.
- [ ] Verify the site in Google Search Console (below) and request indexing.
- [ ] Import the property into Bing Webmaster Tools.
- [ ] Create the GoatCounter account.
- [ ] Enroll in GitHub Sponsors and set `githubSponsorsEnabled = true`.
- [ ] Open `https://paypal.me/openburn` in a private window and confirm the
      amount/currency shown is the one you expect.
- [ ] Check `https://openburn.pages.dev/robots.txt`, `/sitemap-index.xml` and a
      random 404 URL.

## Google Search Console (free)

1. Open <https://search.google.com/search-console> and add a **URL prefix**
   property for `https://openburn.pages.dev/`.
2. Verify with the HTML tag method: copy the `content` value and set it as
   `PUBLIC_GOOGLE_SITE_VERIFICATION` in Cloudflare Pages → Settings →
   Environment variables, then redeploy. The `<meta>` tag is rendered
   automatically. The HTML file method also works: drop the file in
   `website/public/` and redeploy.
3. Submit `https://openburn.pages.dev/sitemap-index.xml` under **Sitemaps**.
4. Use **URL Inspection → Request indexing** for `/`, `/features/`,
   `/download/`, `/open-source-lightburn-alternative/` and their `/es/`
   equivalents.
5. Repeat in Bing Webmaster Tools (it can import the property from Search
   Console) using `PUBLIC_BING_SITE_VERIFICATION`.

> **Verified on 1 November 2026** with the HTML file method. The file is
> `public/google4d7ccb5ea511907c.html`. Cloudflare Pages redirects `.html`
> requests to the extensionless path, so `public/_redirects` serves the exact
> URL with a `200` from `public/google-verify.txt`. Do not delete either file or
> the verification will be revoked.

## GoatCounter

The script is intentionally **disabled** while the account does not exist
(`goatcounterEnabled = false` in `src/content/links.ts`); otherwise the 404
request hurts Lighthouse and logs console errors. Create a free account at
<https://www.goatcounter.com> with the code `openburn`, set the flag to `true`
and redeploy. The CSP in `public/_headers` already allows
`https://gc.zgo.at` and `https://openburn.goatcounter.com`.

## Support / sponsorship

The site deliberately has **no ads, no trackers and no third-party scripts**.
Funding is handled with plain outbound links:

- **PayPal** — `links.paypal` (`https://paypal.me/openburn`). This is the
  primary action today and appears in the home band and the support page.
- **One-off sponsorship** — a GitHub issue with the `sponsorship` label
  (`links.sponsorshipIssue`) for companies and larger contributions.
- **GitHub Sponsors** — ready but hidden behind
  `githubSponsorsEnabled = false` in `src/content/links.ts`. Enroll at
  <https://github.com/sponsors/accounts>, then flip the flag to `true`; the
  sponsor card and the main CTA appear automatically.
- **Free support** — starring the repo and contributing.

To add Ko-fi, Open Collective or a direct sponsor, put the URL in
`src/content/links.ts` and add a card to `supportPage.ways.items` in both
`src/content/en.ts` and `src/content/es.ts`. No CSP change is needed because
these are ordinary links. `.github/FUNDING.yml` adds the Sponsor button to the
repository.

## Credits

- **Inter** font: SIL Open Font License 1.1 —
  [`public/fonts/Inter-LICENSE.txt`](public/fonts/Inter-LICENSE.txt).
- **Screenshots** and logo: part of the OpenBurn project (MIT).

## Preview image

`public/og-image.png` is a 1200×630 card used for Open Graph, Twitter and the
`SoftwareApplication` schema. Regenerate it with the source assets in
`docs/screenshots/` if the branding changes.

import type { SiteContent } from './types';
import { links } from './links';

export const en: SiteContent = {
  lang: 'en',
  locale: 'en_US',
  meta: {
    home: {
      title: 'OpenBurn — Open-source laser cutting & engraving software',
      description:
        'Free, open-source laser cutting and engraving software for GRBL. Design, preview and control your laser, with LightBurn .lbrn/.lbrn2 support.',
    },
    features: {
      title: 'Features — OpenBurn laser software',
      description:
        'Vector design, LightBurn-style cut layers, animated preview, GRBL control, material and kerf tests, image tracing and .lbrn/.lbrn2 compatibility.',
    },
    download: {
      title: 'Download OpenBurn for Windows, macOS & Linux',
      description:
        'Download the latest OpenBurn build. Free, MIT-licensed laser software for Windows, macOS and Linux. No account, no license key.',
    },
    alternative: {
      title: 'Open-source LightBurn alternative — OpenBurn',
      description:
        'A free, open-source alternative to LightBurn. Open and export .lbrn/.lbrn2 projects, control GRBL machines and keep your workflow without a license fee.',
    },
    privacy: {
      title: 'Privacy — OpenBurn',
      description:
        'How OpenBurn handles privacy: no account, no telemetry in the desktop app, no cookies and cookieless aggregate analytics on this website.',
    },
    support: {
      title: 'Support OpenBurn — open source, no ads',
      description:
        'Sponsor OpenBurn and keep it free, independent and ad-free. Funding goes to code signing, test hardware, hosting and documentation.',
    },
    notFound: {
      title: 'Page not found — OpenBurn',
      description: 'The page you are looking for does not exist.',
    },
  },
  nav: {
    features: 'Features',
    download: 'Download',
    docs: 'Docs',
    github: 'GitHub',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    switchTo: 'Español',
  },
  footer: {
    tagline:
      'Open-source laser cutting and engraving software. Design, preview and control your machine without a license.',
    product: {
      title: 'Product',
      links: [
        { label: 'Features', href: '/features/' },
        { label: 'Download', href: '/download/' },
        { label: 'Changelog', href: links.changelog },
        { label: 'Roadmap', href: links.roadmap },
      ],
    },
    resources: {
      title: 'Resources',
      links: [
        { label: 'Documentation', href: links.docs },
        { label: 'File formats', href: links.fileFormats },
        { label: 'Architecture', href: links.architecture },
        { label: 'Releases', href: links.releases },
      ],
    },
    community: {
      title: 'Community',
      links: [
        { label: 'GitHub', href: links.github },
        { label: 'Issues', href: links.issues },
        { label: 'Contributing', href: links.contributing },
        { label: 'Support', href: '/support/' },
        { label: 'License', href: links.license },
      ],
    },
    license: 'MIT licensed · © 2026 Santiago Leal (SJLS27)',
    disclaimer:
      'OpenBurn is not affiliated with LightBurn Software Inc. LightBurn is a trademark of its respective owner.',
    madeWith: 'Made with coffee and far too many laser passes.',
  },
  ui: {
    skipToContent: 'Skip to content',
    recommended: 'Recommended for your system',
    copy: 'Copy',
    copied: 'Copied',
    version: 'Version',
    license: 'MIT licensed',
    docs: 'Documentation',
    changelog: 'Changelog',
    roadmap: 'Roadmap',
    contributing: 'Contributing',
    issues: 'Issue tracker',
    releases: 'Releases',
    source: 'Source code',
    privacy: 'Privacy',
    features: 'Features',
    download: 'Download',
    home: 'Home',
    notAffiliated:
      'OpenBurn is an independent open-source project, not affiliated with LightBurn Software Inc.',
    allReleases: 'All releases',
    readGuide: 'Read the guide',
    openExternal: 'Opens in a new tab',
  },
  home: {
    hero: {
      eyebrow: 'Open source · MIT · Windows, macOS & Linux',
      title: 'Your laser. Your software.',
      accent: 'No licenses.',
      lead:
        'OpenBurn is a free, open-source studio for laser cutting and engraving. Design, set cut layers, preview every path and drive your GRBL machine — with full .lbrn/.lbrn2 compatibility.',
      primary: 'Download for free',
      secondary: 'View on GitHub',
      note: 'No account · No telemetry · Works offline',
      imageAlt:
        'OpenBurn editor showing vector shapes, the Cuts / Layers panel and the laser connection panel',
    },
    trust: [
      'MIT licensed',
      'Windows · macOS · Linux',
      'GRBL & Web Serial',
      'Opens & writes .lbrn/.lbrn2',
      'Runs fully offline',
    ],
    features: {
      eyebrow: 'The whole workflow',
      title: 'A complete studio, not a demo',
      lead:
        'Draw, set cuts, preview and send to the machine. No subscriptions, no feature gates, no account.',
      items: [
        {
          icon: 'vector',
          title: 'Vector design that keeps up',
          body:
            'Lines, shapes, text, booleans, offset, node editing and grouping — with snapping, guides and precise numeric entry.',
        },
        {
          icon: 'layers',
          title: 'Cut layers, the way you know them',
          body:
            'A Cuts / Layers table with Line, Fill, Offset Fill and Image modes, speed and power, passes, interval and per-layer kerf.',
        },
        {
          icon: 'preview',
          title: 'Animated preview',
          body:
            'Scrub through the job, watch the laser head travel and get a time estimate and per-layer statistics before you burn anything.',
        },
        {
          icon: 'machine',
          title: 'GRBL control built in',
          body:
            'Connect over Web Serial or use the built-in simulator. Frame, start, pause, resume, jog, home and set origin.',
        },
        {
          icon: 'test',
          title: 'Material, interval, focus and kerf tests',
          body:
            'Generate real calibration matrices with one layer per cell, then save the results to a reusable material library.',
        },
        {
          icon: 'image',
          title: 'Images, adjusted and traced',
          body:
            'Brightness, contrast, gamma, levels and curves; ten dithering modes; one-click vector tracing with a live preview.',
        },
      ],
    },
    showcase: {
      eyebrow: 'See it in action',
      title: 'Every cut, previewed before it happens',
      lead:
        'Real screenshots of the app, not mockups. Click through the workflow from design to machine.',
      tabs: [
        {
          id: 'preview',
          label: 'Preview',
          title: 'See the job before it starts',
          body:
            'Every path, every travel move and the animated laser head. Check the estimated time and per-layer statistics, then start with confidence.',
          image: 'preview',
          alt: 'Animated trajectory preview with the laser head, timeline and per-layer statistics',
        },
        {
          id: 'layers',
          label: 'Cuts & Layers',
          title: 'Layers that map to real cuts',
          body:
            'A LightBurn-style table with mode, speed, power, passes, interval and output toggles — plus a full cut settings editor for advanced options.',
          image: 'overview',
          alt: 'OpenBurn editor with the Cuts / Layers table, colour palette and laser panel',
        },
        {
          id: 'material',
          label: 'Material test',
          title: 'Dial in any material',
          body:
            'Generate a power × speed matrix with real sublayers, run the job and keep the winning settings in your material library.',
          image: 'material-test',
          alt: 'Material test matrix with power and speed labels engraved on a sheet',
        },
        {
          id: 'lightburn',
          label: 'LightBurn files',
          title: 'Your .lbrn2 files are welcome',
          body:
            'Open and export LightBurn projects with layers, groups, cut settings, text backup paths and bitmaps. Migrate without losing your library.',
          image: 'lightburn',
          alt: 'Import and export of LightBurn .lbrn and .lbrn2 project files',
        },
        {
          id: 'image',
          label: 'Image tools',
          title: 'From photo to engraving',
          body:
            'Adjust levels and curves, pick a dithering mode, then trace the image into editable vectors with a preview before you apply.',
          image: 'image-tools',
          alt: 'Adjust Image dialog with brightness, contrast, gamma and live grayscale preview',
        },
        {
          id: 'focus',
          label: 'Focus test',
          title: 'Find the perfect focus',
          body:
            'Run a Z ramp with labelled steps, then apply the measured offset per object. Kerf and interval tests complete the calibration set.',
          image: 'focus-test',
          alt: 'Focus test with a Z-axis ramp and labelled focus steps',
        },
      ],
    },
    comparison: {
      eyebrow: 'Honest comparison',
      title: 'How it compares to LightBurn',
      lead:
        'LightBurn is a mature, excellent product. OpenBurn is a free, open-source alternative that already covers the core workflow — and we are upfront about what is still missing.',
      headers: { openburn: 'OpenBurn', lightburn: 'LightBurn' },
      rows: [
        {
          label: 'Price',
          openburn: { text: 'Free, forever', state: 'yes' },
          lightburn: { text: 'Paid license', state: 'text' },
        },
        {
          label: 'Source code',
          openburn: { text: 'Open (MIT)', state: 'yes' },
          lightburn: { text: 'Closed', state: 'no' },
        },
        {
          label: 'Platforms',
          openburn: { text: 'Windows, macOS & Linux', state: 'yes' },
          lightburn: { text: 'Windows & macOS (Linux beta)', state: 'partial' },
        },
        {
          label: '.lbrn / .lbrn2 files',
          openburn: { text: 'Read & write', state: 'yes' },
          lightburn: { text: 'Native format', state: 'yes' },
        },
        {
          label: 'GRBL control',
          openburn: { text: 'Yes, plus simulator', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Animated preview',
          openburn: { text: 'Yes', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Material, interval & kerf tests',
          openburn: { text: 'Yes', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Image tracing',
          openburn: { text: 'Yes', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Ruida / DSP controllers',
          openburn: { text: 'On the roadmap', state: 'partial' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Cameras & Print & Cut',
          openburn: { text: 'On the roadmap', state: 'partial' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Code-signed installers',
          openburn: { text: 'Not yet', state: 'no' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
      ],
      note:
        'Based on publicly documented features as of 2026. LightBurn is a trademark of LightBurn Software Inc. OpenBurn is not affiliated with, endorsed by or sponsored by LightBurn.',
    },
    downloads: {
      eyebrow: 'Download',
      title: 'Pick your platform',
      lead:
        'Download the latest build from GitHub Releases. Every release is built by CI on Windows, macOS and Linux.',
      allReleases: 'All releases, checksums and source code on GitHub',
      recommended: 'Recommended for your system',
      cards: [
        {
          os: 'windows',
          icon: 'windows',
          title: 'Windows',
          file: 'Installer · .exe',
          meta: 'Windows 10 & 11 · x64',
          note: 'Unsigned build: SmartScreen may ask you to confirm.',
          href: links.latest,
          cta: 'Download for Windows',
        },
        {
          os: 'macos',
          icon: 'apple',
          title: 'macOS',
          file: 'Disk image · .dmg',
          meta: 'Apple Silicon & Intel · macOS 11+',
          note: 'Unsigned build: right-click → Open the first time.',
          href: links.latest,
          cta: 'Download for macOS',
        },
        {
          os: 'linux',
          icon: 'linux',
          title: 'Linux',
          file: 'AppImage · .AppImage',
          meta: 'x64 · most distributions',
          note: 'Flatpak manifest available; Flathub review pending.',
          href: links.latest,
          cta: 'Download for Linux',
        },
      ],
    },
    steps: {
      eyebrow: 'Up and running',
      title: 'Three steps to your first cut',
      lead: 'No installer key, no account and no trial timer. Just download and draw.',
      items: [
        {
          title: 'Download and open',
          body: 'Grab the build for your operating system and launch it. That is the whole setup.',
        },
        {
          title: 'Draw or import',
          body:
            'Start from scratch or bring SVG, DXF, images and LightBurn projects straight onto the bed.',
        },
        {
          title: 'Connect or simulate',
          body:
            'Plug in a GRBL controller over USB, or explore the entire workflow with the built-in simulator.',
        },
      ],
      dev: {
        title: 'Prefer the source?',
        body: 'Node.js 22.22+ and npm 10+ are all you need to run the desktop app in development.',
        code: 'git clone https://github.com/SJLS27/openburn.git\ncd openburn\nnpm install\nnpm run dev:electron',
      },
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Questions, answered',
      lead: 'Everything people ask before trying OpenBurn.',
      items: [
        {
          q: 'Is OpenBurn really free?',
          a:
            'Yes. The whole app is MIT-licensed: no paid tiers, no feature gates and no account. You can use it commercially, modify it and redistribute it.',
        },
        {
          q: 'Can I open my LightBurn projects?',
          a:
            'OpenBurn reads .lbrn and .lbrn2 and writes both back. Layers, groups, cut settings, text backup paths and bitmaps are supported. A few advanced features are still missing, and the compatibility notes in the docs list the exact limits.',
        },
        {
          q: 'Does it work with Ruida or DSP controllers?',
          a:
            'Not yet. OpenBurn currently targets GRBL-based machines. Ruida/DSP and galvo support are on the roadmap.',
        },
        {
          q: 'Do I need to be online?',
          a:
            'No. The app runs fully offline and sends no telemetry. The update check is the only optional network request.',
        },
        {
          q: 'Why does Windows or macOS warn about the download?',
          a:
            'Builds are not code-signed yet. On Windows choose More info → Run anyway. On macOS right-click the app and choose Open. Signed builds are planned.',
        },
        {
          q: 'Can I use it commercially?',
          a:
            'Yes. The MIT license lets you use OpenBurn for any purpose, including paid work. Attribution is appreciated but not required.',
        },
      ],
    },
    support: {
      title: 'Open source, no ads, no telemetry',
      body: 'If OpenBurn saves you time, you can help fund the next release.',
      paypal: 'Support with PayPal',
      more: 'Why support?',
    },
    cta: {
      title: 'Ready to make something?',
      lead: 'Download OpenBurn, open a project and preview your first cut in minutes.',
      primary: 'Download OpenBurn',
      secondary: 'Star on GitHub',
    },
  },
  featuresPage: {
    hero: {
      eyebrow: 'Features',
      title: 'Built for real laser work',
      lead:
        'Everything from the first vector to the final pass: design, cut settings, preview, calibration and machine control in one desktop app.',
    },
    grid: {
      eyebrow: "What's inside",
      title: 'Every feature, in the free build',
      lead: 'No add-ons, no paid modules, no feature gates.',
      items: [
        {
          icon: 'vector',
          title: 'Vector design',
          body:
            'Line, rectangle, rounded rectangle, ellipse, polygon, text and measure tools. Multi-select, move, scale, rotate, flip, align, distribute, group, reorder and edit nodes.',
        },
        {
          icon: 'layers',
          title: 'Cuts & Layers',
          body:
            'LightBurn-style layer table with Line, Fill, Offset Fill and Image modes, speed, power, passes, interval, output and air toggles. Advanced settings include overcut, lead-in/out, Z offset and kerf.',
        },
        {
          icon: 'preview',
          title: 'Animated preview',
          body:
            'Scrub the timeline, watch the head follow travel moves, and read the estimated time plus statistics for every layer before sending a job.',
        },
        {
          icon: 'machine',
          title: 'GRBL control',
          body:
            'Web Serial or built-in simulator, flow-controlled streaming, Frame, Start, Pause/Resume, Stop, jog, homing, unlock and set origin. Live position, feed and progress.',
        },
        {
          icon: 'test',
          title: 'Calibration tests',
          body:
            'Material test (power × speed), interval test, focus test with a Z ramp and kerf test. Results can be saved to a reusable material library.',
        },
        {
          icon: 'image',
          title: 'Image tools',
          body:
            'Import PNG, JPG, GIF, BMP and WebP. Adjust brightness, contrast, gamma, levels and curves; choose from ten dithering modes; trace to vectors with a live preview.',
        },
        {
          icon: 'text',
          title: 'Text to paths',
          body:
            'Convert text to outlines with opentype.js and the bundled Inter font, so files cut identically on any machine without missing fonts.',
        },
        {
          icon: 'route',
          title: 'Cut planner',
          body:
            'Interior-first ordering, direction sorting, travel reduction, best start point, preferred corners and overlap removal. LightBurn-style optimisation settings.',
        },
        {
          icon: 'file',
          title: 'LightBurn compatibility',
          body:
            'Open and export .lbrn and .lbrn2 with geometry, groups, cut settings, text backup paths and bitmaps. Export GCode as .nc whenever you need it.',
        },
        {
          icon: 'update',
          title: 'Automatic updates',
          body:
            'Checks on startup, downloads in the background and offers Restart & install. Manual check from Help → Check for Updates.',
        },
        {
          icon: 'shield',
          title: 'Offline and private',
          body:
            'No account, no telemetry and no cloud dependency. Projects and machine settings stay on your computer.',
        },
        {
          icon: 'spark',
          title: 'Tabs, offsets and arrays',
          body:
            'Add bridges so parts stay in place, offset contours for kerf, and repeat artwork in a grid or around a circle.',
        },
      ],
    },
    cta: {
      title: 'See it on your own machine',
      lead: 'Download the latest build and try it with the built-in simulator — no laser required.',
      primary: 'Download OpenBurn',
      secondary: 'Read the docs',
    },
  },
  downloadPage: {
    hero: {
      eyebrow: 'Download',
      title: 'Get OpenBurn',
      lead:
        'Free for Windows, macOS and Linux. Pick the build for your machine, or compile it yourself from source.',
    },
    requirements: {
      title: 'System requirements',
      items: [
        'Windows 10 or 11 (x64)',
        'macOS 11 Big Sur or newer (Apple Silicon & Intel)',
        'Linux x64 with AppImage or Flatpak support',
        'Optional: a GRBL-based laser connected over USB',
        'No account, no license key, no telemetry',
      ],
    },
    install: {
      title: 'Install notes',
      lead: 'The builds are not code-signed yet, so the operating system may ask for confirmation.',
      items: [
        {
          title: 'Windows SmartScreen',
          body:
            'If SmartScreen appears, choose More info → Run anyway. The installer is published on GitHub Releases by our CI.',
        },
        {
          title: 'macOS Gatekeeper',
          body:
            'Right-click OpenBurn.app and choose Open the first time. If macOS still blocks it, remove the quarantine flag:',
          code: 'xattr -dr com.apple.quarantine /Applications/OpenBurn.app',
        },
        {
          title: 'Linux AppImage',
          body: 'Make the file executable and run it:',
          code: 'chmod +x OpenBurn-*.AppImage\n./OpenBurn-*.AppImage',
        },
        {
          title: 'Linux Flatpak',
          body:
            'The manifest and offline sources live in the repository. Flathub publication is pending review, so building it locally is the current option.',
        },
      ],
    },
    dev: {
      title: 'Build from source',
      body: 'Node.js 22.22+ and npm 10+ are required.',
      code: 'git clone https://github.com/SJLS27/openburn.git\ncd openburn\nnpm install\nnpm run dev:electron\nnpm run build:app',
      note: 'The last command produces an AppImage, NSIS installer or DMG with electron-builder.',
    },
    cta: {
      title: 'Need a hand?',
      lead: 'The documentation covers the editor, cut settings, GRBL and file formats. If something breaks, open an issue.',
      primary: 'Read the docs',
      secondary: 'Open an issue',
    },
  },
  alternativePage: {
    hero: {
      eyebrow: 'Open-source alternative',
      title: 'A free alternative to LightBurn',
      lead:
        'OpenBurn covers the day-to-day workflow — vector design, cut layers, animated preview and GRBL control — without a license fee. It reads and writes .lbrn/.lbrn2, so you can try it on your existing projects and migrate gradually.',
    },
    cards: [
      {
        icon: 'file',
        title: 'Same files, both ways',
        body:
          'Open .lbrn and .lbrn2 projects and export them back. Your existing library is not locked in.',
      },
      {
        icon: 'layers',
        title: 'The workflow you already know',
        body:
          'Cuts / Layers, Line, Fill, Offset Fill, Image, passes, kerf and optimisation settings — in familiar places.',
      },
      {
        icon: 'code',
        title: 'Open source, no lock-in',
        body:
          'MIT licensed, auditable and free forever. Fork it, extend it or build it yourself.',
      },
    ],
    comparison: {
      eyebrow: 'Side by side',
      title: 'How they compare',
      lead: 'An honest look, not a marketing table.',
      headers: { openburn: 'OpenBurn', lightburn: 'LightBurn' },
      rows: [
        {
          label: 'Price',
          openburn: { text: 'Free, forever', state: 'yes' },
          lightburn: { text: 'Paid license', state: 'text' },
        },
        {
          label: 'Source code',
          openburn: { text: 'Open (MIT)', state: 'yes' },
          lightburn: { text: 'Closed', state: 'no' },
        },
        {
          label: 'Platforms',
          openburn: { text: 'Windows, macOS & Linux', state: 'yes' },
          lightburn: { text: 'Windows & macOS (Linux beta)', state: 'partial' },
        },
        {
          label: '.lbrn / .lbrn2 files',
          openburn: { text: 'Read & write', state: 'yes' },
          lightburn: { text: 'Native format', state: 'yes' },
        },
        {
          label: 'GRBL control',
          openburn: { text: 'Yes, plus simulator', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Material, interval & kerf tests',
          openburn: { text: 'Yes', state: 'yes' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Ruida / DSP controllers',
          openburn: { text: 'On the roadmap', state: 'partial' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Cameras & Print & Cut',
          openburn: { text: 'On the roadmap', state: 'partial' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
        {
          label: 'Code-signed installers',
          openburn: { text: 'Not yet', state: 'no' },
          lightburn: { text: 'Yes', state: 'yes' },
        },
      ],
      note:
        'Based on publicly documented features as of 2026. LightBurn is a trademark of LightBurn Software Inc. OpenBurn is not affiliated with, endorsed by or sponsored by LightBurn.',
    },
    migration: {
      title: 'Migrating in five minutes',
      lead: 'Nothing is converted irreversibly: you can open your files, try the workflow and export back.',
      items: [
        {
          title: 'Open your project',
          body: 'Use File → Open and pick a .lbrn or .lbrn2 file from your existing library.',
        },
        {
          title: 'Review the layers',
          body: 'Check modes, speed, power and passes in Cuts / Layers, then adjust anything that needs it.',
        },
        {
          title: 'Preview the job',
          body: 'Press Alt+P to inspect every path, travel move and the estimated time.',
        },
        {
          title: 'Connect your laser',
          body: 'Use Web Serial for a real GRBL machine, or the simulator to explore without hardware.',
        },
        {
          title: 'Export if you need to',
          body: 'Write .lbrn or .lbrn2 back at any time and keep working in either tool.',
        },
      ],
    },
    limits: {
      title: 'Where LightBurn still wins',
      lead: 'We would rather be honest: these are the gaps we are still working on.',
      items: [
        'Ruida / DSP controllers are not supported yet.',
        'Cameras and Print & Cut are on the roadmap.',
        'Installers are not code-signed yet.',
        'A decade of edge cases and a much larger ecosystem.',
      ],
    },
    faq: {
      title: 'Questions before switching',
      items: [
        {
          q: 'Will my cut settings survive the round trip?',
          a:
            'Layers and cut settings are mapped both ways. Object-level overrides are exported as layer settings, groups are flattened and text is exported as outlines. Check the file-format notes for the exact mapping.',
        },
        {
          q: 'Is there a paid tier or a trial limit?',
          a:
            'No. OpenBurn is MIT-licensed and fully functional. There is no account, no subscription and no timer.',
        },
        {
          q: 'Can I keep using LightBurn too?',
          a:
            'Yes. Both tools read and write compatible files, and OpenBurn can export GCode as well. Use whichever fits the job.',
        },
      ],
    },
    cta: {
      title: 'Try it on a real project',
      lead: 'Open one of your existing LightBurn files and see how far you get. It costs nothing.',
      primary: 'Download OpenBurn',
      secondary: 'Read the docs',
    },
  },
  privacyPage: {
    hero: {
      eyebrow: 'Privacy',
      title: 'Privacy, in plain language',
      lead: 'OpenBurn is a desktop tool, not a data business.',
    },
    updated: 'Last updated: 1 November 2026',
    sections: [
      {
        title: 'The desktop app',
        paragraphs: [
          'OpenBurn does not require an account and does not include telemetry, analytics or advertising. Your projects stay on your computer.',
          'The only optional network request is the update check, which contacts GitHub Releases to look for a newer version. You can trigger it manually or ignore it entirely.',
        ],
      },
      {
        title: 'This website',
        paragraphs: [
          'The site is a static build hosted on Cloudflare Pages. It does not set cookies and does not use advertising trackers.',
          'We use GoatCounter, a cookieless analytics tool, to count page views in aggregate. It does not build profiles, does not store IP addresses and respects Do Not Track.',
        ],
      },
      {
        title: 'Hosting',
        paragraphs: [
          'Cloudflare processes standard request data (such as IP address and user agent) to serve the site and protect it from abuse, under its own privacy policy.',
        ],
      },
      {
        title: 'Contact',
        paragraphs: [
          'Questions or requests? Open an issue at github.com/SJLS27/openburn/issues.',
        ],
      },
    ],
  },
  supportPage: {
    hero: {
      eyebrow: 'Support the project',
      title: 'Keep OpenBurn free and independent',
      lead:
        'OpenBurn has no ads, no telemetry and no paid tier. Sponsorship keeps it that way and pays for the work a free project usually cannot afford.',
    },
    reasonsTitle: 'Why it matters',
    paypalCta: 'Support with PayPal',
    reasons: [
      {
        icon: 'heart',
        title: 'No ads. No telemetry.',
        body:
          'The app and this website stay clean: no trackers, no cookie banners and no sponsored features.',
      },
      {
        icon: 'code',
        title: 'Signed builds and infrastructure',
        body:
          'Code-signing certificates, CI minutes, hosting and the domain cost real money every year.',
      },
      {
        icon: 'test',
        title: 'Hardware and materials',
        body:
          'Test cuts on real machines and materials are what make calibration, kerf and focus tests reliable.',
      },
    ],
    ways: {
      title: 'Ways to support',
      lead: 'Recurring, one-off or completely free — every option helps.',
      items: [
        {
          icon: 'heart',
          title: 'PayPal',
          body: 'One-time support with your PayPal account. PayPal may apply its usual fees.',
          cta: 'Support with PayPal',
          href: links.paypal,
        },
        {
          icon: 'github',
          title: 'GitHub Sponsors',
          body: 'Recurring support managed by GitHub. Cancel anytime.',
          cta: 'Sponsor on GitHub',
          href: links.githubSponsors,
        },
        {
          icon: 'file',
          title: 'One-off sponsorship',
          body:
            'Companies and individuals can fund a specific piece of work: signing, a feature or documentation.',
          cta: 'Start a sponsorship',
          href: links.sponsorshipIssue,
        },
        {
          icon: 'spark',
          title: 'Star and share',
          body:
            'A star on GitHub or a post in your laser community helps more than you think.',
          cta: 'Star OpenBurn',
          href: links.github,
        },
        {
          icon: 'code',
          title: 'Contribute',
          body: 'Code, docs, bug reports and real .lbrn2 samples are always welcome.',
          cta: 'Contributing guide',
          href: links.contributing,
        },
      ],
    },
    transparency: {
      title: 'Transparency',
      paragraphs: [
        'OpenBurn is MIT licensed and will remain so. Sponsorship never unlocks features, changes the license or buys influence over the roadmap.',
        'There are no ads, no cookie-based analytics and no sponsored content. The only optional network request in the desktop app is the update check.',
        'Where the money goes: code-signing certificates, CI and hosting, test materials and hardware, and time spent on maintenance and documentation.',
        'Sponsors are credited here and in the repository when they opt in.',
      ],
      note: 'No ads. No telemetry. MIT forever.',
    },
    cta: {
      title: 'Support OpenBurn',
      lead: 'Keep the project independent and the tools free for everyone.',
      primary: 'Support with PayPal',
      secondary: 'Star on GitHub',
    },
  },
  notFound: {
    title: 'This path went off the bed.',
    lead: 'The page you are looking for does not exist — or the cut was optimised away.',
    home: 'Back to home',
    download: 'Download OpenBurn',
  },
};

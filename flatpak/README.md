# Flatpak packaging

This directory contains a staging copy of the Flatpak manifest for OpenBurn.
The final submission lives in a fork of the
[flathub/flathub](https://github.com/flathub/flathub) repository, not here.

## Files

| File | Purpose |
| --- | --- |
| `io.github.SJLS27.OpenBurn.yml` | Flatpak manifest (runtime, permissions, build commands, sources). |
| `node-sources.json` | Offline npm and Electron sources generated with `flatpak-node-generator`. |
| `openburn.sh` | Launcher used as the Flatpak `command`. It starts Electron through `zypak-wrapper`. |

The desktop entry, AppStream metadata and icons live upstream in
`build/linux/` and are installed by the manifest.

## Why `io.github.SJLS27.OpenBurn`

Flathub derives the application ID from the project's code hosting. It must be
`io.github.<user>.<repo>` for GitHub projects, and IDs ending in `.app` are not
allowed. For the same reason the Electron `appId`, `desktopName` and the
`StartupWMClass` were aligned with this ID.

## Build locally

```bash
flatpak install --user flathub \
  org.freedesktop.Sdk//26.08 \
  org.freedesktop.Sdk.Extension.node22//26.08 \
  org.electronjs.Electron2.BaseApp//26.08

flatpak-builder --user --install --force-clean \
  --install-deps-from=flathub \
  --state-dir="$PWD/.flatpak-builder" \
  build-dir flatpak/io.github.SJLS27.OpenBurn.yml

flatpak run io.github.SJLS27.OpenBurn
```

On SELinux hosts where `flatpak-builder` fails while initializing the build
directory with `lsetxattr(security.selinux): Operation not supported`, run the
build from a filesystem that accepts SELinux labels (or use the
`org.flatpak.Builder` app in a normal system installation).

The manifest builds the upstream tag (`sources: tag:`), so a local build only
picks up committed code. To test uncommitted changes, copy the manifest to a
local file, replace the `git` source with
`- type: dir` / `path: /path/to/worktree`, and pass that file instead.

`org.flatpak.Builder` runs in its own sandbox: `/tmp` is *not* shared with the
host, so `--state-dir` must live under `$HOME` (or another directory the app can
reach). Without it, the state directory looks empty to the builder and module
builds fail with `No such file or directory`.

## Regenerate the offline sources

After changing `package-lock.json`, regenerate the dependency manifest from the
repository root:

```bash
pip install "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
flatpak-node-generator npm package-lock.json -o flatpak/node-sources.json
```

The generator downloads every npm tarball and the Electron release zips for
x86_64 and aarch64, so the Flatpak build itself does not need network access.

Validate that the generated file still covers `package-lock.json` (this runs in
CI, and needs no network):

```bash
npm run check:flatpak-sources
```

It fails and lists the missing packages when a dependency was added or bumped
without regenerating `node-sources.json`.

## Permissions

- `--device=all` is required for USB serial access to GRBL controllers
  (`/dev/ttyUSB*`, `/dev/ttyACM*`). It also exposes DRI devices for rendering.
- `--filesystem=home` lets users open and save projects, artwork and GCode
  anywhere they keep them. Reviewers may ask for narrower paths or portal-based
  file dialogs.
- No network permission is requested. Update checks are not implemented.

## Submitting to Flathub

1. Fork `flathub/flathub` and create a branch named after the application ID.
2. Copy `io.github.SJLS27.OpenBurn.yml`, `node-sources.json` and optionally
   `flathub.json` to the root of that branch.
3. Verify the `tag`/`commit` in the manifest point to the current release.
4. Open the pull request as the upstream maintainer and address the reviewer
   feedback.

> **Important:** Flathub's current submission policy restricts AI-generated
> manifests and requires human authors to open and maintain submissions. Review
> and rewrite this manifest yourself before submitting it, and do not submit it
> through an automated agent.

For day-to-day work, no copy-pasting needed: run `sh scripts/flatpak-local.sh`
from the repository root. The script derives a copy of the manifest whose only
change is a `dir` source pointing at the current worktree, drops the Playwright
browser sources (only needed for e2e) and builds with `--disable-rofiles-fuse`.
It needs `python3`.

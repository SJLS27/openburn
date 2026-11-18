#!/bin/sh
# Build and install OpenBurn from the current worktree as a user Flatpak.
#
# The manifest builds the upstream tag, so this derives a local copy whose only
# change is the source: a `dir` pointing at this worktree. Everything else
# (permissions, build commands, offline sources) is the real manifest.
#
# Why the paths: org.flatpak.Builder runs in its own sandbox where /tmp is not
# the host's /tmp, so state and build dirs must live under $HOME.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$HOME/.openburn-flatpak/local.yml"
STATE="$HOME/.openburn-flatpak/state"
BUILD="$HOME/.openburn-flatpak/build"

mkdir -p "$HOME/.openburn-flatpak"

# The tag comes from package.json so a version bump never needs an edit here.
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$REPO/package.json")"
TAG="v$VERSION"

python3 - "$REPO/flatpak/io.github.SJLS27.OpenBurn.yml" "$MANIFEST" "$REPO" "$TAG" <<'PY'
import json
import os
import re
import sys

src, dst, repo, tag = sys.argv[1:5]
text = open(src).read()
# Match the upstream git source whatever tag the manifest currently points at.
pattern = re.compile(
    r"""      - type: git
        url: https://github\.com/SJLS27/openburn\.git
        tag: v[^\s]+"""
)
if not pattern.search(text):
    sys.exit('flatpak: the git source block changed; update this script')
print(f'flatpak: building {tag} from the worktree')
new = f"""      - type: dir
        path: {repo}
        skip:
          - node_modules
          - .git
          - builddir
          - release
          - repo
          - website
          - .flatpak-builder"""
text = pattern.sub(lambda _m: new, text, count=1)
# Sources are resolved next to the manifest, which lives under $HOME.
text = text.replace('\n      - node-sources.json', f'\n      - {repo}/flatpak/node-sources.json')
open(dst, 'w').write(text)

# Playwright browsers (100 MB each) are only needed for e2e tests; drop them so
# this local packaging build does not depend on downloading them.
import json
sources = json.load(open(repo + '/flatpak/node-sources.json'))
keep = [s for s in sources if 'playwright.dev' not in (s.get('url') or '')]
json.dump(keep, open(os.path.expanduser('~/.openburn-flatpak/node-sources.json'), 'w'), indent=4)
text = text.replace(f'\n      - {repo}/flatpak/node-sources.json',
                    '\n      - ' + os.path.expanduser('~/.openburn-flatpak/node-sources.json'))
open(dst, 'w').write(text)
PY

flatpak run --env=TMPDIR="$HOME/.openburn-flatpak/tmp" org.flatpak.Builder \
  --user --install --force-clean --disable-rofiles-fuse \
  --state-dir="$STATE" \
  "$BUILD" "$MANIFEST"

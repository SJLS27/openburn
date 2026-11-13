#!/bin/sh
# Derive the WebP variants used by the public site from the PNG masters in
# docs/screenshots/ (1200 wide → 800 / 1200 / 1600 px, see
# website/src/components/Screenshot.astro).
#
# Usage: sh scripts/build-docs-assets.sh
# Requires ImageMagick (`magick` or `convert`) with WebP support.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC="$ROOT/docs/screenshots"
DEST="$ROOT/website/public/screenshots"

if command -v magick >/dev/null 2>&1; then
  CONVERT=magick
elif command -v convert >/dev/null 2>&1; then
  CONVERT=convert
else
  echo "ImageMagick is required (magick/convert)" >&2
  exit 1
fi

WIDTHS="800 1200 1600"

mkdir -p "$DEST"

# Showcase images referenced by the website content (see src/content/*.ts).
for name in overview preview material-test lightburn image-tools focus-test; do
  png="$SRC/$name.png"
  if [ ! -f "$png" ]; then
    echo "missing $png — run \`npm run docs:screenshots\` first" >&2
    exit 1
  fi
  for width in $WIDTHS; do
    "$CONVERT" "$png" -resize "${width}x" -strip -quality 82 \
      -define webp:method=6 "$DEST/$name-$width.webp"
  done
  echo "built website/public/screenshots/$name-{800,1200,1600}.webp"
done

echo "done"

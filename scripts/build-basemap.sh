#!/usr/bin/env bash
# Build a world basemap extract (PMTiles) for the site's MapLibre map.
#
#   scripts/build-basemap.sh [MAXZOOM] [BUILD_DATE]
#
# Requires the `pmtiles` CLI (https://github.com/protomaps/go-pmtiles). The extract is read over HTTP range requests
# from a Protomaps daily build, so only the tiles needed are downloaded. Zoom 6 is roughly 60-80 MB; each extra zoom
# level about triples the size. The result is uploaded to R2 because it exceeds the Cloudflare Pages per-file limit.
#
# Data: (c) OpenStreetMap contributors (ODbL). Tiles and style: Protomaps. Keep the attribution shown on the map.
set -euo pipefail
MAXZOOM="${1:-6}"
BUILD="${2:-$(date -u +%Y%m%d)}"
OUT="site/public/r2/basemap/world.pmtiles"
command -v pmtiles >/dev/null || { echo "Install the pmtiles CLI first: https://github.com/protomaps/go-pmtiles/releases" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$OUT" --maxzoom="$MAXZOOM"
pmtiles show "$OUT" | head -20
cat <<MSG

Next steps:
  1. Upload:  aws s3 cp "$OUT" "s3://\$R2_BUCKET/basemap/world.pmtiles" --endpoint-url "\$R2_ENDPOINT"
  2. Set "basemapUrl" in config/site.json to the public R2 URL of that file.
  3. Optional labels: copy the fonts from https://github.com/protomaps/basemaps-assets to R2 and set
     "basemapGlyphsUrl" (for example https://assets.example.org/basemap/fonts/{fontstack}/{range}.pbf).
  For local preview you can set "basemapUrl" to "/r2/basemap/world.pmtiles".
MSG

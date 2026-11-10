#!/usr/bin/env bash
# Build a self-hosted JupyterLite site (Python in the browser via Pyodide) with the starter notebooks.
#
#   scripts/build-jupyterlite.sh [PYODIDE_VERSION]
#
# Output: site/public/r2/tools/jupyterlite (several hundred MB; uploaded to R2, never to Pages).
# Everything, including the Pyodide runtime and its wheels, is served from the project's own storage: no CDN.
# This script has not been run in the repository's original build environment; run it, then check the Notebooks page.
set -euo pipefail
PYODIDE="${1:-0.27.7}"
OUT="site/public/r2/tools/jupyterlite"
python3 -m venv .venv-lite
.venv-lite/bin/pip install -q "jupyterlite-core>=0.6,<0.7" "jupyterlite-pyodide-kernel>=0.6,<0.7" jupyterlab
python3 scripts/make_notebooks.py
rm -rf "$OUT" .lite-contents && mkdir -p .lite-contents
cp notebooks/*.ipynb notebooks/requirements.txt .lite-contents/
.venv-lite/bin/jupyter lite build \
  --contents .lite-contents \
  --pyodide "https://github.com/pyodide/pyodide/releases/download/${PYODIDE}/pyodide-${PYODIDE}.tar.bz2" \
  --output-dir "$OUT"
rm -rf .lite-contents
node site/scripts/prepare-tools.mjs
du -sh "$OUT"
echo "Built. The notebooks set BASE from the page origin; upload $OUT to R2 under tools/jupyterlite."

# Understanding Outbreaks

An open-source, static-first website that helps people understand infectious disease trends, from a global overview
down to individual outbreaks, with every number traceable to its original source.

**What it is not.** Understanding Outbreaks aggregates and explains official public reports. It is not a surveillance
system, not an early-warning service, not a forecasting service, and not medical advice. Automated signal flags are
informational labels, not alerts. The simulation sandbox is an educational tool and never describes a real outbreak.

- Code: MIT (`LICENSE`). Written content: CC BY 4.0 (`LICENSE-CONTENT.md`). Data: each source keeps its own license.
- No tracking, no analytics, no accounts, no cookies, no server-side runtime, no third-party requests from the browser.

## Repository layout

```
config/            site.json (base URL, R2, basemap, identity placeholders), sources.yaml (source registry),
                   datasets.yaml (connectors), diseases.yaml (vocabulary + mapping), country_aliases.yaml, context_links.json
pipeline/uo/       Python pipeline: core, connectors, reference, timeseries, signals, events, publish, export, build, linkcheck
pipeline/tests/    pytest suite (unit, traceability over published output, notebook execution)
site/              TypeScript + Vite + Preact frontend (main bundle, embed bundle, lazy workbench and sandbox chunks)
site/src/sim/      simulation engine (pure TypeScript, no data access), worker, and sandbox UI
notebooks/         Python and R notebooks with pinned environments
scripts/           open_issues.py, make_metadata.py, make_notebooks.py, build-basemap.sh, build-jupyterlite.sh
docs/              SOURCES, PROVENANCE, METHODOLOGY, SIMULATION, METHODS_CHANGELOG, LIMITATIONS
state/             (git-ignored) pipeline state: raw cache, revision history, last good data, issue requests
```

## Setup

Requirements: Python 3.13, Node 22 or newer.

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
```

```bash
cd pipeline && ../.venv/bin/python -m uo.build
```

The pipeline fetches every source, archives raw files with hashes, validates, records revisions, computes lag
estimates, flags and events, and writes the static API to `site/public/data/v1/` atomically. `--offline` re-uses the
last fetched raw files.

```bash
cd site && npm ci && node scripts/prepare-tools.mjs && npm run dev
```

Tests and a production build:

```bash
cd pipeline && ../.venv/bin/python -m pytest -q
```

```bash
cd site && npm run check:i18n && npm test && npm run build && npm run check:bundles
```

## Deploying to Cloudflare Pages and R2

The site runs at `understandingoutbreaks.com` (Cloudflare Pages), with large files on `assets.understandingoutbreaks.com` (R2). **The base URL is one config value**: `baseUrl` (and `shortUrl`) in
`config/site.json`. Moving to a custom domain is that one-line change plus a rebuild.

1. Create a Cloudflare Pages project (direct upload) and an R2 bucket with a public custom domain or `r2.dev` URL.
2. Configure the bucket's CORS to allow `GET` and `HEAD` with the `Range` header from the site's origin, and expose
   `Content-Length`, `Content-Range` and `Accept-Ranges`. R2 serves HTTP range requests natively.
3. In `config/site.json` set `r2BaseUrl` and `toolAssetsBaseUrl` (for example `https://assets.example.org` and
   `https://assets.example.org/tools`), and `basemapUrl` once a basemap is uploaded.
4. In the GitHub repository add secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, and variables `R2_BUCKET` (public bucket), `R2_STATE_BUCKET` (a second, private bucket)
   and `PAGES_PROJECT`. Pipeline state includes raw source files that may not be redistributed, so it is only ever
   written to the private bucket; never make that bucket public.
5. The scheduled workflow `.github/workflows/update-data.yml` then fetches, validates, builds, uploads R2 files and
   deploys Pages every day. Without the secrets it still runs the pipeline and tests but skips upload and deploy.

`npm run build` writes `site/dist/` (for Pages) and `site/dist-r2/` (for R2), plus `_redirects` and `_headers`. The
build fails if any Pages file exceeds 25 MB or the file count exceeds 20,000.

### Storage layout

| Where | What | Why |
|---|---|---|
| Pages `/data/v1/` | Static JSON API, per-country time series and lineage files, bulk Parquet/CSV partitioned by disease, catalog metadata, snapshot manifests | Small, cacheable, same-origin |
| R2 `raw/{dataset}/{sha256}.{ext}` | Raw source archive, only where the license permits redistribution | Grows without bound; permanent URLs |
| R2 `tools/duckdb` (engine and its Parquet extension), `tools/jupyterlite` | Self-hosted runtimes | Over the 25 MB Pages file limit or many thousands of files |
| Pages `/tools/webr` | webR (R in the browser) | Every file is under the Pages limit, and webR fails when loaded from another origin |
| R2 `basemap/*.pmtiles` | Protomaps basemap | Far over the Pages file limit; needs range requests |
| R2 `state/` | Pipeline state: revision history (`revisions.parquet`), last good normalized data, snapshot list, event ids | Persists between scheduled runs |
| R2 `published/data/` | Copy of the last published `/data/` tree | Lets a failed run keep the last good snapshot |

Snapshot ids are permanent and immutable (`/data/v1/snapshots/{id}.json`). The revision history stores only changes
between snapshots, partitioned by disease.

**Upgrade path.** When the bulk files or lineage files approach Pages limits: (1) move `/data/v1/bulk/` to R2 by
setting a separate data base URL in `config/site.json` and pointing `datasetPath` in the workbench at it; (2) partition
time-series Parquet by disease *and* year (the writer already sorts by place and date); (3) move `lineage/` to R2. The
frontend reads every path from the manifest and config, so none of these needs code changes outside the pipeline's
output paths.

## Rebuilding the basemap

The map uses Protomaps (PMTiles) with the `protomaps-basemaps` light style, through MapLibre GL JS and the `pmtiles`
protocol. No third-party tile server, no API key. Without a basemap the map still works: it draws Natural Earth
boundaries on a plain background.

```bash
scripts/build-basemap.sh 6
```

This uses the `pmtiles` CLI to extract a world basemap to the given maximum zoom from a Protomaps build, and prints
the upload command. Upload it to R2 (`basemap/world.pmtiles`), then set `basemapUrl` in `config/site.json`. Labels
need glyph files: copy the Protomaps `basemaps-assets` fonts to R2 and set `basemapGlyphsUrl`; without it, label
layers are left out. Attribution (© OpenStreetMap contributors, Protomaps) is shown under every map and baked into
exports.

## Hosting workbench and sandbox assets

Everything is self-hosted; nothing is loaded from a CDN.

- `node site/scripts/prepare-tools.mjs` copies DuckDB-WASM (single-threaded `eh` build) and webR into
  `site/public/r2/tools/`. KaTeX, Observable Plot and the simulation engine are bundled as lazy chunks.
- `scripts/build-jupyterlite.sh` builds JupyterLite with a self-hosted Pyodide into `site/public/r2/tools/jupyterlite`
  (large: several hundred MB). Until it has been run, the Notebooks page offers downloads only and says so.
- **No cross-origin isolation is needed.** DuckDB-WASM uses its single-threaded build and webR uses its PostMessage
  channel, so no COOP/COEP headers are set and embeds keep working. If a future tool needs them, scope the headers to
  that tool's route in `site/scripts/postbuild.mjs`, never site-wide.
- Tools load only when opened and show their download size first. `npm run check:bundles` fails the build if a runtime
  or solver ends up in the main or embed bundle.

## Adding a source

1. Check it live: URL, schema, cadence, license, and whether history and revisions can be captured. Record the result
   in `docs/SOURCES.md`. Do not use subscription or restrictively licensed sources.
2. Add the source to `config/sources.yaml` (id, name, publisher, landing URL, license, citation, cadence,
   `redistribute_raw`).
3. Add a dataset to `config/datasets.yaml` (URL, deep link, period type, transformation chain, case-definition note).
4. If an existing connector fits (`owid_grapher`, `who_wiise`, `who_gho`), you are done. Otherwise add a pure
   `parse_*` function in `pipeline/uo/connectors.py`, register it in `PARSERS`, and add a test with a recorded-shape
   response. A connector must raise `SchemaChange` when expected columns are missing.
5. Run the pipeline and the tests. See `docs/PROVENANCE.md`.

## Adding a disease

Add an entry to `config/diseases.yaml`: id, name, aliases (names, spelling variants, pathogens), `data_type`, and
ICD-11 / MeSH identifiers only where the mapping is clear. Event-only diseases need nothing else. To promote a disease
to a time series, list its datasets and a `default_series`, plus at most one connector.

## Adding a language

1. Copy `site/src/i18n/locales/en.json` to `<code>.json` and translate the values (ICU MessageFormat).
2. Add one line to `locales` in `config/site.json` (`code`, `name`, `dir`: `ltr` or `rtl`, `status`).

No code changes. Right-to-left layouts are supported through logical CSS properties and the document `dir`. Run
`npm run check:i18n`, then `node site/scripts/translations-report.mjs` to refresh `TRANSLATIONS.md`.

## Adding a model template or a lesson

- **Template:** add a branch in `site/src/sim/engine/templates.ts` that returns a model spec (compartments, flows with
  rate expressions, parameters with units and ranges), mark infected compartments and infection flows, add its
  assumptions, and add tests for conservation and its next-generation-matrix R0 in `site/tests/sim-engine.test.ts`.
- **Lesson:** add an entry to `LESSONS` in `site/src/sim/ui/index.tsx` and the strings `lesson.<id>.title`, `.sum`,
  `.p1…`, `.try`, `.take`. Lessons are static text plus sandbox settings.
- **Preset:** only with a citation whose value you have checked against the source; otherwise mark it unverified.

## Zenodo release steps (manual, one time)

The pipeline never publishes to Zenodo.

1. Fill in `identity` in `config/site.json` (creator, contact, optionally affiliation and ORCID). These are neutral
   placeholders by default; **a maintainer must fill them in before minting a DOI**. Never put a name anywhere else.
2. Run `python scripts/make_metadata.py` to regenerate `CITATION.cff` and `.zenodo.json`.
3. Log in to Zenodo with GitHub and switch on this repository under GitHub settings.
4. Push a tag `vX.Y.Z`. `.github/workflows/release.yml` packages the dataset snapshot as a release asset; Zenodo
   archives the release and mints a DOI.
5. Put the DOI in `identity.doi` in `config/site.json`. The Cite page then shows the badge and "cite this version".

## Maintenance model

When a source breaks or changes, the pipeline keeps the last good snapshot live and opens a GitHub issue with the
failing source, the error, the last good snapshot and a schema diff where one was detected. It never opens pull
requests and never merges anything. A person reviews and fixes.

## Good first issues

- Review machine-drafted Spanish, French or German health wording (see `TRANSLATIONS.md`).
- Verify one source's license statement and update `license_verification` in `config/sources.yaml`.
- Add aliases for a disease name listed under "Other / unclassified".
- Add a second-level (district) gazetteer so `admin2` precision can be produced.
- Verify an ICD-11 or MeSH identifier in `config/diseases.yaml`.
- Add a recorded-response test for a connector edge case.
- Add a lesson or a scenario pack.

## Documentation

`docs/SOURCES.md` · `docs/PROVENANCE.md` · `docs/METHODOLOGY.md` · `docs/SIMULATION.md` · `docs/LIMITATIONS.md` ·
`CORRECTIONS.md` · `TRANSLATIONS.md` · `CONTRIBUTING.md` · `SECURITY.md`

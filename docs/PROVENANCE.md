# Provenance and lineage

Anything shown on the site, in an export, in an embed or in an image lets the user identify its original source in
one click and its full lineage in two.

## Origin types

Every item has exactly one origin type, shown with a fixed label and icon:

| Origin type | Meaning | Shown with |
|---|---|---|
| `source-reported` ◆ | A value or text published by an external source, unchanged | the source's name |
| `site-derived` ∑ | Computed by this project (rates, weekly sums, rolling averages, flags, lag estimates, rankings, geocoded locations, automated summaries) | inputs, method name and version, links to the source records |
| `user-supplied` ✎ | A custom overlay loaded in the browser | "user-supplied"; never merged into exports of official data |
| `simulated` ◌ | Sandbox output | model spec, seed, engine version; dashed purple, "SIMULATED" |
| `test-data` ⚠ | Fixtures | "TEST DATA"; rejected in production builds |

## Source registry (`config/sources.yaml`)

One file defines every source. Every record, chart, map layer and export refers to a source `id` from it. There are no
free-text sources anywhere.

```yaml
- id: who_flunet                    # lower-case, letters/digits/underscore
  name: ...                         # full name
  short_name: ...                   # used on source chips
  publisher: ...
  landing_url: https://...          # must be https (or site-relative for the project's own entries)
  license: ...                      # as stated by the publisher
  license_url: https://...
  license_verification: verified-live | stated-unverified
  license_checked: "YYYY-MM-DD"
  redistribute_raw: true | false    # may raw files be published in the raw archive?
  citation: "..."
  cadence: daily | weekly | monthly | yearly
  kind: timeseries | events | population | boundaries | reference | basemap | derived | literature | test
```

The registry is published at `/data/v1/sources.json`. `core.load_registry()` rejects malformed entries.

## Record-level provenance

Each normalized record (time series, events, boundaries, population, reference data) has:

| Field | Where it lives |
|---|---|
| `source_id` | via `dataset_id` → `config/datasets.yaml` → registry |
| `source_url` | the dataset's `deep_link` template filled with the place (a deep link to the file, API query or page). If only a landing page exists, `link_kind` is `dataset-level link` and the UI says so |
| `raw_record_ref` | where the value sits inside the raw file, e.g. `COUNTRY_CODE=KEN;ISO_WEEKSTARTDATE=2026-11-02;ORIGIN_SOURCE=SENTINEL` |
| `raw_file_hash` | SHA-256 of the archived raw file or API response (through `fetch_id`) |
| `retrieved_at` | through `fetch_id` |
| `snapshot_id` | the immutable snapshot the value was published in |
| `license` | from the registry |
| transformation chain | through `chain_id`: ordered steps `{op, method_version, params}` |
| `quality_flags` | e.g. `likely-incomplete`, `negative-correction-in-source` |

Provenance is stored **by reference** to keep files small: a record carries a `series_id` and a `fetch_id`; the series
metadata (`diseases.json`) carries source, definition, chain and deep-link template; `fetches.json` carries URL, hash
and retrieval time; `chains.json` carries the steps. Bulk Parquet and CSV files expand all of this onto every row.

**Derived values** carry the ids of their inputs. A derived series lists its input series keys (`inputs`); a derived
record's `raw_record_ref` names the raw records it was computed from (for example the seven daily rows of a week).

## Ids and endpoints

- Series id: `disease.dataset.metric.definition-hash.system.period_type.ISO3`.
- Record id: `series_id@period_start`.
- Lineage endpoint: `/data/v1/lineage/{disease}/{iso3}.json` lists, for every series of that disease and country, the
  periods with their `raw_record_ref` and `fetch_id`. To resolve a record id, open the file for its disease and
  country, find the series, then the period.
- `/data/v1/sources.json` (registry), `/data/v1/fetches.json` (raw files of the latest snapshot),
  `/data/v1/chains.json` (transformation chains), `/data/v1/snapshots/{id}.json` (every raw file with its hash).

## Raw archive

Each fetched raw file or API response is stored by content hash. Where the registry says `redistribute_raw: true` the
file is published to R2 at `raw/{dataset}/{sha256}.{ext}` and linked from the trace panel. Where it is `false`, only
the hash, metadata and link are published, and the trace panel says the raw file is not redistributed. The pipeline
keeps a private working copy either way.

If an original URL stops working, the trace panel shows "original link unavailable" and offers the archived copy or a
Wayback Machine link. `python -m uo.linkcheck` checks every registry URL and deep link and opens a GitHub issue for
broken ones.

## In the interface

- Every chart, map, table, event page, summary, flag, ranking and statistic has a **source chip** (origin type,
  source names, "data as of"). Clicking it opens **Trace this**: original source link, retrieval date, license, case
  definition, transformations in plain language, links to the underlying records.
- Simple mode: compact chip and a plain-language panel, with a "Show full lineage" button. Analyst mode: full lineage
  by default (series ids, fetch ids, hashes, raw record references, method versions).
- Map features show their source on hover; clusters list the contributing sources. Boundary, population, gazetteer
  and basemap attributions are shown under every map and baked into exports.
- Blended and reconciled views list every contributing source.
- Automated event summaries are built from structured fields; quoted source phrases are visibly marked; the original
  notice link sits next to the text.

## In outputs

Every export, embed, PNG, SVG, notebook, "copy as code" snippet and SQL result carries provenance: source ids, source
URLs, retrieval dates, snapshot id, licenses, transformations and a suggested citation. Data bundles are zip files
with `*.provenance.json`, a dictionary and `CITATION.txt`; rows keep `source_id` and `source_url`. Images bake in
source names, license, "data as of" and the short URL, and ship with a caption and alt text.

## Tests

`pipeline/tests/test_traceability.py` runs over the published output and fails CI (blocking deployment) if any
record, series, event, flag, ranking item or export lacks a valid source id and origin type, if a source URL is not a
resolved https link, if a derived series does not resolve to its inputs, or if test data is present.
`site/tests/site.test.ts` checks that exports and images carry provenance and that trace panels render for every
visualization type.

## How to add a source

See "Adding a source" in the README. In short: verify live, add the registry entry, add the dataset entry, reuse or
write a connector with a recorded-response test, run the pipeline and the traceability tests.

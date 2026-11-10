# Contributing

Thank you for helping. This project aggregates and explains official public reports. It is not a surveillance system,
not an early-warning or forecasting service, and not medical advice. Contributions must keep it that way.

## Ground rules

1. **Never fabricate data.** Fixtures are for tests only, carry the `TEST DATA` origin type, and are rejected in
   production builds.
2. **Everything is traceable.** Any new record, chart, map layer, text block, flag, ranking item, simulation preset or
   export must reference a source id from `config/sources.yaml` and have exactly one origin type. CI fails otherwise.
3. **Verify sources live** before writing a connector: current URL, schema, cadence and license. Record what you
   found in `docs/SOURCES.md`. Do not add subscription or restrictively licensed sources.
4. **Neutral language.** No "alert", "warning", "surge", "outbreak detected", "severe" or "dangerous" for automated
   output. Simulations are never described as predictions.
5. **No fitting or forecasting.** The simulation sandbox must not read reported data to set up, tune or validate a
   model. Tests enforce this.
6. **No publisher identity** in code, docs or metadata beyond the project name. Identity is read from
   `config/site.json`.
7. **All user-facing text is translatable.** Add strings to `site/src/i18n/parts/en/*.json`, then run
   `node site/scripts/i18n-merge.mjs`. Add machine drafts for the other locales and list them in `TRANSLATIONS.md`.
8. **The pipeline never repairs itself.** When a source breaks it opens an issue. A person fixes it in a pull request
   that another person reviews.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
```

```bash
cd pipeline && ../.venv/bin/python -m uo.build
```

```bash
cd site && npm ci && node scripts/prepare-tools.mjs && npm run dev
```

## Tests

```bash
cd pipeline && ../.venv/bin/python -m pytest -q
```

```bash
cd site && npm run check:i18n && npm test && npm run build && npm run check:bundles
```

## How to add things

See the README: adding a source, a disease, a language, a model template or a lesson.

## Pull requests

- One topic per pull request, with tests.
- Describe what you verified and how. For sources, paste the live check output.
- Update `docs/METHODS_CHANGELOG.md` for any change to a method, and `CORRECTIONS.md` for any corrected error.
- By contributing you agree that your code is licensed under MIT and your written content under CC BY 4.0.

## What this changes

## How it was verified

- [ ] `python -m pytest` passes in `pipeline/`
- [ ] `npm run check:i18n && npm test && npm run build && npm run check:bundles` passes in `site/`

## Checklist

- [ ] No fabricated data; fixtures are labelled TEST DATA
- [ ] Every new item has a source id and an origin type; exports still carry provenance
- [ ] New sources were verified live (URL, schema, cadence, license) and recorded in `docs/SOURCES.md`
- [ ] Wording is neutral (no alert / warning / surge / severe); simulations are not described as predictions
- [ ] No fitting, calibration, nowcasting or forecasting was added
- [ ] New user-facing text is in the translation files, with other locales marked machine-drafted in `TRANSLATIONS.md`
- [ ] Method changes are logged in `docs/METHODS_CHANGELOG.md`; corrections in `CORRECTIONS.md`
- [ ] No publisher, author or organisation identity was added outside `config/site.json`

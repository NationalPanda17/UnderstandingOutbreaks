# Known limitations and next steps

## Data

- **Polio, cholera and dengue are annual only.** No reliable open weekly series was found. They say nothing about the
  current year; current activity appears only through event notices.
- **Dengue mixes definitions** across countries and years. The yearly series is for a country's own history, not for
  ranking countries.
- **No sub-national time series.** The country page states this rather than showing a drill-down.
- **One population year** is used for all rates.
- **Revision history starts at the first snapshot.** Lag estimates use configured defaults until at least four
  snapshots exist; the revision rate on the data-quality page is "not yet measurable"; the snapshot diff is empty.
- **Event counts are extracted by pattern matching** and can pick a subtotal rather than the headline number. They are
  always shown with the quoted phrase and a link.
- **Event grouping is rule-based.** Long-running events with gaps of more than 120 days between notices are split.
- **District-level (admin2) locations are never produced.** City matches require explicit wording, so many notices
  stay at country precision.
- **WHO license statements** could not be machine-verified; raw WHO files are therefore not redistributed.
- **ICD-11 and MeSH identifiers** were entered from memory and need checking.

## Site

- **Basemap not included.** Maps draw Natural Earth boundaries on a plain background until a maintainer builds and
  uploads a PMTiles basemap (`scripts/build-basemap.sh`). Without glyphs there are no map labels.
- **JupyterLite is not built** in the repository; the Notebooks page offers downloads and an in-browser R console.
  `scripts/build-jupyterlite.sh` has not been run in the original build environment.
- **R code paths were not executed locally** (no R available): the generated tidyverse and deSolve code and the R
  notebooks run in CI only.
- **Translations are machine-drafted** (Spanish, French, German) and await human review.
- **Accessibility** was built to WCAG 2.1 AA practices (keyboard paths, table alternatives, text alternatives, focus
  management, reduced motion) but has not had a formal audit or assistive-technology testing.
- **No deployment was performed.** Cloudflare Pages, R2, secrets and the Zenodo link need a maintainer.
- The map-image export captures the map canvas; in some browsers a lost WebGL context can yield a blank image.
- Embeds for maps and charts are pinned to a snapshot by default; removing the parameter shows the latest data.

## Simulation sandbox

- Stochastic binomial draws use a normal approximation when `n·p ≥ 12`; Gillespie holds rates fixed between events,
  so continuously time-varying rates (seasonal forcing) are approximate with that solver.
- The metapopulation model approximates prevalence among people present in a patch by prevalence among its residents.
- Phase-plane stability is reported from the analytical threshold for the offered templates, with a numerical check
  for the bifurcation diagram; there is no general eigenvalue solver.
- The custom model builder is form-based (accessible) rather than a drag-and-drop canvas.
- No contact-survey matrices are bundled.

## Next steps (each needs separate review)

- **A "model estimates" layer** (fitted models, reproduction-number estimates, nowcasts) is deliberately out of
  scope. The architecture leaves room for it as a separate layer type with its own origin type, provenance and review
  process. It must not be added to the sandbox.
- **Endemic burden layers** (malaria, tuberculosis, HIV) as a separate layer type with their own sources.
- **Alerts or subscriptions** (RSS, email): not built, by decision. Signal flags are labels on pages.
- Further event sources once licenses and formats allow (ECDC CDTR as a linked-report feed; ReliefWeb with a
  registered app name).
- WHO FluID syndromic series; sub-national sources where openly licensed.
- A district gazetteer; verified contact matrices; a formal accessibility audit; human translation review.

## Hosting

- Cloudflare, which delivers the site, tries to add its Web Analytics script to pages as it serves them. The
  site's Content-Security-Policy blocks the script, so it does not run and nothing is sent, and the live-site
  health check fails if anything is ever loaded from another server. The dashboard setting that stops the attempt
  has not been found; the About page says so.
- Named maintainers and a contact address appear on the About page only when set in `config/site.json`
  (`identity.maintainers`, `identity.contact`, `identity.errorReportUrl`, `repoUrl`). They are empty by default.

## Polio series

- The WHO WIISE country-submitted polio series contains values that do not match the GPEI-based series and that we
  cannot explain from the file: 22 cases for Andorra and 30 for Albania in 2014 (both certified polio-free), 0 for
  Afghanistan in 2019 (29 wild cases in the GPEI-based series), and for Afghanistan in 2020 a value equal to the
  vaccine-derived cases only. The values are published exactly as WIISE gives them (the lineage endpoint resolves
  each to its raw record) and the reconciliation page lists the disagreements; 76 of 99 are zero against a positive
  number. The default series is therefore the Our World in Data compilation, which ends in 2023.
- WHO POLIS and the GPEI case tables would be the primary source and would separate WPV1 from other wild types.
  POLIS requires an access token and the GPEI pages publish through an interactive report without a data file, so
  neither is ingested.

## Influenza percent positive

- Countries that report detections and samples through different systems have no computable percent positive and
  are drawn as such, even when they report many detections.
- Reading blank detections as zero assumes FluNet's convention holds for every country. About one row in ten of
  those affected has neither a negative count nor subtype fields to confirm it.

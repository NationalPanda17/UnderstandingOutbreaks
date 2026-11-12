# Methods changelog

Versioned log of method changes. Each entry starts with `## YYYY-MM-DD — title`. Method versions appear in every trace
panel and export, so a change here must come with a version bump in the code.

## 2026-11-12 — Correctness pass: influenza positivity, lag, event grouping v3, ranking v2, polio default
<!-- type: methodology -->
- `paired_positivity` v1: percent positive divides detections by samples only within a surveillance system that
  reported both; a system-week with more detections than samples is not computable. Values above 100% (for example
  1,209 detections over 4 samples) can no longer occur, and a test now fails the build if one is published.
- FluNet blank detections beside processed samples are read as zero (parser version 2). The first run after this
  change records the added zeros as new values in the revision history.
- Influenza flags, `rolling_baseline_c2` v2 on percent positive: minimum 100 samples (was 50); the lower end of the
  week's 95% Wilson interval must clear the threshold; "possible batch reporting" only after a week with no report,
  with a separate reason after a week with too few samples.
- `reporter_completeness` v1: recent weekly and monthly periods with fewer than 90% of the usual reporters are
  marked likely incomplete, in addition to the revision-based lag.
- Map windows with missing weeks are scaled to the full window and show the week count. Map legends use fixed,
  shared class breaks.
- `group_by_disease_place_gap` v3: a notice listing more than 10 countries is treated as a regional or global
  notice. It no longer adds its countries to an event or merges separate outbreaks (a single measles notice had
  produced a 237-country event).
- `active_rank` v2: weights 0.40 recency, 0.25 cases, 0.10 deaths, 0.05 countries, 0.20 source type.
- Polio default series changed from WHO WIISE to Our World in Data (wild plus vaccine-derived paralytic cases), with
  the wild and vaccine-derived parts shown under the headline. WIISE stays available as its own series; see
  LIMITATIONS for the anomalies that led to the change.
- Headline totals show what they are built from (measles: suspected, WHO total, laboratory-confirmed) and the same
  total for the constant panel of consistently reporting countries.

## 2026-11-11 — Event grouping v2, headline-count rule, positivity flags, constant panel, date basis
<!-- type: methodology -->
- `group_by_disease_place_gap` v2: notices that name no country are folded into the single country-level event of
  the same disease they overlap in time; if several overlap, nothing is merged. Retired event ids forward to the
  event that replaced them.
- Event cards show an extracted count only for events covering at most three named countries and with a stated
  case definition. Otherwise the figures stay on the event page, each with its quoted phrase.
- Influenza flags (`rolling_baseline_c2` v1) are now computed on percent positive (at least 10%, from periods with
  at least 50 samples) instead of on the number of detections, which rises whenever testing does.
- `constant_panel_total` v1: an optional world total over the countries that reported in at least 90% of the
  complete periods shown.
- Every series carries a `date_basis` (report date, source-assigned period, or calendar year) with the source's
  own field name. `freshness_days` can no longer be negative.

## 2026-11-10 — Dengue by first-level region; map missing-data reasons
<!-- type: methodology -->
`dengue_admin1_annual` v1: annual dengue counts by first-level region from the OpenDengue spatial extract, using the
same full-year rule as `dengue_annual_mixed`. Region names are matched to Natural Earth admin-1 boundaries only when
identical after case, accent and punctuation folding (or listed by a person in `config/admin1_aliases.yaml`);
unmatched names are published in the table and raised as an issue, never drawn. Counts only: no rates at this level.
Maps now distinguish "not yet reported for this period" (dotted) from "no report for this period" (hatched).

## 2026-11-10 — Signal flags v1 thresholds set after a first look at real data
<!-- type: methodology -->
`rolling_baseline_c2` v1: minimum count raised to 20 (weekly) and 30 (monthly); a flagged value must also be at least
twice the baseline mean; the seasonal check uses mean + 3 standard deviations. Reason: with the first real data the
plain three-standard-deviation rule flagged about 6% of country-weeks, mostly small fluctuations in low counts.

## 2026-11-10 — Initial method versions
<!-- type: methodology -->
`sum_daily_to_iso_week` v1, `sum_surveillance_systems` v1, `dengue_annual_mixed` v1, `window_rate` v1,
`revision_lag` v1, `reconcile_pairwise` v1, `group_by_disease_place_gap` v1, `gazetteer_match` v1,
`regex_count_extraction` v1, `active_rank` v1. Simulation engine 1.0.0, model spec 1.0.

# Methods changelog

Versioned log of method changes. Each entry starts with `## YYYY-MM-DD — title`. Method versions appear in every trace
panel and export, so a change here must come with a version bump in the code.

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

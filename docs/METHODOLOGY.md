# Methodology

UnderstandingOutbreaks aggregates and explains official public reports. It is not a surveillance system, not an
early-warning service, not a forecasting service, and not medical advice. The same text, in plain language and in
four languages, is on the site's Methodology page; this file is the reference version. Method changes are logged in
`docs/METHODS_CHANGELOG.md`.

## Pipeline

`python -m uo.build` runs: fetch → archive raw files (SHA-256) → change detection → validate → record revisions →
derive series → lag estimates and signal flags → events → publish atomically. Network errors are retried with
exponential backoff. A schema change (missing column, non-200 response, wrong format) is a hard failure for that
dataset.

**Validation gates** (`timeseries.validate_dataset`, `events.validate_events`): row count at least the configured
minimum; known case definitions and period types; dates not in the future and not before 1900; finite values;
negative values only where the dataset allows them (source corrections); no duplicate record for a series and period;
compared with the previous snapshot, no drop of more than 20% in rows, no mass change to zero (more than 200 values
of 50 or more, or 1%), no flood of new events (more than 50 and 30%), no loss of 30% of events. Any failure
**quarantines** the dataset: the last good data stays live, the data-quality page shows it, and an issue request is
written with the failing source, the error, the last good snapshot and a schema diff where detected.

## Normalization

- Places: ISO 3166-1 alpha-3. Two-letter codes are converted with the GeoNames country table.
- Periods: ISO weeks starting Monday; months; years. Daily values are summed into ISO weeks and an unfinished final
  week is dropped (`sum_daily_to_iso_week` v1).
- Values are kept exactly as published. Missing is never zero.
- Each series keeps its source, metric, case definition (confirmed, probable, suspected, notified, unknown, mixed,
  not applicable), the source's own wording for the definition, and its surveillance system. Different definitions
  always have different series ids and are never summed.

## Rates

`rate_per_100k = value / population × 100,000`, with the World Bank's most recent total population for the country.
One reference year is used for the whole series. Influenza uses percent positive (detections / specimens tested)
instead, because laboratory detections are not counts of people.

Map and ranking values use a window of complete periods (`window_rate` v1): the 4 most recent complete weeks, the
most recent complete month, or the most recent complete year, and need at least half of the window's periods.

## Default display series

Set per disease in `config/diseases.yaml`. Rule: prefer the primary official publisher, then the finest time
resolution it offers with national coverage. Other series remain selectable in Analyst mode and are never blended in.

| Disease | Default series |
|---|---|
| Influenza | WHO FluNet laboratory detections, summed over surveillance systems (site-derived) |
| COVID-19 | WHO confirmed cases, weekly |
| Mpox | WHO confirmed cases, weekly sums of daily values (site-derived) |
| Measles | WHO provisional monthly total (lab-confirmed + epi-linked + clinically compatible) |
| Cholera | Annual reported cases (Our World in Data, from WHO) |
| Polio | Annual officially reported cases (WHO immunization data) |
| Dengue | Annual value built from OpenDengue with the broadest definition available (site-derived, "mixed") |

## Revision history (data vintage)

Each run compares every value with the previous snapshot and stores only what is new, changed or removed
(`timeseries.record_revisions`). The data "as of" a snapshot is the last stored change at or before it
(`timeseries.as_of`). Snapshot ids are UTC timestamps, permanent and immutable. The frontend rebuilds earlier views
from `/data/v1/revisions/`. **Vintage reflects what this site retrieved and published, not necessarily when a source
first released a number.** Events record status, counts, notices and countries per snapshot in the same way.

## Reporting lag and "likely incomplete"

`revision_lag` v1 (`signals.estimate_lag`): for values revised by at least 5% after first publication, take the age
in periods at the snapshot of the last revision; the lag is the 90th percentile of those ages, at least the configured
default and at most 12. Until 4 snapshots and 30 revised values exist, the configured default is used and labelled
"configured default" (weekly 2, mpox 4, monthly 2, yearly 0).

The last `lag` periods up to the source's data edge are marked likely incomplete. They are shaded on charts, hatched
in tables, excluded from trend values, percentage changes, map windows, movers and signal flags, and can be hidden.

## Cross-source reconciliation

`reconcile_pairwise` v1: where two datasets report the same disease, place, period, period type, metric and case
definition, both are shown. They are flagged as disagreeing when they differ by more than 5 and by more than 5% of
the larger value. Nothing is averaged or merged, and derived series are not compared.

## Automated signal flags

`rolling_baseline_c2` v1 (`signals.compute_flags`), in the spirit of the EARS C2 method (Hutwagner et al. 2003), on
each country's default weekly or monthly series:

- baseline = 7 periods ending 3 periods before the tested period, with at least 5 values;
- flagged when `value > mean + 3 × sd`, `value ≥ 2 × mean`, and `value ≥ 20` (weekly) or `30` (monthly);
- `sd` is never taken below `sqrt(mean)`, which protects low counts;
- never in periods marked likely incomplete;
- not in holiday weeks (ISO weeks 52, 53, 1), and not when the previous period is missing or zero (batch reporting);
- seasonal diseases (influenza) must also exceed `mean + 3 × sd` of the same time of year (± 2 periods) in at least
  2 earlier years.

Suppressed candidates are published with the reason, so every decision can be inspected. Flags are informational
labels with a fixed neutral wording. They produce false positives (reporting changes, testing drives, backlogs) and
miss real changes. Annual series are not flagged. Parameters are published in `/data/v1/flags/{disease}.json`.

## Event notices

- **Disease normalization:** a declarative alias table; the longest alias wins; unmatched names go to "Other /
  unclassified" and into an issue request. Nothing is guessed.
- **Grouping** (`group_by_disease_place_gap` v1): same disease, at least one common country (or neither names one),
  at most 120 days apart. A notice that matches two open groups joins them. Event ids persist between runs.
- **Counts** (`regex_count_extraction` v1): the first stated case and death counts in the notice text, with the exact
  quoted phrase (at most 14 words) and the stated definition. Words are never converted to numbers.
- **Status:** "ongoing" and "declared over" only when the latest notice says so; otherwise "reported"; after 90 days
  without a notice, "no recent update", a recency indicator and not a judgment.
- **Summaries** (`template_summary` v1) are assembled in the interface from structured fields, with quoted phrases
  marked and the original notice linked. They contain no advice or speculation.

## Geocoding and precision

`gazetteer_match` v1, offline only. Countries come from the notice title (or a feed's country list), matched
longest-name-first. A first-level region is added when its name appears next to an administrative word (Province,
Region, State, …); a city of 100,000 or more when written as "city of X" or "X city". Region positions are the
population-weighted centre of GeoNames cities in the region. Every location carries its precision (country, admin1,
admin2, point); admin2 is not produced because no district gazetteer is bundled.

## List order of outbreaks

`active_rank` v1: `0.45 × exp(−days/30) + 0.25 × min(1, log10(1+cases)/5) + 0.10 × min(1, log10(1+deaths)/4) +
0.10 × min(1, countries/5) + 0.10 × source type` (1.0 WHO Disease Outbreak News, 0.6 travel notices). Events not
declared over with a notice in the last 180 days are "active". The score orders a list; it is not a severity rating.

## Workbench transforms

Fixed order: per-capita → rolling average (trailing; blank if any period in the window is missing) → cumulative →
percent of peak → align by first report. Log scale is display only. Active transforms appear in the chart subtitle,
the trace panel and every export. "Copy as code" reproduces a view from the revision history at a fixed snapshot.

Safeguards built into the tools: warnings when a query, chart or pivot combines case definitions, sources, diseases
or likely-incomplete periods, with a one-click restriction; defaults use the default series, per-capita rates and
exclude incomplete periods; user overlays are labelled and left out of data exports.

## Data quality page

Built from pipeline outputs: last successful fetch, cadence, latest period and its age, completeness (share of
ever-reporting places present in the most recent complete periods), revision rate, lag, link-check status, license.
A source is stale when its latest period is older than twice its cadence plus 14 days.

## Simulation engine

See `docs/SIMULATION.md`. The engine cannot read the reported data; there is no fitting, calibration,
reproduction-number estimation, nowcasting or forecasting on this site.

## Limitations and a warning

See `docs/LIMITATIONS.md`. **Do not compare counts across diseases**: each is counted by a different surveillance
system under a different case definition. Compare a disease with itself over time, or places within one disease and
definition, preferably per 100,000 people.

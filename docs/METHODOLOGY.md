# Methodology

Understanding Outbreaks aggregates and explains official public reports. It is not a surveillance system, not an
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

### How often it runs

- **Every six hours** (05:17, 11:17, 17:17, 23:17 UTC) the full pipeline runs. Notice feeds are read on every run;
  time-series sources are re-downloaded at most once a day (weekly sources daily, monthly weekly, yearly monthly).
  The 05:17 run always rebuilds and deploys. The other three deploy only when something changed (a new or revised
  value, or a change to an outbreak); otherwise nothing is published and no snapshot is saved.
- **Every hour** in between, `uo.notice_check` reads the recent part of the three notice feeds and compares the
  notice ids with the list the last run published (`events/report_ids.json`). If a feed lists a notice the site does
  not have, it starts a full run. The check writes no data. A source it cannot read is skipped; the full run is what
  reports source failures.
- So a new official notice normally appears on the site within about an hour and a quarter of the source listing
  it. Edits to a notice already on the site are picked up by the next six-hourly run.

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

`reporter_completeness` v1 (`signals.completeness_lag`), weekly and monthly sources: "usual" is the median number of
places reporting per period over the periods 16 to 5 before the newest one. Walking back from the newest period, a
period counts as incomplete while fewer than 90% of the usual number have reported (at most 8 periods). The lag used
is the larger of this count and the revision-based estimate, and the series metadata says which one applied
(`lag.basis`, `lag.completeness`). This is what marks a week with 71% of the usual influenza reporters as incomplete
even though the configured default would not.

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

Influenza is flagged on the percentage of samples positive (`rolling_baseline_c2` v2 for this basis):

- `paired_positivity` v1 (`timeseries.flu_paired`): detections and samples are divided only when the same
  surveillance system reported both for the same week. A system that reports detections without samples does not
  enter the ratio, and a system-week with more detections than samples is dropped as not computable. Dividing the
  national sum of detections by the national sum of samples mixed systems and produced values above 100%.
- FluNet leaves the detections field blank, never 0, when samples were tested and none was positive (the file
  contains no zero; wherever the negative count is filled in on such rows it equals the samples processed). A blank
  detections field beside a positive number of samples is therefore read as zero. It stays missing when no samples
  were processed or when the negative count is lower than the samples processed.
- A week needs at least 100 paired samples and at least 10% positive. The lower end of the week's own 95% Wilson
  interval must also be above the threshold; otherwise the candidate is recorded as
  `suppressed-within-sampling-uncertainty`.
- "Possible batch reporting" applies only after a week with no report. A candidate that follows a reported week with
  too few samples is recorded as `suppressed-previous-week-too-few-samples`. A 0% week is a value, not a gap.
- The map value for a country is paired detections ÷ paired samples over the window, shown only from 50 paired
  samples; otherwise the country is drawn as "not computable" with the reason.

The seasonal rule is strict on purpose. During a normal season nearly every candidate is set aside as
`suppressed-within-seasonal-range`, because a rise at that time of year is expected (for example about 30% positive
in Canada in week 48). A week is flagged only when it is well above the same weeks of earlier seasons, or when the
rise is outside the season. The alternative, flagging every seasonal rise, would flag most temperate countries every
winter.

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

## Subnational data (first-level regions)

Method `dengue_admin1_annual` v1 (`pipeline/uo/subnational.py`). One product so far: annual dengue counts by
first-level region, for the countries where OpenDengue reports at that level.

- **Annual values.** For each region and year: an annual record if the source has one; otherwise the sum of 12
  monthly records; otherwise the sum of at least 52 weekly records. Where several case definitions exist the
  broadest is used, and the definition is published with every value. The current year is left out.
- **Matching names to boundaries.** A source name is matched to a Natural Earth admin-1 region of the same country
  only when the two are identical after removing case, accents, punctuation and generic words such as "province"
  (spacing is also ignored, so "Chonburi" matches "Chon Buri"). A name that fits two regions is ambiguous and not
  matched. Nothing is matched by similarity. A person can add a reviewed mapping in `config/admin1_aliases.yaml`.
- **Unmatched names** stay in the published table, marked as not on the map, and are listed in a GitHub issue.
- **Two names for one region.** If two source names match the same region and both report the same year, the
  region is left off the map for that year and the table says so; the values are never added together.
- **Counts, not rates.** No population figures are available at this level from the sources this site reads, so no
  rate is computed. The page says that a darker region is not necessarily at higher risk.
- **Not done.** Second-level (district, municipality) records are not added up into regions.
- **Boundaries** are simplified (outline thinning at 0.01 degrees, three decimal places, islets below about 4 km²
  dropped unless they are a region's only polygon). They are approximate and imply no position on any territory.

## Maps

Class breaks are fixed and shared by every map, period and view of a measure: rates per 100,000 use tenfold steps
(0.01, 0.1, 1, 10, 100) and percent positive uses 2, 5, 10, 20, 40. A colour therefore always means the same range.
(Earlier versions used sextiles of whatever was on screen, so the top class could span 0.76 to 168 per 100,000.)

A weekly window with missing weeks is scaled to the full window (mean of the reported weeks × number of weeks) and
needs at least half the weeks; the number of weeks reported is shown with the value.

- **Why a place has no value.** For a given period a place is either "not yet reported" (it has reported to this
  source before, and this period is later than its last report; dotted) or "no report for this period" (hatched).
  The tooltip and the table also say when a place has never reported to the source. None of these means no disease.
- **Projections.** The interactive map offers Web Mercator and a globe. Mercator inflates areas far from the
  equator. The equal-area view and the small multiples use the Equal Earth projection, drawn as plain SVG.
- **Small multiples** by period share one colour scale; by disease each panel has its own scale and its own latest
  complete period, and the page says so.
- **Event points** are sized by how recent the latest notice is. A faint ring marks a notice that names only a
  country or a first-level region: the wider the ring, the vaguer the location.
- **Colour-vision check (2026-11-11).** The colour scales and the event markers were run through a simulation of
  protanopia, deuteranopia and tritanopia (Machado et al. 2009 matrices, full severity). The rate scale keeps a
  strictly decreasing lightness in all four conditions, with a smallest step between neighbouring classes of
  CIE76 ΔE 9 (protan, the two palest classes) and ΔE 11 or more elsewhere. The reporting-completeness scale was
  redrawn after the check: its two palest steps were ΔE 5.6 and 8.2 even for typical vision; they are now 9.7 or
  more in every condition. Event markers were darkened from `#7a5c00` to `#4d3900`: against every class of the
  rate scale either the marker or its white ring now has a luminance contrast of at least 3.4:1 (the old colour
  fell to 2.6:1 on the middle class). This is a computed check, not a test with colour-blind readers.
- **Basemap.** OpenStreetMap data as Protomaps PMTiles, built by `.github/workflows/build-basemap.yml` and served
  from the project's own bucket. Shaded areas are drawn beneath the basemap's place labels.

## Outbreak Spread Explorer

The Spread Explorer (`/spread/{event_id}`) replays one event notice by notice. It is a map of reporting, not of
transmission, and it is built only from the event file the pipeline already publishes (`events/{id}.json`).

- **Date shown for a country**: the publication date of the earliest notice in the event that lists the country in
  its country field (or, failing that, the earliest notice from which the site located a place in that country). It
  is labelled "first official notice", never "first case". If an earlier notice mentions the country only in its
  text, and one of the sentences the pipeline quotes shows that, the sentence is displayed beside the country; the
  map date does not change.
- **Routes**: none are drawn and none are inferred. There are no lines or arrows between places. Sentences about
  importation, travel or evacuation (`route_quotes`) and about symptom onset (`onset_quotes`) are shown verbatim.
  They are picked by keyword (`events.py`, `ROUTE_RX`, `ONSET_RX`) and can miss context.
- **Adjacent countries**: land neighbours (Natural Earth) of countries with a notice are hatched and labelled
  "adjacent". This is geography only.
- **Regions and towns**: a first-level region named in a notice is drawn as a dashed ring at the region's
  population-weighted centre; the position within the region is unknown. A dot is drawn only for a town a notice
  names, and marks the town, not a case.
- **Counts**: the label under the map is the most recent case count a notice had stated by the selected date, in the
  notice's words. It is omitted for events whose counts are suppressed (several countries or mixed definitions).
- **Reporting completeness**: each country carries its `reporting_health` text for the disease's routine series,
  or a statement that the site holds no such series.
- **Side-by-side series**: the routine default series for up to six countries, on one time axis and optionally one
  vertical scale, with the incomplete recent periods drawn as in every other chart.
- **No projection**: nothing on the page extends past the last notice.
- **Exports**: GeoJSON (points with precision and notice provenance; a `metadata` member with sources, snapshot and
  caveats), a CSV bundle with provenance sidecar and data dictionary, and a link pinned to the snapshot and date.

## List order of outbreaks

`active_rank` v2: `0.40 × recency + 0.25 × cases + 0.10 × deaths + 0.05 × countries + 0.20 × source type`.

- `recency = exp(−days since last notice / 30)`. This is an e-folding scale (37% after 30 days), not a half-life.
- `cases = min(1, log10(1 + cases) / 5)` and `deaths = min(1, log10(1 + deaths) / 4)`: they saturate at 100,000 cases
  and 10,000 deaths.
- `countries = min(1, countries / 5)`. An event whose notices name no single country scores 0 here.
- `source type`: 1.0 WHO Disease Outbreak News, 0.8 ECDC epidemiological updates, 0.6 CDC travel notices
  (`source_type_weight` in `config/datasets.yaml`).
- v2 raised the weight of source type (0.10 → 0.20) and lowered breadth (0.10 → 0.05), so a standing travel notice,
  which is re-dated often and states no counts, no longer sits above a WHO outbreak notice with counts.

Events not declared over with a notice in the last 180 days are "active". The score orders a list; it is not a
severity rating.

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

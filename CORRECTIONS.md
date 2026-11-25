# Corrections

Hand-edited log of corrected errors on the site. Each entry starts with `## YYYY-MM-DD — title`. An optional
`<!-- type: correction|mapping|pipeline -->` line sets the label shown on the public changelog page.

## 2026-11-25 — Archive notices from 1998 to 2021 were shown as recent outbreaks
<!-- type: correction -->
The World Health Organization re-issued its archive of older Disease Outbreak News under new dates (most of them
in February and March 2024, others in 2022). This site read that re-issue date as the date of publication, so 299 notices first
published between 1998 and 2021 appeared as notices from 2022 to 2024, and 128 outbreak pages were built from them
alone (for example a yellow fever notice of January 2000 shown as March 2024). The site now uses the date each
notice was first published, which WHO's feed also carries, and shows only notices first published since 1 January
2022. The outbreak list went from 330 to 202 events. Counts on the remaining pages are unchanged. The addresses of
the withdrawn pages now say that the page was withdrawn and link here. The error was on the site from its first
public snapshot (10 November 2026) until this correction.

## 2026-11-10 — Removed values are no longer shown again in earlier-snapshot views
<!-- type: correction -->
Before the first public snapshot, reconstructing "data as of" an earlier snapshot could bring back a value that the
source had since removed. Fixed in the pipeline and in the generated Python code before any snapshot was published.

## 2026-11-10 — Outbreak notices naming several countries are grouped into one event
<!-- type: mapping -->
A notice that named countries from two separate open events (for example a travel notice for one country and an
outbreak notice for another) left the events split. Such notices now join the events into the earlier one.

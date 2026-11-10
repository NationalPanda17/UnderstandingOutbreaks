# Corrections

Hand-edited log of corrected errors on the site. Each entry starts with `## YYYY-MM-DD — title`. An optional
`<!-- type: correction|mapping|pipeline -->` line sets the label shown on the public changelog page.

## 2026-11-10 — Removed values are no longer shown again in earlier-snapshot views
<!-- type: correction -->
Before the first public snapshot, reconstructing "data as of" an earlier snapshot could bring back a value that the
source had since removed. Fixed in the pipeline and in the generated Python code before any snapshot was published.

## 2026-11-10 — Outbreak notices naming several countries are grouped into one event
<!-- type: mapping -->
A notice that named countries from two separate open events (for example a travel notice for one country and an
outbreak notice for another) left the events split. Such notices now join the events into the earlier one.

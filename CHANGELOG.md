# Changelog

Release notes. Each entry starts with `## YYYY-MM-DD — title` and is shown on the public changelog page.

## 2026-11-12 — Citing, following and comparing
<!-- type: feature -->
- Cite: every chart, map, headline figure, event and map country now opens a panel with a ready-to-paste sentence,
  the original source, the date of the data, how the number was made, and a link pinned to that exact version.
- Feeds: disease, country and outbreak pages link to their feed of official notices; feed readers can find the
  all-notices feed from any page. Feed entries name the countries a notice covers.
- What changed between two dates: readable dates, a one-day default, a link that keeps the chosen dates, and a new
  table of outbreak events that are new or whose status, stated counts, notices or countries changed.
- Outbreak list: a timeline strip showing each event from its first official notice to its latest.
- Reporting: how up to date and how complete each country's reporting is now appears in the disease table and in
  the map's country panel, not only on country pages.
- Keyboard and screen readers: the map is one tab stop; arrow keys move between countries, a letter jumps to a
  country by name, Enter opens it, and the current country is announced. Scrollable tables can be reached by
  keyboard. An automated accessibility audit of twelve pages reports no remaining issues.
- Dengue regions: 22 more source names are drawn after review; names that cannot be drawn on these boundaries are
  recorded with the reason in `config/admin1_aliases.yaml`.

## 2026-11-12 — Correctness and credibility pass
<!-- type: correction -->
- Influenza percent positive could exceed 100% where detections and samples came from different surveillance
  systems. It is now computed only within systems that report both, and shown as not computable otherwise.
- Weeks with samples tested and no influenza found were stored as missing; they are now zeros.
- Influenza flags need at least 100 samples and must clear the threshold after allowing for sampling uncertainty.
- Recent periods with fewer countries reporting than usual are now marked incomplete.
- A single notice naming hundreds of countries no longer creates a world-sized event.
- Polio: the headline now uses the series that includes both wild and vaccine-derived cases, with the split shown.
- Maps use one fixed colour scale per measure; partial windows are scaled and show how many weeks were reported.
- Machine-drafted Spanish, French and German are no longer offered in the language menu until reviewed.
- New: source status page, fuller method parameters, links in the reporter's guide.

## 2026-11-11 — More frequent updates
<!-- type: feature -->
- The site now checks the official notice feeds every hour and runs a full update as soon as a new notice is listed.
- The full update runs every six hours instead of once a day. A run that finds nothing new publishes nothing.

## 2026-11-11 — Outbreak Spread Explorer
<!-- type: feature -->
- New tool: step through one outbreak notice by notice. Countries appear on the date of the first official notice
  naming them, with each country's reporting record beside it. It is a map of reporting: no routes are drawn or
  inferred, wording about importation or onset is quoted from the notice, and nothing is projected forward.
- Adjacent countries are marked as adjacent only; regions named in a notice are rings, towns are dots only when a
  notice names them. Routine series for the affected countries sit side by side on shared axes.
- Exports: GeoJSON, CSV with provenance, and a link pinned to the snapshot and notice date.
- Context links: Pathoplexus sequence pages and US CDC wastewater datasets (United States only).

## 2026-11-10 — Maps, regions, search, ECDC notices
<!-- type: feature -->
- Map: equal-area view, small multiples (per period or per disease), globe projection, region presets, a basemap
  with place labels in the page language, and separate patterns for "not yet reported" and "no report".
- Event notices on the overview map; points sized by recency, with a ring showing how precisely a notice
  locates the event.
- Dengue by first-level region for 30 countries (annual counts; names matched to boundaries exactly or not at all).
- Site search for diseases, countries, disease-in-country, events and pages, matched in the browser.
- ECDC epidemiological updates added as an event source.
- Faster first load: lighter world boundaries and two small summary files for the home page.

## 2026-11-10 — First build
Time series for influenza, COVID-19, mpox, measles, cholera, dengue and polio; event notices from WHO Disease Outbreak
News and US CDC travel health notices; source registry and record-level provenance; revision history; reporting-lag
marking; automated signal flags; exports, embeds and pinned views; analysis workbench; educational simulation sandbox;
English with machine-drafted Spanish, French and German.

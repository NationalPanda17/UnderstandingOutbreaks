# Changelog

Release notes. Each entry starts with `## YYYY-MM-DD — title` and is shown on the public changelog page.

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

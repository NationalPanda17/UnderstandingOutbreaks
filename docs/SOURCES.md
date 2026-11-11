# Sources

Every endpoint below was requested live on **2026-11-09 / 2026-11-10** before its connector was written. This file
records what was found: URL, schema, cadence, license, whether history and revisions can be captured, and whether the
license permits archiving the raw files publicly. The machine-readable registry is `config/sources.yaml`.

"License verification" has two values. *verified-live*: the statement was read from the publisher's site on the date
shown. *stated-unverified*: the license is widely documented but the statement could not be machine-read on that date
(typically a JavaScript-rendered page). For every *stated-unverified* source, raw files are **not** redistributed
unless the license is unambiguous; only the hash, metadata and link are published. **All license entries are flagged
for human review.**

## Tier 1 time series

| Disease | Dataset (`config/datasets.yaml`) | Source | Resolution | Latest period found | History captured | Revisions |
|---|---|---|---|---|---|---|
| Influenza | `who_flunet_weekly` | WHO FluNet (GISRS), xMart OData `FLUMART/VIW_FNT` | weekly | week of 2026-11-02 | from 2019 (configurable `start_year`) | full table re-fetched each run, so every later change is recorded |
| COVID-19 | `who_covid_weekly` | WHO COVID-19 dashboard weekly CSV | weekly | week of 2026-10-12 (file modified 2026-11-04) | from 2020 | full file each run |
| Mpox | `who_mpox_daily` | WHO xMart `MPX/V_MPX_VALIDATED_DAILY` | daily → ISO week (site-derived) | 2026-09-27 | from 2022 | full table each run |
| Mpox (second source) | `owid_mpox` | Our World in Data catalog CSV | daily → ISO week | **2025-02** (file not modified since 2025-02-20) | from 2022 | kept only for reconciliation; shown with a stale badge |
| Measles | `who_measles_monthly` | WHO provisional monthly measles and rubella spreadsheet | monthly | 2026-10 (file modified 2026-10-12) | from 2012 | full file each run |
| Measles (annual) | `who_wiise_measles` | WHO Immunization Data, xMart `WIISE/MT_AD_INC_LONG` | yearly | 2025 | from 1980 | full table each run |
| Measles (annual, second source) | `owid_measles` | Our World in Data grapher (processed from WHO GHO) | yearly | 2024 | from 1974 | full file each run |
| Polio | `who_wiise_polio` | WHO Immunization Data, `MT_AD_INC_LONG` | yearly | 2025 | from 1980 | full table each run |
| Polio (second source) | `owid_polio` | Our World in Data grapher (WHO and GPEI) | yearly | 2023 | from 1980 | full file each run |
| Cholera | `owid_cholera` | Our World in Data grapher (WHO annual cholera reports) | yearly | 2024 | long history | full file each run |
| Cholera (second source) | `who_gho_cholera` | WHO GHO OData `CHOLERA_0000000001` | yearly | **2016** | to 2016 | stale; reconciliation only |
| Dengue | `opendengue_national` | OpenDengue national extract V1.3.1 (GitHub) | week / month / year as compiled | 2024 (complete years) | long history | pinned release; a new release is a config change |

### Decisions and demotions

- **Polio, cholera and dengue have no reliable open weekly or monthly global series.** WHO's POLIS API needs a token;
  the GPEI case-count page has no machine-readable table; WHO GHO cholera stops in 2016; WHO's dengue dashboard has no
  public data endpoint (`DATA_/RELAY_DENGUE_GLOBAL` is not exposed). These three therefore have **annual** series
  only and rely on **event notices** (Phase 2 handling) for anything current. Their pages say so, and the annual
  series carry no signal flags.
- **Dengue definitions differ by country and year.** OpenDengue's standardised definition is kept on every record
  and never summed across. The site derives one yearly value per country (`dengue_annual_mixed` v1) and labels it
  "mixed definitions"; it must not be used to rank countries, and the UI says so.
- **Influenza is shown as laboratory detections and percent positive**, not cases: FluNet counts positive samples.
  WHO FluID (`VIW_FID_EPI`, syndromic ILI/SARI) is reachable but not ingested yet.
- **Measles default** is WHO's provisional "measles total" (laboratory-confirmed + epidemiologically linked +
  clinically compatible), labelled "notified". Suspected and laboratory-confirmed are separate series. WHO asks that
  provisional numbers be cited with their as-of month; the trace panel shows the retrieval date.
- **Mpox** has one undated row per country in the source (cases with no known date). It cannot be attributed to a
  week and is left out; this is noted here because it makes the weekly sums lower than WHO's cumulative totals.
- **Negative values.** WHO COVID-19, mpox and measles files contain a few negative values (retrospective
  corrections). They are kept as published and flagged `negative-correction-in-source`.
- **FluNet duplicates.** The API returned 84 byte-identical duplicate rows (Bhutan, 2025). Identical rows are
  collapsed; rows that disagree would fail validation.

### Sources evaluated and not used

| Source | Finding (2026-11-09) | Decision |
|---|---|---|
| ECDC open-data CSVs (COVID-19 national case/death, mpox) | Reachable but frozen (last modified 2023-12-01 and 2023-02-15) | Not used |
| ECDC Communicable Disease Threats Report | RSS feed reachable (weekly, CC BY 4.0), but content is PDF reports covering many topics, not per-event records | Not ingested; candidate for a linked-report feed |
| US CDC data.cdc.gov (e.g. `pwn4-m3yp`) | Reachable; US-only | Not used for the global Tier 1 set |
| PAHO dengue indicators page | HTTP 502 | Dropped |
| Africa CDC RSS feed | Reachable but contained no items | Dropped |
| GPEI wild poliovirus and cVDPV count pages | Re-checked 2026-11-11: the counts are an embedded Power BI report, not a table or file | Not used directly |
| WHO POLIS API | Re-checked 2026-11-11: the service document is public but every data request returns 401 without a token | Not used until a maintainer obtains a token |
| Our World in Data: wild poliovirus cases; cVDPV cases by strain | Annual, by country, processed from WHO and GPEI. Covers 2001–2023 (wild) and 2016–2023 (cVDPV); last updated by OWID in April 2024. Wild types are not separated (WPV1/2/3 together) | **Used** for the wild versus vaccine-derived split, marked stale because it ends in 2023 |
| UN population API, geoBoundaries | Reachable | Not needed (World Bank and Natural Earth used) |

### Evaluated for the Spread Explorer and not ingested

| Wanted | What was found | Decision |
| --- | --- | --- |
| Sub-national case series for outbreaks (WHO AFRO, ministry situation reports) | PDF situation reports with no machine-readable listing; tables differ between issues | Not ingested. Numbers would have to be transcribed by hand or scraped from PDFs, which this project does not do. Only OpenDengue first-level data is used. |
| Structured onset dates and travel history | WHO DON and CDC notices carry these only as prose | Not available as fields. The pipeline quotes the sentences (`route_quotes`, `onset_quotes`) and infers nothing. |
| Wastewater sampling sites | US CDC NWSS publishes open datasets on data.cdc.gov (measles, influenza A, SARS-CoV-2, mpox, RSV, H5), by treatment plant and county, without site coordinates. No comparable multi-country official feed was found. | Not ingested. One country's sites on a world tool would misstate coverage. Linked from disease pages as context, labelled United States only. |
| Genomic lineages | Nextstrain and Pathoplexus | Linked as context only (`config/context_links.json`); nothing is fetched by the browser unless clicked. |

## Event sources (Tier 2)

| Source | Endpoint | Structure | Cadence | License | Decision |
|---|---|---|---|---|---|
| WHO Disease Outbreak News | `https://www.who.int/api/news/diseaseoutbreaknews` (OData; 3,204 notices in total) | Title, publication date, id, HTML summary and overview | several per week | WHO terms of use; publications are CC BY-NC-SA 3.0 IGO | **Primary.** Notices from 2022-01-01. Text is not redistributed: only titles, links, dates and short quoted phrases |
| US CDC Travel Health Notices | `https://wwwnc.cdc.gov/travel/rss/notices.xml` | RSS items with level, disease, country list | as issued | US Government work | **Used.** The feed lists current notices only; earlier ones are kept from previous runs |
| ECDC epidemiological updates | `https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed` (RSS; 10 most recent items, checked 2026-11-10) | Title, link, date, one-paragraph description; no country list | a few per month | ECDC copyright notice; reuse terms not confirmed, so only titles, dates and links are shown and the raw feed is not redistributed | **Used.** Only items whose title names a disease in the vocabulary are kept; earlier items are kept from previous runs. Notices carry no country, so they join the multi-country event for that disease |
| ECDC CDTR | `https://www.ecdc.europa.eu/en/taxonomy/term/1505/feed` | Weekly PDF reports covering many topics | weekly | as above | Not ingested: not per-event records |
| PAHO | `https://www.paho.org/en/rss.xml` is general news (checked 2026-11-10); epidemiological alerts are listed only as an HTML page | – | – | – | Not used: no machine-readable feed of alerts |
| Africa CDC | `https://africacdc.org/news-item/feed/` now has items (checked 2026-11-10) but they are general news and statements, not per-event records | – | – | unclear | Not used |
| WHO Regional Office for Africa | `https://www.afro.who.int/rss/emergencies.xml` held 2 items, the newest from 2025 (checked 2026-11-10) | – | – | – | Not used: stale |
| CDC Health Alert Network | HTTP 403 to automated clients | – | – | – | Dropped |
| ReliefWeb | API v1 retired; v2 requires an approved app name | – | – | – | Not used until a maintainer registers an app name |
| WHO Ebola / Bundibugyo virus disease situation reports | Checked 2026-11-11: published as PDF documents. WHO's public listings (`/api/hubs/publications`, `/api/news/documents1`) return no current situation reports for this outbreak (the newest Ebola situation report listed is from 2020) | – | – | – | Not ingested. No machine-readable listing was found, and this site does not transcribe figures from PDFs by hand |
| WHO monthly multi-country cholera situation reports | Checked 2026-11-11: PDF documents; not present in the same listings (only the annual "Global situation report for cholera" appears) | – | – | – | Not ingested, for the same reason |
| ProMED | subscription / restricted | – | – | – | Not used |

Events participate in revision history: each run records status, counts, number of notices and countries per event,
and appends an entry when any of them changes.

Explicitly mapped and tested diseases: Ebola, Marburg, Nipah, MERS, Lassa fever, avian and other zoonotic influenza
(H5N1 and others), chikungunya, Zika, yellow fever, meningitis, diphtheria (plus the Tier 1 diseases and several
more). On the first run 33 names in notices were not in the mapping (for example "Japanese Encephalitis" before it
was added, "Undiagnosed disease", "Hurricane"); they appear under "Other / unclassified" and are listed in a GitHub
issue request so a person can extend `config/diseases.yaml`. Nothing is guessed.

## Reference data

| Purpose | Source | License | Raw archived publicly |
|---|---|---|---|
| Boundaries | Natural Earth admin-0 countries 1:50m (`naciscdn.org`) | Public domain (verified live) | yes |
| Population | World Bank `SP.POP.TOTL`, most recent year per country | CC BY 4.0 | yes |
| Countries, neighbours, area | GeoNames `countryInfo.txt` | CC BY 4.0 (verified live) | yes |
| First-level regions and cities for offline geocoding | GeoNames `admin1CodesASCII.txt`, `cities15000.zip` | CC BY 4.0 (verified live) | yes |
| Basemap (optional) | Protomaps build from OpenStreetMap | ODbL (data), BSD/CC0 (style) | built by a maintainer |

No second-level (district) gazetteer is bundled, so `admin2` precision is never produced.

## License and archiving summary

| Source | License recorded | Verification | Raw files redistributed |
|---|---|---|---|
| WHO FluNet, mpox, measles, WIISE, GHO | WHO terms of use (attribution) | stated-unverified | **no** (hash + link only) |
| WHO COVID-19 dashboard data | CC BY 4.0 as stated on data.who.int | stated-unverified (page is rendered by JavaScript) | **no**, until a person confirms |
| WHO Disease Outbreak News | WHO terms; text not redistributed | verified-live (WHO copyright page) | **no** |
| Our World in Data | CC BY 4.0 | stated-unverified | yes |
| OpenDengue | CC BY 4.0 as described by the project | stated-unverified (repository has no license file; site is JavaScript-rendered) | **no**, until confirmed |
| US CDC travel notices | US Government work | stated-unverified | yes |
| World Bank | CC BY 4.0 | stated-unverified | yes |
| Natural Earth | Public domain | verified-live | yes |
| GeoNames | CC BY 4.0 | verified-live | yes |

## Identifiers flagged for human review

`config/diseases.yaml` carries ICD-11 and MeSH identifiers only where the mapping was judged clear, and leaves the
rest blank. **They were entered from memory, not looked up live, and all need checking**: ICD-11 `RA01` (COVID-19),
`1E71` (mpox), `1F03` (measles), `1A00` (cholera), `1C81` (poliomyelitis), `1C17` (diphtheria); MeSH `D007251`
(influenza), `D000086382` (COVID-19), `D045908` (mpox), `D008457` (measles), `D002771` (cholera), `D003715` (dengue),
`D011051` (polio), `D019142` (Ebola), `D008379` (Marburg), `D007835` (Lassa), `D065632` (chikungunya), `D000071243`
(Zika), `D015004` (yellow fever), `D008581` (meningitis), `D004165` (diphtheria) and the others in the file.
Influenza and dengue have no single ICD-11 code and are blank.

## Simulation presets and references (all flagged for human review)

| Preset | Cited range | Citation | Status |
|---|---|---|---|
| measles-like | R0 12–18 ("often cited"; the review found wider variation) | Guerra et al., Lancet Infect Dis 2017, doi:10.1016/S1473-3099(17)30307-9 | Range read from the PubMed abstract (PMID 28757186) on 2026-11-10 |
| influenza-like | seasonal median R 1.28 (IQR 1.19–1.37) | Biggerstaff et al., BMC Infect Dis 2014, doi:10.1186/1471-2334-14-480 | Values read from the PubMed abstract (PMID 25186370) on 2026-11-10 |
| cholera-like | none | none | **Unverified, user-supplied**: selects the waterborne template with round numbers |

Incubation and infectious periods in the presets are round numbers with no citation and are labelled "unverified,
user-supplied" in the interface. A COVID-like preset was considered and **omitted**: the candidate source (Liu et al.,
J Travel Med 2020) has no abstract from which the value could be verified.

Method references (Lloyd-Smith 2005; van den Driessche & Watmough 2002; Kermack & McKendrick 1927; Gillespie 1977;
Tien & Earn 2010; Hutwagner 2003; Delamater 2019) were checked against Crossref on 2026-11-10 for existence, title,
journal and pages. Their content was not re-read.

**Contact matrices.** No openly licensed contact-survey dataset was verified live for this build, so none is bundled.
The age-structured template uses a synthetic, user-editable matrix and says so.

## Context links (Phase 3)

`config/context_links.json` lists outbound links to Nextstrain and official travel and health pages. They were not
individually re-checked live and are flagged for review; the link checker covers registry and dataset URLs only.

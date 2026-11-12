# Translations

English is the source language. **Spanish, French and German were machine-drafted and have not been professionally translated.** Every string below is flagged for human review until a reviewer records it in `site/src/i18n/review-status.json`.

Health-related wording is the priority for review and is listed first: summaries, caveats, glossary, signal-flag explanations, the reporter's guide, guided tours, tool warnings, simulation disclaimers, model assumption text, lessons and trace-panel explanations.

Source titles, notices and quoted phrases are never translated; they are shown in their original language with a link.

## How to review

1. Edit the string in `site/src/i18n/locales/<locale>.json`.
2. Add the key to `site/src/i18n/review-status.json` under the locale, e.g. `{"es": {"footer.positioning": {"status": "reviewed", "by": "native speaker, public health", "date": "YYYY-MM-DD"}}}`.
3. Run `node site/scripts/translations-report.mjs` and `npm run check:i18n`.

## Adding a language

Drop a translated copy of `en.json` into `site/src/i18n/locales/` and add one line to `locales` in `config/site.json`. No code changes; right-to-left scripts set `"dir": "rtl"`.

## Status summary

| Locale | Language | Status | Strings | Reviewed | Awaiting review |
|---|---|---|---|---|---|
| en | English | source | 1851 | – | – |
| es | Español | machine-drafted | 1851 | 0 | 1851 |
| fr | Français | machine-drafted | 1851 | 0 | 1851 |
| de | Deutsch | machine-drafted | 1851 | 0 | 1851 |

## Español (es): strings by review status

### Positioning, disclaimers and persistent notices

9 strings: 0 reviewed, 9 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`persist.notice`, `persist.more`, `footer.positioning`, `methodology.scope.title`, `methodology.scope.p1`, `methodology.scope.p2`, `about.not.title`, `about.not.p1`, `embed.disclaimer`

</details>

### Event summaries and status wording

33 strings: 0 reviewed, 33 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`status.reported`, `status.ongoing`, `status.declared_over`, `status.no_recent_update`, `status.reported.explain`, `status.ongoing.explain`, `status.declared_over.explain`, `status.no_recent_update.explain`, `statusbasis.source-stated`, `statusbasis.source-published`, `statusbasis.recency-indicator`, `event.automated`, `event.summaryNote`, `event.sum.intro`, `event.sum.cases`, `event.sum.deaths`, `event.sum.noCounts`, `outbreak.statusQuote`, `outbreak.countsNote`, `outbreak.precisionNote`, `status.title`, `status.lead`, `status.summary`, `status.dataset`, `status.state`, `status.checked`, `status.changed`, `status.latest`, `status.cadence`, `status.ok`, `status.quarantined`, `status.note`, `status.source`

</details>

### Caveats and "what this means" text

43 strings: 0 reviewed, 43 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`chart.incomplete`, `chart.incompleteShort`, `chart.incompleteTip`, `chart.incompleteNote`, `overview.means.rate`, `overview.means.pct`, `overview.means.caveat`, `flags.caveat`, `mappage.means.disease`, `mappage.means.density`, `mappage.means.points`, `place.means.cases`, `place.means.detections`, `pin.vintage`, `disease.globalMeans`, `disease.topCaveat`, `changes.moversCaveat`, `explorer.means`, `overlay.means`, `mapsel.means`, `sim.means.ode`, `sim.means.stochastic`, `sim.means.re`, `obs.means.final`, `obs.means.view`, `ens.means`, `branch.means`, `phase.means`, `net.means`, `meta.means`, `mappage.means.flat`, `mappage.means.missing`, `mappage.means.proj`, `regions.means`, `regions.means.unmatched`, `regions.means.conflicts`, `mappage.means.reporting`, `timeline.means`, `spread.caveatReporting`, `spread.caveatFirst`, `spread.caveatNamed`, `spread.caveatNoForecast`, `spread.caveatData`

</details>

### Signal-flag explanations

29 strings: 0 reviewed, 29 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`flags.title`, `flags.neutral`, `flags.text`, `flags.more`, `flags.count`, `flags.detail`, `flags.none`, `flags.show`, `flags.method`, `flags.learn`, `flags.baselineMean`, `flags.threshold`, `flags.baselineWindow`, `flags.status`, `flags.seasonal`, `flagstatus.flagged`, `flagstatus.suppressed-holiday-period`, `flagstatus.suppressed-possible-batch-reporting`, `flagstatus.suppressed-seasonal-baseline-unavailable`, `flagstatus.suppressed-within-seasonal-range`, `method.rolling_baseline_c2`, `tour.flag.title`, `tour.flag.s1`, `tour.flag.s2`, `tour.flag.s3`, `tour.flag.s4`, `flags.detailPct`, `flagstatus.suppressed-within-sampling-uncertainty`, `flagstatus.suppressed-previous-week-too-few-samples`

</details>

### Glossary

53 strings: 0 reviewed, 53 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`glossary.lead`, `glossary.source`, `glossary.case-definition.term`, `glossary.case-definition.def`, `glossary.confirmed.term`, `glossary.confirmed.def`, `glossary.probable.term`, `glossary.probable.def`, `glossary.suspected.term`, `glossary.suspected.def`, `glossary.notified.term`, `glossary.notified.def`, `glossary.incidence.term`, `glossary.incidence.def`, `glossary.per-capita.term`, `glossary.per-capita.def`, `glossary.reporting-lag.term`, `glossary.reporting-lag.def`, `glossary.incomplete.term`, `glossary.incomplete.def`, `glossary.revision.term`, `glossary.revision.def`, `glossary.snapshot.term`, `glossary.snapshot.def`, `glossary.undercounting.term`, `glossary.undercounting.def`, `glossary.surveillance.term`, `glossary.surveillance.def`, `glossary.sentinel.term`, `glossary.sentinel.def`, `glossary.percent-positive.term`, `glossary.percent-positive.def`, `glossary.epi-curve.term`, `glossary.epi-curve.def`, `glossary.rolling-average.term`, `glossary.rolling-average.def`, `glossary.log-scale.term`, `glossary.log-scale.def`, `glossary.signal-flag.term`, `glossary.signal-flag.def`, `glossary.baseline.term`, `glossary.baseline.def`, `glossary.origin-type.term`, `glossary.origin-type.def`, `glossary.lineage.term`, `glossary.lineage.def`, `glossary.r0.term`, `glossary.r0.def`, `glossary.r0.src`, `glossary.herd-immunity.term`, `glossary.herd-immunity.def`, `glossary.simulation.term`, `glossary.simulation.def`

</details>

### Reporter's guide

31 strings: 0 reviewed, 31 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`guide.lead`, `guide.attribution`, `guide.attributionText`, `guide.evidence`, `guide.percapita.title`, `guide.percapita.p1`, `guide.lag.title`, `guide.lag.p1`, `guide.undercount.title`, `guide.undercount.p1`, `guide.compare.title`, `guide.compare.p1`, `guide.definitions.title`, `guide.definitions.p1`, `guide.uncertainty.title`, `guide.uncertainty.p1`, `guide.simulations.title`, `guide.simulations.p1`, `guide.trace.title`, `guide.trace.p1`, `guide.cite.title`, `guide.cite.p1`, `guide.see`, `guide.link.rates`, `guide.link.lag`, `guide.link.scope`, `guide.link.reconcile`, `guide.link.definitions`, `guide.link.revisions`, `guide.link.provenance`, `guide.link.flags`

</details>

### Guided tours

26 strings: 0 reviewed, 26 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`tour.step`, `tour.back`, `tour.next`, `tour.done`, `tour.epicurve.title`, `tour.epicurve.s1`, `tour.epicurve.s2`, `tour.epicurve.s3`, `tour.epicurve.s4`, `tour.recentlow.title`, `tour.recentlow.s1`, `tour.recentlow.s2`, `tour.recentlow.s3`, `tour.recentlow.s4`, `tour.percapita.title`, `tour.percapita.s1`, `tour.percapita.s2`, `tour.percapita.s3`, `tour.definitions.title`, `tour.definitions.s1`, `tour.definitions.s2`, `tour.definitions.s3`, `tour.trace.title`, `tour.trace.s1`, `tour.trace.s2`, `tour.trace.s3`

</details>

### Tool warnings and safeguards

27 strings: 0 reviewed, 27 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`warn.mixedDefinitions`, `warn.mixedSources`, `warn.mixedSeries`, `warn.crossDisease`, `warn.restrict`, `warn.incompleteIncluded`, `firstuse.compare.title`, `firstuse.compare.body`, `workbench.smallScreen`, `guard.mixed-definitions`, `guard.mixed-sources`, `guard.incomplete-included`, `guard.cross-disease`, `overlay.localTitle`, `overlay.local`, `overlay.exportNote`, `overlay.err.empty`, `overlay.err.noDate`, `overlay.err.noValue`, `overlay.err.sameColumn`, `overlay.err.tooManyRows`, `overlay.err.noValidRows`, `overlay.warn.ambiguousDates`, `overlay.warn.negativeValues`, `overlay.warn.skippedRows`, `firstuse.sim.title`, `firstuse.sim.body`

</details>

### Simulation disclaimers

25 strings: 0 reviewed, 25 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`sim.simulated`, `sim.watermarkShort`, `sim.banner`, `sim.bannerMore`, `sim.notFitted`, `sim.smallScreen`, `preset.illustrative`, `preset.illustrativeShort`, `preset.noRange`, `preset.unverifiedParams`, `shape.notice`, `sweep.frame`, `meta.notice`, `learn.separateBody`, `notpred.p1`, `notpred.p2`, `notpred.li1`, `notpred.li2`, `notpred.li3`, `notpred.li4`, `notpred.li5`, `notpred.li6`, `notpred.end.p1`, `notpred.end.p2`, `challenge.puzzle`

</details>

### Model assumption text

34 strings: 0 reviewed, 34 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`template.vector.note`, `template.water.note`, `template.asymp.note`, `template.age.note`, `age.note`, `doc.plain`, `assume.fails`, `assume.homogeneousMixing`, `assume.homogeneousMixing.why`, `assume.mixingByGroup`, `assume.mixingByGroup.why`, `assume.constantRates`, `assume.constantRates.why`, `assume.seasonalRates`, `assume.seasonalRates.why`, `assume.closedPopulation`, `assume.closedPopulation.why`, `assume.openPopulation`, `assume.openPopulation.why`, `assume.exponentialDurations`, `assume.exponentialDurations.why`, `assume.erlangDurations`, `assume.erlangDurations.why`, `assume.noBehaviourChange`, `assume.noBehaviourChange.why`, `assume.perfectObservation`, `assume.perfectObservation.why`, `assume.deterministic`, `assume.deterministic.why`, `assume.stochastic`, `assume.stochastic.why`, `assume.lifelongImmunity`, `assume.lifelongImmunity.why`, `ngm.intro`

</details>

### Lessons, misconceptions, challenges and scenarios

165 strings: 0 reviewed, 165 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`obs.title`, `obs.summary`, `obs.truth`, `obs.reportedFinal`, `obs.reportedSoFar`, `obs.fraction`, `obs.delay`, `obs.delaySd`, `obs.viewDay`, `obs.weekly`, `obs.definition`, `obs.testing`, `obs.noise`, `obs.atPeak`, `obs.chartTitle`, `obs.dayAxis`, `obs.definitionMark`, `obs.link`, `obs.linkReal`, `lesson.try`, `lesson.takeaway`, `lesson.exponential-growth.title`, `lesson.exponential-growth.sum`, `lesson.exponential-growth.p1`, `lesson.exponential-growth.p2`, `lesson.exponential-growth.try`, `lesson.exponential-growth.take`, `lesson.r0.title`, `lesson.r0.sum`, `lesson.r0.p1`, `lesson.r0.p2`, `lesson.r0.try`, `lesson.r0.take`, `lesson.herd-immunity.title`, `lesson.herd-immunity.sum`, `lesson.herd-immunity.p1`, `lesson.herd-immunity.p2`, `lesson.herd-immunity.try`, `lesson.herd-immunity.take`, `lesson.flattening.title`, `lesson.flattening.sum`, `lesson.flattening.p1`, `lesson.flattening.p2`, `lesson.flattening.try`, `lesson.flattening.take`, `lesson.epidemics-end.title`, `lesson.epidemics-end.sum`, `lesson.epidemics-end.p1`, `lesson.epidemics-end.p2`, `lesson.epidemics-end.try`, `lesson.epidemics-end.take`, `lesson.fade-out.title`, `lesson.fade-out.sum`, `lesson.fade-out.p1`, `lesson.fade-out.p2`, `lesson.fade-out.try`, `lesson.fade-out.take`, `lesson.superspreading.title`, `lesson.superspreading.sum`, `lesson.superspreading.p1`, `lesson.superspreading.p2`, `lesson.superspreading.try`, `lesson.superspreading.take`, `lesson.seasonality.title`, `lesson.seasonality.sum`, `lesson.seasonality.p1`, `lesson.seasonality.p2`, `lesson.seasonality.try`, `lesson.seasonality.take`, `lesson.vaccine-waning.title`, `lesson.vaccine-waning.sum`, `lesson.vaccine-waning.p1`, `lesson.vaccine-waning.p2`, `lesson.vaccine-waning.try`, `lesson.vaccine-waning.take`, `lesson.reporting-lag.title`, `lesson.reporting-lag.sum`, `lesson.reporting-lag.p1`, `lesson.reporting-lag.p2`, `lesson.reporting-lag.try`, `lesson.reporting-lag.take`, `lesson.limits.title`, `lesson.limits.sum`, `lesson.limits.p1`, `lesson.limits.p2`, `lesson.limits.try`, `lesson.limits.take`, `mis.lead`, `mis.tryIt`, `mis.r0-fixed.claim`, `mis.r0-fixed.fix`, `mis.r0-fixed.lesson`, `mis.herd-formula.claim`, `mis.herd-formula.fix`, `mis.herd-formula.lesson`, `mis.everyone-infected.claim`, `mis.everyone-infected.fix`, `mis.everyone-infected.lesson`, `mis.flatten-reduces-total.claim`, `mis.flatten-reduces-total.fix`, `mis.flatten-reduces-total.lesson`, `mis.model-is-forecast.claim`, `mis.model-is-forecast.fix`, `mis.model-is-forecast.lesson`, `mis.reported-is-true.claim`, `mis.reported-is-true.fix`, `mis.reported-is-true.lesson`, `mis.recent-drop.claim`, `mis.recent-drop.fix`, `mis.recent-drop.lesson`, `mis.superspreaders-rare.claim`, `mis.superspreaders-rare.fix`, `mis.superspreaders-rare.lesson`, `challenge.lead`, `challenge.capacity`, `challenge.solved`, `challenge.notYet`, `challenge.capacity.title`, `challenge.capacity.goal`, `challenge.capacity.feedback`, `challenge.capacity.why`, `challenge.coverage.title`, `challenge.coverage.goal`, `challenge.coverage.feedback`, `challenge.coverage.why`, `challenge.overshoot.title`, `challenge.overshoot.goal`, `challenge.overshoot.feedback`, `challenge.overshoot.why`, `scenario.town-outbreak.title`, `scenario.town-outbreak.setup`, `scenario.town-outbreak.q1`, `scenario.town-outbreak.q2`, `scenario.town-outbreak.q3`, `scenario.town-outbreak.q4`, `scenario.school-outbreak.title`, `scenario.school-outbreak.setup`, `scenario.school-outbreak.q1`, `scenario.school-outbreak.q2`, `scenario.school-outbreak.q3`, `scenario.school-outbreak.q4`, `scenario.below-threshold.title`, `scenario.below-threshold.setup`, `scenario.below-threshold.q1`, `scenario.below-threshold.q2`, `scenario.below-threshold.q3`, `scenario.below-threshold.q4`, `scenario.vaccinate-town.title`, `scenario.vaccinate-town.setup`, `scenario.vaccinate-town.q1`, `scenario.vaccinate-town.q2`, `scenario.vaccinate-town.q3`, `scenario.vaccinate-town.q4`, `scenario.flatten.title`, `scenario.flatten.setup`, `scenario.flatten.q1`, `scenario.flatten.q2`, `scenario.flatten.q3`, `scenario.flatten.q4`, `scenario.waning.title`, `scenario.waning.setup`, `scenario.waning.q1`, `scenario.waning.q2`, `scenario.waning.q3`, `scenario.waning.q4`

</details>

### Trace-panel explanations

82 strings: 0 reviewed, 82 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`origin.source-reported`, `origin.site-derived`, `origin.user-supplied`, `origin.simulated`, `origin.test-data`, `origin.source-reported.explain`, `origin.site-derived.explain`, `origin.user-supplied.explain`, `origin.simulated.explain`, `origin.test-data.explain`, `trace.title`, `trace.asOf`, `trace.snapshot`, `trace.caseDefinition`, `trace.method`, `trace.simulation`, `trace.simLine`, `trace.notApplicable`, `trace.originalSources`, `trace.references`, `trace.openOriginal`, `trace.linkUnavailable`, `trace.datasetLevel`, `trace.wayback`, `trace.archivedCopy`, `trace.notRedistributed`, `trace.retrieved`, `trace.license`, `trace.licenseUnverified`, `trace.transformations`, `trace.records`, `trace.values`, `trace.lineageFile`, `trace.rawRefs`, `trace.inputs`, `trace.showFull`, `trace.cite`, `trace.footer`, `trace.link`, `trace.verifiedOn`, `trace.unverified`, `transform.perCapita.explain`, `transform.cumulative.explain`, `transform.rolling.explain`, `transform.rebase.explain`, `transform.align.explain`, `transform.log.explain`, `transform.excludeIncomplete.explain`, `chain.select_columns`, `chain.iso2_to_iso3`, `chain.week_end_to_week_start`, `chain.sum_daily_to_iso_week`, `chain.sum_surveillance_systems`, `chain.dengue_annual_mixed`, `method.window_rate`, `method.period_rate`, `method.sum_reporting_countries`, `method.group_by_disease_place_gap`, `method.active_rank`, `method.reconcile_pairwise`, `method.population_density`, `method.weekly_changes`, `method.quality_metrics`, `method.revision_recording`, `method.gazetteer_match`, `method.user_sql_query`, `method.pivot`, `method.chart_builder`, `method.snapshot_diff`, `method.sum_selected_places`, `method.range_rate`, `method.next_generation_matrix`, `method.observation_layer`, `method.stochastic_ensemble`, `method.branching_process`, `method.parameter_sweep`, `method.phase_plane`, `method.network_sir`, `method.metapopulation_gravity`, `method.dengue_admin1_annual`, `method.reporting_health`, `method.constant_panel_total`

</details>

### Methodology, about, citation and quality text

72 strings: 0 reviewed, 72 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`cite.lead`, `cite.version`, `cite.noDoi`, `cite.sourcesTitle`, `methodology.lead`, `methodology.toc`, `methodology.params`, `methodology.paramsNote`, `methodology.changelog`, `about.title`, `cite.how.p1`, `cite.how.p2`, `quality.notes.p1`, `quality.notes.p2`, `methodology.provenance.title`, `methodology.provenance.p1`, `methodology.provenance.p2`, `methodology.normalization.title`, `methodology.normalization.p1`, `methodology.normalization.p2`, `methodology.defaults.title`, `methodology.defaults.p1`, `methodology.defaults.p2`, `methodology.aggregation.title`, `methodology.aggregation.p1`, `methodology.revisions.title`, `methodology.revisions.p1`, `methodology.revisions.p2`, `methodology.lag.title`, `methodology.lag.p1`, `methodology.lag.p2`, `methodology.reconcile.title`, `methodology.reconcile.p1`, `methodology.flags.title`, `methodology.flags.p1`, `methodology.flags.p2`, `methodology.flags.p3`, `methodology.events.title`, `methodology.events.p1`, `methodology.events.p2`, `methodology.geocoding.title`, `methodology.geocoding.p1`, `methodology.geocoding.p2`, `methodology.ranking.title`, `methodology.ranking.p1`, `methodology.transforms.title`, `methodology.transforms.p1`, `methodology.simulation.title`, `methodology.simulation.p1`, `methodology.simulation.p2`, `methodology.quality.title`, `methodology.quality.p1`, `methodology.limits.title`, `methodology.limits.p1`, `methodology.compare.title`, `methodology.compare.p1`, `about.what.title`, `about.what.p1`, `about.audiences.title`, `about.audiences.p1`, `about.trust.title`, `about.trust.p1`, `about.open.title`, `about.open.p1`, `about.privacy.title`, `about.privacy.p1`, `about.languages.title`, `about.languages.p1`, `about.privacy.p2`, `methodology.paramsCounts`, `methodology.paramsFlu`, `methodology.paramsEvents`

</details>

### Interface strings (lower priority)

1222 strings: 0 reviewed, 1222 machine-drafted and awaiting review.

Keys awaiting review: all keys in `es.json` not listed in a priority group above.


## Français (fr): strings by review status

### Positioning, disclaimers and persistent notices

9 strings: 0 reviewed, 9 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`persist.notice`, `persist.more`, `footer.positioning`, `methodology.scope.title`, `methodology.scope.p1`, `methodology.scope.p2`, `about.not.title`, `about.not.p1`, `embed.disclaimer`

</details>

### Event summaries and status wording

33 strings: 0 reviewed, 33 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`status.reported`, `status.ongoing`, `status.declared_over`, `status.no_recent_update`, `status.reported.explain`, `status.ongoing.explain`, `status.declared_over.explain`, `status.no_recent_update.explain`, `statusbasis.source-stated`, `statusbasis.source-published`, `statusbasis.recency-indicator`, `event.automated`, `event.summaryNote`, `event.sum.intro`, `event.sum.cases`, `event.sum.deaths`, `event.sum.noCounts`, `outbreak.statusQuote`, `outbreak.countsNote`, `outbreak.precisionNote`, `status.title`, `status.lead`, `status.summary`, `status.dataset`, `status.state`, `status.checked`, `status.changed`, `status.latest`, `status.cadence`, `status.ok`, `status.quarantined`, `status.note`, `status.source`

</details>

### Caveats and "what this means" text

43 strings: 0 reviewed, 43 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`chart.incomplete`, `chart.incompleteShort`, `chart.incompleteTip`, `chart.incompleteNote`, `overview.means.rate`, `overview.means.pct`, `overview.means.caveat`, `flags.caveat`, `mappage.means.disease`, `mappage.means.density`, `mappage.means.points`, `place.means.cases`, `place.means.detections`, `pin.vintage`, `disease.globalMeans`, `disease.topCaveat`, `changes.moversCaveat`, `explorer.means`, `overlay.means`, `mapsel.means`, `sim.means.ode`, `sim.means.stochastic`, `sim.means.re`, `obs.means.final`, `obs.means.view`, `ens.means`, `branch.means`, `phase.means`, `net.means`, `meta.means`, `mappage.means.flat`, `mappage.means.missing`, `mappage.means.proj`, `regions.means`, `regions.means.unmatched`, `regions.means.conflicts`, `mappage.means.reporting`, `timeline.means`, `spread.caveatReporting`, `spread.caveatFirst`, `spread.caveatNamed`, `spread.caveatNoForecast`, `spread.caveatData`

</details>

### Signal-flag explanations

29 strings: 0 reviewed, 29 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`flags.title`, `flags.neutral`, `flags.text`, `flags.more`, `flags.count`, `flags.detail`, `flags.none`, `flags.show`, `flags.method`, `flags.learn`, `flags.baselineMean`, `flags.threshold`, `flags.baselineWindow`, `flags.status`, `flags.seasonal`, `flagstatus.flagged`, `flagstatus.suppressed-holiday-period`, `flagstatus.suppressed-possible-batch-reporting`, `flagstatus.suppressed-seasonal-baseline-unavailable`, `flagstatus.suppressed-within-seasonal-range`, `method.rolling_baseline_c2`, `tour.flag.title`, `tour.flag.s1`, `tour.flag.s2`, `tour.flag.s3`, `tour.flag.s4`, `flags.detailPct`, `flagstatus.suppressed-within-sampling-uncertainty`, `flagstatus.suppressed-previous-week-too-few-samples`

</details>

### Glossary

53 strings: 0 reviewed, 53 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`glossary.lead`, `glossary.source`, `glossary.case-definition.term`, `glossary.case-definition.def`, `glossary.confirmed.term`, `glossary.confirmed.def`, `glossary.probable.term`, `glossary.probable.def`, `glossary.suspected.term`, `glossary.suspected.def`, `glossary.notified.term`, `glossary.notified.def`, `glossary.incidence.term`, `glossary.incidence.def`, `glossary.per-capita.term`, `glossary.per-capita.def`, `glossary.reporting-lag.term`, `glossary.reporting-lag.def`, `glossary.incomplete.term`, `glossary.incomplete.def`, `glossary.revision.term`, `glossary.revision.def`, `glossary.snapshot.term`, `glossary.snapshot.def`, `glossary.undercounting.term`, `glossary.undercounting.def`, `glossary.surveillance.term`, `glossary.surveillance.def`, `glossary.sentinel.term`, `glossary.sentinel.def`, `glossary.percent-positive.term`, `glossary.percent-positive.def`, `glossary.epi-curve.term`, `glossary.epi-curve.def`, `glossary.rolling-average.term`, `glossary.rolling-average.def`, `glossary.log-scale.term`, `glossary.log-scale.def`, `glossary.signal-flag.term`, `glossary.signal-flag.def`, `glossary.baseline.term`, `glossary.baseline.def`, `glossary.origin-type.term`, `glossary.origin-type.def`, `glossary.lineage.term`, `glossary.lineage.def`, `glossary.r0.term`, `glossary.r0.def`, `glossary.r0.src`, `glossary.herd-immunity.term`, `glossary.herd-immunity.def`, `glossary.simulation.term`, `glossary.simulation.def`

</details>

### Reporter's guide

31 strings: 0 reviewed, 31 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`guide.lead`, `guide.attribution`, `guide.attributionText`, `guide.evidence`, `guide.percapita.title`, `guide.percapita.p1`, `guide.lag.title`, `guide.lag.p1`, `guide.undercount.title`, `guide.undercount.p1`, `guide.compare.title`, `guide.compare.p1`, `guide.definitions.title`, `guide.definitions.p1`, `guide.uncertainty.title`, `guide.uncertainty.p1`, `guide.simulations.title`, `guide.simulations.p1`, `guide.trace.title`, `guide.trace.p1`, `guide.cite.title`, `guide.cite.p1`, `guide.see`, `guide.link.rates`, `guide.link.lag`, `guide.link.scope`, `guide.link.reconcile`, `guide.link.definitions`, `guide.link.revisions`, `guide.link.provenance`, `guide.link.flags`

</details>

### Guided tours

26 strings: 0 reviewed, 26 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`tour.step`, `tour.back`, `tour.next`, `tour.done`, `tour.epicurve.title`, `tour.epicurve.s1`, `tour.epicurve.s2`, `tour.epicurve.s3`, `tour.epicurve.s4`, `tour.recentlow.title`, `tour.recentlow.s1`, `tour.recentlow.s2`, `tour.recentlow.s3`, `tour.recentlow.s4`, `tour.percapita.title`, `tour.percapita.s1`, `tour.percapita.s2`, `tour.percapita.s3`, `tour.definitions.title`, `tour.definitions.s1`, `tour.definitions.s2`, `tour.definitions.s3`, `tour.trace.title`, `tour.trace.s1`, `tour.trace.s2`, `tour.trace.s3`

</details>

### Tool warnings and safeguards

27 strings: 0 reviewed, 27 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`warn.mixedDefinitions`, `warn.mixedSources`, `warn.mixedSeries`, `warn.crossDisease`, `warn.restrict`, `warn.incompleteIncluded`, `firstuse.compare.title`, `firstuse.compare.body`, `workbench.smallScreen`, `guard.mixed-definitions`, `guard.mixed-sources`, `guard.incomplete-included`, `guard.cross-disease`, `overlay.localTitle`, `overlay.local`, `overlay.exportNote`, `overlay.err.empty`, `overlay.err.noDate`, `overlay.err.noValue`, `overlay.err.sameColumn`, `overlay.err.tooManyRows`, `overlay.err.noValidRows`, `overlay.warn.ambiguousDates`, `overlay.warn.negativeValues`, `overlay.warn.skippedRows`, `firstuse.sim.title`, `firstuse.sim.body`

</details>

### Simulation disclaimers

25 strings: 0 reviewed, 25 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`sim.simulated`, `sim.watermarkShort`, `sim.banner`, `sim.bannerMore`, `sim.notFitted`, `sim.smallScreen`, `preset.illustrative`, `preset.illustrativeShort`, `preset.noRange`, `preset.unverifiedParams`, `shape.notice`, `sweep.frame`, `meta.notice`, `learn.separateBody`, `notpred.p1`, `notpred.p2`, `notpred.li1`, `notpred.li2`, `notpred.li3`, `notpred.li4`, `notpred.li5`, `notpred.li6`, `notpred.end.p1`, `notpred.end.p2`, `challenge.puzzle`

</details>

### Model assumption text

34 strings: 0 reviewed, 34 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`template.vector.note`, `template.water.note`, `template.asymp.note`, `template.age.note`, `age.note`, `doc.plain`, `assume.fails`, `assume.homogeneousMixing`, `assume.homogeneousMixing.why`, `assume.mixingByGroup`, `assume.mixingByGroup.why`, `assume.constantRates`, `assume.constantRates.why`, `assume.seasonalRates`, `assume.seasonalRates.why`, `assume.closedPopulation`, `assume.closedPopulation.why`, `assume.openPopulation`, `assume.openPopulation.why`, `assume.exponentialDurations`, `assume.exponentialDurations.why`, `assume.erlangDurations`, `assume.erlangDurations.why`, `assume.noBehaviourChange`, `assume.noBehaviourChange.why`, `assume.perfectObservation`, `assume.perfectObservation.why`, `assume.deterministic`, `assume.deterministic.why`, `assume.stochastic`, `assume.stochastic.why`, `assume.lifelongImmunity`, `assume.lifelongImmunity.why`, `ngm.intro`

</details>

### Lessons, misconceptions, challenges and scenarios

165 strings: 0 reviewed, 165 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`obs.title`, `obs.summary`, `obs.truth`, `obs.reportedFinal`, `obs.reportedSoFar`, `obs.fraction`, `obs.delay`, `obs.delaySd`, `obs.viewDay`, `obs.weekly`, `obs.definition`, `obs.testing`, `obs.noise`, `obs.atPeak`, `obs.chartTitle`, `obs.dayAxis`, `obs.definitionMark`, `obs.link`, `obs.linkReal`, `lesson.try`, `lesson.takeaway`, `lesson.exponential-growth.title`, `lesson.exponential-growth.sum`, `lesson.exponential-growth.p1`, `lesson.exponential-growth.p2`, `lesson.exponential-growth.try`, `lesson.exponential-growth.take`, `lesson.r0.title`, `lesson.r0.sum`, `lesson.r0.p1`, `lesson.r0.p2`, `lesson.r0.try`, `lesson.r0.take`, `lesson.herd-immunity.title`, `lesson.herd-immunity.sum`, `lesson.herd-immunity.p1`, `lesson.herd-immunity.p2`, `lesson.herd-immunity.try`, `lesson.herd-immunity.take`, `lesson.flattening.title`, `lesson.flattening.sum`, `lesson.flattening.p1`, `lesson.flattening.p2`, `lesson.flattening.try`, `lesson.flattening.take`, `lesson.epidemics-end.title`, `lesson.epidemics-end.sum`, `lesson.epidemics-end.p1`, `lesson.epidemics-end.p2`, `lesson.epidemics-end.try`, `lesson.epidemics-end.take`, `lesson.fade-out.title`, `lesson.fade-out.sum`, `lesson.fade-out.p1`, `lesson.fade-out.p2`, `lesson.fade-out.try`, `lesson.fade-out.take`, `lesson.superspreading.title`, `lesson.superspreading.sum`, `lesson.superspreading.p1`, `lesson.superspreading.p2`, `lesson.superspreading.try`, `lesson.superspreading.take`, `lesson.seasonality.title`, `lesson.seasonality.sum`, `lesson.seasonality.p1`, `lesson.seasonality.p2`, `lesson.seasonality.try`, `lesson.seasonality.take`, `lesson.vaccine-waning.title`, `lesson.vaccine-waning.sum`, `lesson.vaccine-waning.p1`, `lesson.vaccine-waning.p2`, `lesson.vaccine-waning.try`, `lesson.vaccine-waning.take`, `lesson.reporting-lag.title`, `lesson.reporting-lag.sum`, `lesson.reporting-lag.p1`, `lesson.reporting-lag.p2`, `lesson.reporting-lag.try`, `lesson.reporting-lag.take`, `lesson.limits.title`, `lesson.limits.sum`, `lesson.limits.p1`, `lesson.limits.p2`, `lesson.limits.try`, `lesson.limits.take`, `mis.lead`, `mis.tryIt`, `mis.r0-fixed.claim`, `mis.r0-fixed.fix`, `mis.r0-fixed.lesson`, `mis.herd-formula.claim`, `mis.herd-formula.fix`, `mis.herd-formula.lesson`, `mis.everyone-infected.claim`, `mis.everyone-infected.fix`, `mis.everyone-infected.lesson`, `mis.flatten-reduces-total.claim`, `mis.flatten-reduces-total.fix`, `mis.flatten-reduces-total.lesson`, `mis.model-is-forecast.claim`, `mis.model-is-forecast.fix`, `mis.model-is-forecast.lesson`, `mis.reported-is-true.claim`, `mis.reported-is-true.fix`, `mis.reported-is-true.lesson`, `mis.recent-drop.claim`, `mis.recent-drop.fix`, `mis.recent-drop.lesson`, `mis.superspreaders-rare.claim`, `mis.superspreaders-rare.fix`, `mis.superspreaders-rare.lesson`, `challenge.lead`, `challenge.capacity`, `challenge.solved`, `challenge.notYet`, `challenge.capacity.title`, `challenge.capacity.goal`, `challenge.capacity.feedback`, `challenge.capacity.why`, `challenge.coverage.title`, `challenge.coverage.goal`, `challenge.coverage.feedback`, `challenge.coverage.why`, `challenge.overshoot.title`, `challenge.overshoot.goal`, `challenge.overshoot.feedback`, `challenge.overshoot.why`, `scenario.town-outbreak.title`, `scenario.town-outbreak.setup`, `scenario.town-outbreak.q1`, `scenario.town-outbreak.q2`, `scenario.town-outbreak.q3`, `scenario.town-outbreak.q4`, `scenario.school-outbreak.title`, `scenario.school-outbreak.setup`, `scenario.school-outbreak.q1`, `scenario.school-outbreak.q2`, `scenario.school-outbreak.q3`, `scenario.school-outbreak.q4`, `scenario.below-threshold.title`, `scenario.below-threshold.setup`, `scenario.below-threshold.q1`, `scenario.below-threshold.q2`, `scenario.below-threshold.q3`, `scenario.below-threshold.q4`, `scenario.vaccinate-town.title`, `scenario.vaccinate-town.setup`, `scenario.vaccinate-town.q1`, `scenario.vaccinate-town.q2`, `scenario.vaccinate-town.q3`, `scenario.vaccinate-town.q4`, `scenario.flatten.title`, `scenario.flatten.setup`, `scenario.flatten.q1`, `scenario.flatten.q2`, `scenario.flatten.q3`, `scenario.flatten.q4`, `scenario.waning.title`, `scenario.waning.setup`, `scenario.waning.q1`, `scenario.waning.q2`, `scenario.waning.q3`, `scenario.waning.q4`

</details>

### Trace-panel explanations

82 strings: 0 reviewed, 82 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`origin.source-reported`, `origin.site-derived`, `origin.user-supplied`, `origin.simulated`, `origin.test-data`, `origin.source-reported.explain`, `origin.site-derived.explain`, `origin.user-supplied.explain`, `origin.simulated.explain`, `origin.test-data.explain`, `trace.title`, `trace.asOf`, `trace.snapshot`, `trace.caseDefinition`, `trace.method`, `trace.simulation`, `trace.simLine`, `trace.notApplicable`, `trace.originalSources`, `trace.references`, `trace.openOriginal`, `trace.linkUnavailable`, `trace.datasetLevel`, `trace.wayback`, `trace.archivedCopy`, `trace.notRedistributed`, `trace.retrieved`, `trace.license`, `trace.licenseUnverified`, `trace.transformations`, `trace.records`, `trace.values`, `trace.lineageFile`, `trace.rawRefs`, `trace.inputs`, `trace.showFull`, `trace.cite`, `trace.footer`, `trace.link`, `trace.verifiedOn`, `trace.unverified`, `transform.perCapita.explain`, `transform.cumulative.explain`, `transform.rolling.explain`, `transform.rebase.explain`, `transform.align.explain`, `transform.log.explain`, `transform.excludeIncomplete.explain`, `chain.select_columns`, `chain.iso2_to_iso3`, `chain.week_end_to_week_start`, `chain.sum_daily_to_iso_week`, `chain.sum_surveillance_systems`, `chain.dengue_annual_mixed`, `method.window_rate`, `method.period_rate`, `method.sum_reporting_countries`, `method.group_by_disease_place_gap`, `method.active_rank`, `method.reconcile_pairwise`, `method.population_density`, `method.weekly_changes`, `method.quality_metrics`, `method.revision_recording`, `method.gazetteer_match`, `method.user_sql_query`, `method.pivot`, `method.chart_builder`, `method.snapshot_diff`, `method.sum_selected_places`, `method.range_rate`, `method.next_generation_matrix`, `method.observation_layer`, `method.stochastic_ensemble`, `method.branching_process`, `method.parameter_sweep`, `method.phase_plane`, `method.network_sir`, `method.metapopulation_gravity`, `method.dengue_admin1_annual`, `method.reporting_health`, `method.constant_panel_total`

</details>

### Methodology, about, citation and quality text

72 strings: 0 reviewed, 72 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`cite.lead`, `cite.version`, `cite.noDoi`, `cite.sourcesTitle`, `methodology.lead`, `methodology.toc`, `methodology.params`, `methodology.paramsNote`, `methodology.changelog`, `about.title`, `cite.how.p1`, `cite.how.p2`, `quality.notes.p1`, `quality.notes.p2`, `methodology.provenance.title`, `methodology.provenance.p1`, `methodology.provenance.p2`, `methodology.normalization.title`, `methodology.normalization.p1`, `methodology.normalization.p2`, `methodology.defaults.title`, `methodology.defaults.p1`, `methodology.defaults.p2`, `methodology.aggregation.title`, `methodology.aggregation.p1`, `methodology.revisions.title`, `methodology.revisions.p1`, `methodology.revisions.p2`, `methodology.lag.title`, `methodology.lag.p1`, `methodology.lag.p2`, `methodology.reconcile.title`, `methodology.reconcile.p1`, `methodology.flags.title`, `methodology.flags.p1`, `methodology.flags.p2`, `methodology.flags.p3`, `methodology.events.title`, `methodology.events.p1`, `methodology.events.p2`, `methodology.geocoding.title`, `methodology.geocoding.p1`, `methodology.geocoding.p2`, `methodology.ranking.title`, `methodology.ranking.p1`, `methodology.transforms.title`, `methodology.transforms.p1`, `methodology.simulation.title`, `methodology.simulation.p1`, `methodology.simulation.p2`, `methodology.quality.title`, `methodology.quality.p1`, `methodology.limits.title`, `methodology.limits.p1`, `methodology.compare.title`, `methodology.compare.p1`, `about.what.title`, `about.what.p1`, `about.audiences.title`, `about.audiences.p1`, `about.trust.title`, `about.trust.p1`, `about.open.title`, `about.open.p1`, `about.privacy.title`, `about.privacy.p1`, `about.languages.title`, `about.languages.p1`, `about.privacy.p2`, `methodology.paramsCounts`, `methodology.paramsFlu`, `methodology.paramsEvents`

</details>

### Interface strings (lower priority)

1222 strings: 0 reviewed, 1222 machine-drafted and awaiting review.

Keys awaiting review: all keys in `fr.json` not listed in a priority group above.


## Deutsch (de): strings by review status

### Positioning, disclaimers and persistent notices

9 strings: 0 reviewed, 9 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`persist.notice`, `persist.more`, `footer.positioning`, `methodology.scope.title`, `methodology.scope.p1`, `methodology.scope.p2`, `about.not.title`, `about.not.p1`, `embed.disclaimer`

</details>

### Event summaries and status wording

33 strings: 0 reviewed, 33 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`status.reported`, `status.ongoing`, `status.declared_over`, `status.no_recent_update`, `status.reported.explain`, `status.ongoing.explain`, `status.declared_over.explain`, `status.no_recent_update.explain`, `statusbasis.source-stated`, `statusbasis.source-published`, `statusbasis.recency-indicator`, `event.automated`, `event.summaryNote`, `event.sum.intro`, `event.sum.cases`, `event.sum.deaths`, `event.sum.noCounts`, `outbreak.statusQuote`, `outbreak.countsNote`, `outbreak.precisionNote`, `status.title`, `status.lead`, `status.summary`, `status.dataset`, `status.state`, `status.checked`, `status.changed`, `status.latest`, `status.cadence`, `status.ok`, `status.quarantined`, `status.note`, `status.source`

</details>

### Caveats and "what this means" text

43 strings: 0 reviewed, 43 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`chart.incomplete`, `chart.incompleteShort`, `chart.incompleteTip`, `chart.incompleteNote`, `overview.means.rate`, `overview.means.pct`, `overview.means.caveat`, `flags.caveat`, `mappage.means.disease`, `mappage.means.density`, `mappage.means.points`, `place.means.cases`, `place.means.detections`, `pin.vintage`, `disease.globalMeans`, `disease.topCaveat`, `changes.moversCaveat`, `explorer.means`, `overlay.means`, `mapsel.means`, `sim.means.ode`, `sim.means.stochastic`, `sim.means.re`, `obs.means.final`, `obs.means.view`, `ens.means`, `branch.means`, `phase.means`, `net.means`, `meta.means`, `mappage.means.flat`, `mappage.means.missing`, `mappage.means.proj`, `regions.means`, `regions.means.unmatched`, `regions.means.conflicts`, `mappage.means.reporting`, `timeline.means`, `spread.caveatReporting`, `spread.caveatFirst`, `spread.caveatNamed`, `spread.caveatNoForecast`, `spread.caveatData`

</details>

### Signal-flag explanations

29 strings: 0 reviewed, 29 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`flags.title`, `flags.neutral`, `flags.text`, `flags.more`, `flags.count`, `flags.detail`, `flags.none`, `flags.show`, `flags.method`, `flags.learn`, `flags.baselineMean`, `flags.threshold`, `flags.baselineWindow`, `flags.status`, `flags.seasonal`, `flagstatus.flagged`, `flagstatus.suppressed-holiday-period`, `flagstatus.suppressed-possible-batch-reporting`, `flagstatus.suppressed-seasonal-baseline-unavailable`, `flagstatus.suppressed-within-seasonal-range`, `method.rolling_baseline_c2`, `tour.flag.title`, `tour.flag.s1`, `tour.flag.s2`, `tour.flag.s3`, `tour.flag.s4`, `flags.detailPct`, `flagstatus.suppressed-within-sampling-uncertainty`, `flagstatus.suppressed-previous-week-too-few-samples`

</details>

### Glossary

53 strings: 0 reviewed, 53 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`glossary.lead`, `glossary.source`, `glossary.case-definition.term`, `glossary.case-definition.def`, `glossary.confirmed.term`, `glossary.confirmed.def`, `glossary.probable.term`, `glossary.probable.def`, `glossary.suspected.term`, `glossary.suspected.def`, `glossary.notified.term`, `glossary.notified.def`, `glossary.incidence.term`, `glossary.incidence.def`, `glossary.per-capita.term`, `glossary.per-capita.def`, `glossary.reporting-lag.term`, `glossary.reporting-lag.def`, `glossary.incomplete.term`, `glossary.incomplete.def`, `glossary.revision.term`, `glossary.revision.def`, `glossary.snapshot.term`, `glossary.snapshot.def`, `glossary.undercounting.term`, `glossary.undercounting.def`, `glossary.surveillance.term`, `glossary.surveillance.def`, `glossary.sentinel.term`, `glossary.sentinel.def`, `glossary.percent-positive.term`, `glossary.percent-positive.def`, `glossary.epi-curve.term`, `glossary.epi-curve.def`, `glossary.rolling-average.term`, `glossary.rolling-average.def`, `glossary.log-scale.term`, `glossary.log-scale.def`, `glossary.signal-flag.term`, `glossary.signal-flag.def`, `glossary.baseline.term`, `glossary.baseline.def`, `glossary.origin-type.term`, `glossary.origin-type.def`, `glossary.lineage.term`, `glossary.lineage.def`, `glossary.r0.term`, `glossary.r0.def`, `glossary.r0.src`, `glossary.herd-immunity.term`, `glossary.herd-immunity.def`, `glossary.simulation.term`, `glossary.simulation.def`

</details>

### Reporter's guide

31 strings: 0 reviewed, 31 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`guide.lead`, `guide.attribution`, `guide.attributionText`, `guide.evidence`, `guide.percapita.title`, `guide.percapita.p1`, `guide.lag.title`, `guide.lag.p1`, `guide.undercount.title`, `guide.undercount.p1`, `guide.compare.title`, `guide.compare.p1`, `guide.definitions.title`, `guide.definitions.p1`, `guide.uncertainty.title`, `guide.uncertainty.p1`, `guide.simulations.title`, `guide.simulations.p1`, `guide.trace.title`, `guide.trace.p1`, `guide.cite.title`, `guide.cite.p1`, `guide.see`, `guide.link.rates`, `guide.link.lag`, `guide.link.scope`, `guide.link.reconcile`, `guide.link.definitions`, `guide.link.revisions`, `guide.link.provenance`, `guide.link.flags`

</details>

### Guided tours

26 strings: 0 reviewed, 26 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`tour.step`, `tour.back`, `tour.next`, `tour.done`, `tour.epicurve.title`, `tour.epicurve.s1`, `tour.epicurve.s2`, `tour.epicurve.s3`, `tour.epicurve.s4`, `tour.recentlow.title`, `tour.recentlow.s1`, `tour.recentlow.s2`, `tour.recentlow.s3`, `tour.recentlow.s4`, `tour.percapita.title`, `tour.percapita.s1`, `tour.percapita.s2`, `tour.percapita.s3`, `tour.definitions.title`, `tour.definitions.s1`, `tour.definitions.s2`, `tour.definitions.s3`, `tour.trace.title`, `tour.trace.s1`, `tour.trace.s2`, `tour.trace.s3`

</details>

### Tool warnings and safeguards

27 strings: 0 reviewed, 27 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`warn.mixedDefinitions`, `warn.mixedSources`, `warn.mixedSeries`, `warn.crossDisease`, `warn.restrict`, `warn.incompleteIncluded`, `firstuse.compare.title`, `firstuse.compare.body`, `workbench.smallScreen`, `guard.mixed-definitions`, `guard.mixed-sources`, `guard.incomplete-included`, `guard.cross-disease`, `overlay.localTitle`, `overlay.local`, `overlay.exportNote`, `overlay.err.empty`, `overlay.err.noDate`, `overlay.err.noValue`, `overlay.err.sameColumn`, `overlay.err.tooManyRows`, `overlay.err.noValidRows`, `overlay.warn.ambiguousDates`, `overlay.warn.negativeValues`, `overlay.warn.skippedRows`, `firstuse.sim.title`, `firstuse.sim.body`

</details>

### Simulation disclaimers

25 strings: 0 reviewed, 25 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`sim.simulated`, `sim.watermarkShort`, `sim.banner`, `sim.bannerMore`, `sim.notFitted`, `sim.smallScreen`, `preset.illustrative`, `preset.illustrativeShort`, `preset.noRange`, `preset.unverifiedParams`, `shape.notice`, `sweep.frame`, `meta.notice`, `learn.separateBody`, `notpred.p1`, `notpred.p2`, `notpred.li1`, `notpred.li2`, `notpred.li3`, `notpred.li4`, `notpred.li5`, `notpred.li6`, `notpred.end.p1`, `notpred.end.p2`, `challenge.puzzle`

</details>

### Model assumption text

34 strings: 0 reviewed, 34 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`template.vector.note`, `template.water.note`, `template.asymp.note`, `template.age.note`, `age.note`, `doc.plain`, `assume.fails`, `assume.homogeneousMixing`, `assume.homogeneousMixing.why`, `assume.mixingByGroup`, `assume.mixingByGroup.why`, `assume.constantRates`, `assume.constantRates.why`, `assume.seasonalRates`, `assume.seasonalRates.why`, `assume.closedPopulation`, `assume.closedPopulation.why`, `assume.openPopulation`, `assume.openPopulation.why`, `assume.exponentialDurations`, `assume.exponentialDurations.why`, `assume.erlangDurations`, `assume.erlangDurations.why`, `assume.noBehaviourChange`, `assume.noBehaviourChange.why`, `assume.perfectObservation`, `assume.perfectObservation.why`, `assume.deterministic`, `assume.deterministic.why`, `assume.stochastic`, `assume.stochastic.why`, `assume.lifelongImmunity`, `assume.lifelongImmunity.why`, `ngm.intro`

</details>

### Lessons, misconceptions, challenges and scenarios

165 strings: 0 reviewed, 165 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`obs.title`, `obs.summary`, `obs.truth`, `obs.reportedFinal`, `obs.reportedSoFar`, `obs.fraction`, `obs.delay`, `obs.delaySd`, `obs.viewDay`, `obs.weekly`, `obs.definition`, `obs.testing`, `obs.noise`, `obs.atPeak`, `obs.chartTitle`, `obs.dayAxis`, `obs.definitionMark`, `obs.link`, `obs.linkReal`, `lesson.try`, `lesson.takeaway`, `lesson.exponential-growth.title`, `lesson.exponential-growth.sum`, `lesson.exponential-growth.p1`, `lesson.exponential-growth.p2`, `lesson.exponential-growth.try`, `lesson.exponential-growth.take`, `lesson.r0.title`, `lesson.r0.sum`, `lesson.r0.p1`, `lesson.r0.p2`, `lesson.r0.try`, `lesson.r0.take`, `lesson.herd-immunity.title`, `lesson.herd-immunity.sum`, `lesson.herd-immunity.p1`, `lesson.herd-immunity.p2`, `lesson.herd-immunity.try`, `lesson.herd-immunity.take`, `lesson.flattening.title`, `lesson.flattening.sum`, `lesson.flattening.p1`, `lesson.flattening.p2`, `lesson.flattening.try`, `lesson.flattening.take`, `lesson.epidemics-end.title`, `lesson.epidemics-end.sum`, `lesson.epidemics-end.p1`, `lesson.epidemics-end.p2`, `lesson.epidemics-end.try`, `lesson.epidemics-end.take`, `lesson.fade-out.title`, `lesson.fade-out.sum`, `lesson.fade-out.p1`, `lesson.fade-out.p2`, `lesson.fade-out.try`, `lesson.fade-out.take`, `lesson.superspreading.title`, `lesson.superspreading.sum`, `lesson.superspreading.p1`, `lesson.superspreading.p2`, `lesson.superspreading.try`, `lesson.superspreading.take`, `lesson.seasonality.title`, `lesson.seasonality.sum`, `lesson.seasonality.p1`, `lesson.seasonality.p2`, `lesson.seasonality.try`, `lesson.seasonality.take`, `lesson.vaccine-waning.title`, `lesson.vaccine-waning.sum`, `lesson.vaccine-waning.p1`, `lesson.vaccine-waning.p2`, `lesson.vaccine-waning.try`, `lesson.vaccine-waning.take`, `lesson.reporting-lag.title`, `lesson.reporting-lag.sum`, `lesson.reporting-lag.p1`, `lesson.reporting-lag.p2`, `lesson.reporting-lag.try`, `lesson.reporting-lag.take`, `lesson.limits.title`, `lesson.limits.sum`, `lesson.limits.p1`, `lesson.limits.p2`, `lesson.limits.try`, `lesson.limits.take`, `mis.lead`, `mis.tryIt`, `mis.r0-fixed.claim`, `mis.r0-fixed.fix`, `mis.r0-fixed.lesson`, `mis.herd-formula.claim`, `mis.herd-formula.fix`, `mis.herd-formula.lesson`, `mis.everyone-infected.claim`, `mis.everyone-infected.fix`, `mis.everyone-infected.lesson`, `mis.flatten-reduces-total.claim`, `mis.flatten-reduces-total.fix`, `mis.flatten-reduces-total.lesson`, `mis.model-is-forecast.claim`, `mis.model-is-forecast.fix`, `mis.model-is-forecast.lesson`, `mis.reported-is-true.claim`, `mis.reported-is-true.fix`, `mis.reported-is-true.lesson`, `mis.recent-drop.claim`, `mis.recent-drop.fix`, `mis.recent-drop.lesson`, `mis.superspreaders-rare.claim`, `mis.superspreaders-rare.fix`, `mis.superspreaders-rare.lesson`, `challenge.lead`, `challenge.capacity`, `challenge.solved`, `challenge.notYet`, `challenge.capacity.title`, `challenge.capacity.goal`, `challenge.capacity.feedback`, `challenge.capacity.why`, `challenge.coverage.title`, `challenge.coverage.goal`, `challenge.coverage.feedback`, `challenge.coverage.why`, `challenge.overshoot.title`, `challenge.overshoot.goal`, `challenge.overshoot.feedback`, `challenge.overshoot.why`, `scenario.town-outbreak.title`, `scenario.town-outbreak.setup`, `scenario.town-outbreak.q1`, `scenario.town-outbreak.q2`, `scenario.town-outbreak.q3`, `scenario.town-outbreak.q4`, `scenario.school-outbreak.title`, `scenario.school-outbreak.setup`, `scenario.school-outbreak.q1`, `scenario.school-outbreak.q2`, `scenario.school-outbreak.q3`, `scenario.school-outbreak.q4`, `scenario.below-threshold.title`, `scenario.below-threshold.setup`, `scenario.below-threshold.q1`, `scenario.below-threshold.q2`, `scenario.below-threshold.q3`, `scenario.below-threshold.q4`, `scenario.vaccinate-town.title`, `scenario.vaccinate-town.setup`, `scenario.vaccinate-town.q1`, `scenario.vaccinate-town.q2`, `scenario.vaccinate-town.q3`, `scenario.vaccinate-town.q4`, `scenario.flatten.title`, `scenario.flatten.setup`, `scenario.flatten.q1`, `scenario.flatten.q2`, `scenario.flatten.q3`, `scenario.flatten.q4`, `scenario.waning.title`, `scenario.waning.setup`, `scenario.waning.q1`, `scenario.waning.q2`, `scenario.waning.q3`, `scenario.waning.q4`

</details>

### Trace-panel explanations

82 strings: 0 reviewed, 82 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`origin.source-reported`, `origin.site-derived`, `origin.user-supplied`, `origin.simulated`, `origin.test-data`, `origin.source-reported.explain`, `origin.site-derived.explain`, `origin.user-supplied.explain`, `origin.simulated.explain`, `origin.test-data.explain`, `trace.title`, `trace.asOf`, `trace.snapshot`, `trace.caseDefinition`, `trace.method`, `trace.simulation`, `trace.simLine`, `trace.notApplicable`, `trace.originalSources`, `trace.references`, `trace.openOriginal`, `trace.linkUnavailable`, `trace.datasetLevel`, `trace.wayback`, `trace.archivedCopy`, `trace.notRedistributed`, `trace.retrieved`, `trace.license`, `trace.licenseUnverified`, `trace.transformations`, `trace.records`, `trace.values`, `trace.lineageFile`, `trace.rawRefs`, `trace.inputs`, `trace.showFull`, `trace.cite`, `trace.footer`, `trace.link`, `trace.verifiedOn`, `trace.unverified`, `transform.perCapita.explain`, `transform.cumulative.explain`, `transform.rolling.explain`, `transform.rebase.explain`, `transform.align.explain`, `transform.log.explain`, `transform.excludeIncomplete.explain`, `chain.select_columns`, `chain.iso2_to_iso3`, `chain.week_end_to_week_start`, `chain.sum_daily_to_iso_week`, `chain.sum_surveillance_systems`, `chain.dengue_annual_mixed`, `method.window_rate`, `method.period_rate`, `method.sum_reporting_countries`, `method.group_by_disease_place_gap`, `method.active_rank`, `method.reconcile_pairwise`, `method.population_density`, `method.weekly_changes`, `method.quality_metrics`, `method.revision_recording`, `method.gazetteer_match`, `method.user_sql_query`, `method.pivot`, `method.chart_builder`, `method.snapshot_diff`, `method.sum_selected_places`, `method.range_rate`, `method.next_generation_matrix`, `method.observation_layer`, `method.stochastic_ensemble`, `method.branching_process`, `method.parameter_sweep`, `method.phase_plane`, `method.network_sir`, `method.metapopulation_gravity`, `method.dengue_admin1_annual`, `method.reporting_health`, `method.constant_panel_total`

</details>

### Methodology, about, citation and quality text

72 strings: 0 reviewed, 72 machine-drafted and awaiting review.

<details><summary>Keys awaiting review</summary>

`cite.lead`, `cite.version`, `cite.noDoi`, `cite.sourcesTitle`, `methodology.lead`, `methodology.toc`, `methodology.params`, `methodology.paramsNote`, `methodology.changelog`, `about.title`, `cite.how.p1`, `cite.how.p2`, `quality.notes.p1`, `quality.notes.p2`, `methodology.provenance.title`, `methodology.provenance.p1`, `methodology.provenance.p2`, `methodology.normalization.title`, `methodology.normalization.p1`, `methodology.normalization.p2`, `methodology.defaults.title`, `methodology.defaults.p1`, `methodology.defaults.p2`, `methodology.aggregation.title`, `methodology.aggregation.p1`, `methodology.revisions.title`, `methodology.revisions.p1`, `methodology.revisions.p2`, `methodology.lag.title`, `methodology.lag.p1`, `methodology.lag.p2`, `methodology.reconcile.title`, `methodology.reconcile.p1`, `methodology.flags.title`, `methodology.flags.p1`, `methodology.flags.p2`, `methodology.flags.p3`, `methodology.events.title`, `methodology.events.p1`, `methodology.events.p2`, `methodology.geocoding.title`, `methodology.geocoding.p1`, `methodology.geocoding.p2`, `methodology.ranking.title`, `methodology.ranking.p1`, `methodology.transforms.title`, `methodology.transforms.p1`, `methodology.simulation.title`, `methodology.simulation.p1`, `methodology.simulation.p2`, `methodology.quality.title`, `methodology.quality.p1`, `methodology.limits.title`, `methodology.limits.p1`, `methodology.compare.title`, `methodology.compare.p1`, `about.what.title`, `about.what.p1`, `about.audiences.title`, `about.audiences.p1`, `about.trust.title`, `about.trust.p1`, `about.open.title`, `about.open.p1`, `about.privacy.title`, `about.privacy.p1`, `about.languages.title`, `about.languages.p1`, `about.privacy.p2`, `methodology.paramsCounts`, `methodology.paramsFlu`, `methodology.paramsEvents`

</details>

### Interface strings (lower priority)

1222 strings: 0 reviewed, 1222 machine-drafted and awaiting review.

Keys awaiting review: all keys in `de.json` not listed in a priority group above.


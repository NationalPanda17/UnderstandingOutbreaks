/** Country view: time series with incomplete-period shading, source reconciliation, neighbours, recent events. */
import { useMemo } from 'preact/hooks';
import { href, setParams } from '../lib/app';
import { getJSON, getOptional, loadRevisions, loadTs, type EventIdx, type Flag, type TsFile } from '../lib/data';
import { date, num, periodLabel, smart, t } from '../lib/i18n';
import { seriesProv } from '../lib/prov';
import { comparableKeys, placeName, seriesLabel, toSeries } from '../lib/series';
import type { SeriesData } from '../lib/transforms';
import { ChartCard } from '../components/ChartCard';
import { Regions } from '../components/Regions';
import { ReportingChip } from '../components/ReportingHealth';
import { ContextLinks } from '../components/ContextLinks';
import { EventRow } from '../components/Events';
import { ErrorBox, Loading, diseaseName, useAsync } from '../components/Layout';
import { SourceChip, useApp } from '../components/SourceChip';
import { WatchButton } from './Watchlists';

export function Place({ iso3 }: { iso3: string }) {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const place = core.places[iso3];
  const tsDiseases = core.diseases.filter((d) => d.has_timeseries);
  const all = useAsync(() => Promise.all(tsDiseases.map((d) => loadTs(core, d.id, iso3, route.snapshot))), [iso3, route.snapshot]);
  const available = tsDiseases.filter((_, i) => all.data?.[i]);
  const disease = route.params.get('d') && available.some((d) => d.id === route.params.get('d')) ? route.params.get('d')! : available[0]?.id;
  const ts: TsFile | null = all.data?.[tsDiseases.findIndex((d) => d.id === disease)] ?? null;
  const d = disease ? core.diseaseById[disease] : null;
  const picked = (route.params.get('s') ?? '').split('~').filter(Boolean);
  const fDef = route.params.get('def') ?? ''; const fSrc = route.params.get('src') ?? '';
  const from = route.params.get('from'); const to = route.params.get('to');

  const events = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const flags = useAsync(() => (disease ? getOptional<{ flags: Flag[] }>(`flags/${disease}.json`) : Promise.resolve(null)), [disease]);
  const rec = useAsync(() => (disease ? getOptional<any>(`reconcile/${disease}.json`) : Promise.resolve(null)), [disease]);
  const revs = useAsync(() => (disease ? loadRevisions(disease, iso3) : Promise.resolve(null)), [disease, iso3]);
  const neigh = useAsync(async () => {
    if (!disease || !place) return [];
    const ns = place.neighbours.slice(0, 5);
    const files = await Promise.all(ns.map((n) => loadTs(core, disease, n, route.snapshot)));
    return files.filter((f): f is TsFile => !!f);
  }, [disease, iso3, route.snapshot]);

  const clip = (s: SeriesData): SeriesData => {
    if (!from && !to) return s;
    const keep = s.p.map((p, i) => ((!from || p >= from) && (!to || p <= to) ? i : -1)).filter((i) => i >= 0);
    return { ...s, p: keep.map((i) => s.p[i]), v: keep.map((i) => s.v[i]) };
  };

  const model = useMemo(() => {
    if (!ts || !d) return null;
    const keys = Object.keys(ts.series).filter((k) => core.seriesByKey[k]);
    const def = d.default_skey && ts.series[d.default_skey] ? d.default_skey : keys[0];
    const filtered = keys.filter((k) => (!fDef || core.seriesByKey[k].case_definition === fDef) && (!fSrc || core.seriesByKey[k].source_id === fSrc));
    const chosen = analyst && picked.length ? picked.filter((k) => keys.includes(k)) : [def];
    const main = chosen.map((k) => toSeries(core, ts, k, seriesLabel(core, core.seriesByKey[k], { withSource: chosen.length > 1 }))).filter((s): s is SeriesData => !!s).map(clip);
    const defMeta = core.seriesByKey[def];
    const comparable = keys.filter((k) => { const m = core.seriesByKey[k]; return k !== def && m.metric === defMeta.metric && m.case_definition === defMeta.case_definition && m.period_type === defMeta.period_type && m.source_id !== defMeta.source_id; });
    return { keys, def, defMeta, filtered, chosen, main, comparable };
  }, [ts, d, analyst, picked.join('~'), fDef, fSrc, from, to]);

  if (!place) return <ErrorBox error={t('place.unknown', { iso3 })} />;
  const name = placeName(core, iso3);
  const myEvents = (events.data?.events ?? []).filter((e) => e.countries.includes(iso3)).sort((a, b) => (a.last_report < b.last_report ? 1 : -1));
  const myFlags = (flags.data?.flags ?? []).filter((f) => f.iso3 === iso3 && f.status === 'flagged');
  const allFlagRows = (flags.data?.flags ?? []).filter((f) => f.iso3 === iso3);
  const disagreements = rec.data?.countries?.[iso3] ?? [];
  const revised = Object.entries(revs.data?.changes ?? {}).flatMap(([skey, periods]) => Object.entries(periods as Record<string, [number, number | null][]>).filter(([, h]) => h.length > 1).map(([period, h]) => ({ skey, period, h })));

  return (
    <>
      <div class="row"><h1>{name}</h1><WatchButton item={{ kind: 'place', iso3, disease: disease ?? undefined }} /></div>
      <p class="lead">{t('place.lead', { name })}{place.population ? ' ' + t('place.population', { n: num(place.population), year: place.population_year ?? '' }) : ''}</p>
      {all.loading && <Loading />}
      {!all.loading && !available.length && <div class="notice">{t('place.noSeries', { name })}</div>}
      {available.length > 0 && (
        <div class="tabs" role="tablist" aria-label={t('filter.disease')}>
          {available.map((x) => <a key={x.id} role="tab" aria-selected={x.id === disease} href={href(route, 'place/' + iso3, { d: x.id })}>{diseaseName(core, x.id)}</a>)}
        </div>
      )}

      {model && d && disease && (
        <>
          <ReportingChip disease={disease} iso3={iso3} />
          {analyst && (
            <section class="card" style={{ marginBottom: '16px' }}>
              <h2>{t('place.series')}</h2>
              <div class="tools">
                <label>{t('filter.caseDefinition')} <select value={fDef} onChange={(e) => setParams({ def: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(model.keys.map((k) => core.seriesByKey[k].case_definition))).map((c) => <option key={c} value={c}>{t('def.' + c)}</option>)}</select></label>
                <label>{t('filter.source')} <select value={fSrc} onChange={(e) => setParams({ src: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(model.keys.map((k) => core.seriesByKey[k].source_id))).map((s) => <option key={s} value={s}>{core.sources[s]?.short_name}</option>)}</select></label>
                <label>{t('filter.from')} <input type="date" value={from ?? ''} onChange={(e) => setParams({ from: (e.target as HTMLInputElement).value || null })} /></label>
                <label>{t('filter.to')} <input type="date" value={to ?? ''} onChange={(e) => setParams({ to: (e.target as HTMLInputElement).value || null })} /></label>
              </div>
              <ul class="list small">
                {model.filtered.map((k) => {
                  const m = core.seriesByKey[k];
                  const on = model.chosen.includes(k);
                  return (
                    <li key={k}><label><input type="checkbox" checked={on} onChange={() => { const next = on ? model.chosen.filter((x) => x !== k) : [...model.chosen, k]; setParams({ s: next.join('~') || null }); }} />{' '}
                      {seriesLabel(core, m, { withSource: true })} · {t('ptype.' + m.period_type)} · <span class="badge">{t('origin.' + m.origin_type)}</span>{m.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}{k === model.def && <> <span class="badge ts">{t('place.defaultSeries')}</span></>}</label>
                      <div class="muted">{m.case_definition_detail}. {t('lag.line', { n: m.lag.lag_periods, basis: t('lag.basis.' + m.lag.basis) })}</div></li>
                  );
                })}
              </ul>
            </section>
          )}

          <ChartCard id="place-main" title={t('place.chartTitle', { disease: diseaseName(core, disease), name })} series={model.main} disease={disease}
            prov={seriesProv(core, t('place.chartTitle', { disease: diseaseName(core, disease), name }), model.main.map((s) => ({ skey: s.skey!, iso3 })), route.snapshot)}
            yLabel={model.main[0] ? t('metric.' + core.seriesByKey[model.main[0].skey!].metric) : ''}
            means={t('place.means.' + (model.defMeta.metric === 'detections' ? 'detections' : 'cases'), { name })}
            embed={{ kind: 'chart', params: { d: disease, c: iso3, ...(analyst && picked.length ? { s: model.chosen.join('~') } : {}) } }}
            marks={myFlags.filter((f) => model.chosen.includes(f.skey)).slice(-12).map((f) => ({ x: f.period, label: t('flags.text', { method: f.method }) }))}
            tours={['epicurve', 'recentlow', 'percapita', 'trace']}
            onBrush={analyst ? (a, b) => setParams({ from: a, to: b }) : undefined}
            onRestrictComparable={() => setParams({ s: null, def: null, src: null })} />

          <Regions disease={disease} iso3={iso3} />

          {(myFlags.length > 0 || analyst) && (
            <section class="card" style={{ marginTop: '16px' }} id="place-flags">
              <header><h2>{t('flags.title')}</h2><SourceChip compact prov={{ title: t('flags.title'), origin: 'site-derived', sourceIds: [model.defMeta.source_id], asOf: model.defMeta.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, series: [{ skey: model.def, iso3 }], method: { name: 'rolling_baseline_c2', version: '1' } }} /></header>
              <p class="sub">{t('flags.neutral')} {t('flags.caveat')}</p>
              {!myFlags.length && <p class="muted small">{t('flags.none')}</p>}
              {!analyst && myFlags.length > 0 && <p class="small" data-flag>{t('flags.text', { method: 'rolling_baseline_c2' })} {t('flags.count', { n: myFlags.length })}</p>}
              {analyst && allFlagRows.length > 0 && (
                <div class="tablewrap"><table class="data">
                  <thead><tr><th>{t('table.period')}</th><th class="n">{t('table.value')}</th><th class="n">{t('flags.baselineMean')}</th><th class="n">{t('flags.threshold')}</th><th>{t('flags.baselineWindow')}</th><th>{t('flags.status')}</th></tr></thead>
                  <tbody>{allFlagRows.slice().reverse().map((f) => <tr key={f.period} data-flag><th scope="row">{periodLabel(f.period, model.defMeta.period_type)}</th><td class="n">{num(f.value)}</td><td class="n">{num(f.baseline_mean)}</td><td class="n">{num(f.threshold)}</td><td>{date(f.baseline_periods[0])} – {date(f.baseline_periods[1])}</td><td>{t('flagstatus.' + f.status)}{f.seasonal && <div class="muted small">{t('flags.seasonal', { years: f.seasonal.years_used, threshold: num(f.seasonal.threshold) })}</div>}</td></tr>)}</tbody>
                </table></div>
              )}
              <p class="small"><a href={href(route, 'methodology')}>{t('flags.method')}</a> · <a href={href(route, 'learn/lesson/limits')}>{t('flags.learn')}</a></p>
            </section>
          )}

          {model.comparable.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <ChartCard id="place-reconcile" title={t('reconcile.title', { name })} disease={disease}
                series={[model.def, ...model.comparable].map((k) => toSeries(core, ts, k, core.sources[core.seriesByKey[k].source_id]?.short_name ?? k)).filter((s): s is SeriesData => !!s)}
                prov={seriesProv(core, t('reconcile.title', { name }), [model.def, ...model.comparable].map((k) => ({ skey: k, iso3 })), route.snapshot, { method: { name: 'reconcile_pairwise', version: '1', params: { rel_tol: 0.05, abs_tol: 5 } } })}
                means={disagreements.length ? t('reconcile.disagree', { n: disagreements.length }) : t('reconcile.agree')} tours={['definitions']} />
              {analyst && disagreements.length > 0 && (
                <details class="more"><summary>{t('reconcile.details', { n: disagreements.length })}</summary>
                  <div class="tablewrap"><table class="data"><thead><tr><th>{t('table.period')}</th><th>{t('table.sources')}</th><th class="n">{t('table.values')}</th></tr></thead>
                    <tbody>{disagreements.slice(-60).reverse().map((r: any) => <tr key={r.period + r.metric}><th scope="row">{periodLabel(r.period, r.period_type)} · {t('metric.' + r.metric)}</th><td>{r.datasets.map((x: string) => core.sources[core.manifest.datasets[x]?.source_id]?.short_name ?? x).join(' / ')}</td><td class="n">{r.values.map((v: number) => num(v)).join(' / ')}</td></tr>)}</tbody></table></div>
                </details>
              )}
            </div>
          )}

          {analyst && (
            <section class="card" style={{ marginTop: '16px' }}>
              <h2>{t('revisions.title')}</h2>
              <p class="sub">{t('pin.vintage')}</p>
              {revised.length === 0 ? <p class="muted small">{t('revisions.none', { n: core.manifest.snapshots.length })} {t('revisions.began', { date: date(core.manifest.snapshots[0]?.created_at, 'long') })}</p> : (
                <div class="tablewrap"><table class="data"><thead><tr><th>{t('table.period')}</th><th>{t('table.series')}</th><th>{t('revisions.history')}</th></tr></thead>
                  <tbody>{revised.slice(-80).reverse().map((r) => <tr key={r.skey + r.period}><th scope="row">{r.period}</th><td>{seriesLabel(core, core.seriesByKey[r.skey], { withSource: true })}</td><td>{r.h.map(([si, v]) => `${revs.data!.snapshots[si]?.slice(0, 8)}: ${v === null ? t('revisions.removed') : num(v)}`).join(' → ')}</td></tr>)}</tbody></table></div>
              )}
              <p class="small"><a href={href(route, 'workbench/diff')}>{t('revisions.diffTool')}</a></p>
            </section>
          )}

          {(neigh.data?.length ?? 0) > 0 && d.rate_metric && (
            <div style={{ marginTop: '16px' }}>
              <ChartCard id="place-neighbours" title={t('place.neighbours', { disease: diseaseName(core, disease) })} disease={disease} defaultTransforms="pc"
                series={[ts!, ...neigh.data!].map((f) => toSeries(core, f, model.def, placeName(core, f.iso3))).filter((s): s is SeriesData => !!s)}
                prov={seriesProv(core, t('place.neighbours', { disease: diseaseName(core, disease) }), [ts!, ...neigh.data!].filter((f) => f.series[model.def]).map((f) => ({ skey: model.def, iso3: f.iso3 })), route.snapshot, { sourceIds: ['worldbank'] })}
                means={t('place.neighboursMeans')} embed={{ kind: 'chart', params: { d: disease, c: [iso3, ...neigh.data!.map((f) => f.iso3)].join(','), tf: 'pc' } }} tours={['percapita']} />
            </div>
          )}
          <section class="card" style={{ marginTop: '16px' }}>
            <h2>{t('place.subnational')}</h2>
            <p class="muted">{t('place.subnationalNone')}</p>
          </section>
        </>
      )}

      <section class="card" style={{ marginTop: '16px' }}>
        <h2>{t('place.events', { name })}</h2>
        {!myEvents.length && <p class="muted">{t('place.noEvents')}</p>}
        <ul class="list">{myEvents.slice(0, 10).map((e) => <EventRow key={e.event_id} e={e} />)}</ul>
        {myEvents.length > 10 && <p><a href={href(route, 'outbreaks', { c: iso3 })}>{t('overview.allOutbreaks', { n: myEvents.length })}</a></p>}
      </section>
      <ContextLinks iso3={iso3} disease={disease} />
    </>
  );
}

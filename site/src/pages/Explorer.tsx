/** Data Explorer: pick diseases, places, dates, metric, case definition, source and vintage; preview; export with provenance. */
import { useMemo } from 'preact/hooks';
import { SITE, href, setParams } from '../lib/app';
import { getJSON, loadRevisions, loadTs, type EventIdx, type TsFile } from '../lib/data';
import { download, exportBundle, seriesRows, slugify } from '../lib/exporters';
import { date, num, t } from '../lib/i18n';
import { provBlock, seriesProv, type Prov } from '../lib/prov';
import { placeName, seriesLabel, toSeries } from '../lib/series';
import type { SeriesData } from '../lib/transforms';
import { ChartCard } from '../components/ChartCard';
import { eventPlaces } from '../components/Events';
import { FirstUse, Loading, diseaseName, useAsync } from '../components/Layout';
import { SourceChip, useApp } from '../components/SourceChip';

export function Explorer() {
  const { core, route } = useApp();
  const q = route.params;
  const tab = q.get('tab') ?? 'timeseries';
  return (
    <>
      <h1>{t('explorer.title')}</h1>
      <p class="lead">{t('explorer.lead')}</p>
      <FirstUse id="explorer-compare" title={t('firstuse.compare.title')}>{t('firstuse.compare.body')}</FirstUse>
      <div class="tabs" role="tablist">
        {['timeseries', 'events', 'revisions'].map((x) => <a key={x} role="tab" aria-selected={tab === x} href={href(route, 'explorer', { tab: x === 'timeseries' ? null : x, d: q.get('d'), c: q.get('c') })}>{t('explorer.tab.' + x)}</a>)}
        <a href={href(route, 'workbench')}>{t('workbench.open')} →</a>
      </div>
      {tab === 'timeseries' && <TsExplorer />}
      {tab === 'events' && <EventExplorer />}
      {tab === 'revisions' && <RevExplorer />}
      <p class="small muted">{t('explorer.bulk')} <a href={href(route, 'researchers')}>{t('nav.researchers')}</a> · <a href={`${SITE.dataPath}/catalog/dictionary.json`}>{t('explorer.dictionary')}</a></p>
      {core.manifest.snapshots.length > 0 && route.mode !== 'analyst' && <p class="small muted">{t('explorer.vintageHint')}</p>}
    </>
  );
}

function TsExplorer() {
  const { core, route } = useApp();
  const q = route.params;
  const tsDiseases = core.diseases.filter((d) => d.has_timeseries);
  const diseases = (q.get('d') ?? 'measles').split(',').filter((d) => core.diseaseById[d]?.has_timeseries).slice(0, 3);
  const countries = (q.get('c') ?? 'KEN,ETH').split(',').filter((c) => core.places[c]).slice(0, 12);
  const fMetric = q.get('metric') ?? ''; const fDef = q.get('def') ?? ''; const fSrc = q.get('src') ?? '';
  const comparableOnly = q.get('cmp') !== '0';
  const from = q.get('from'); const to = q.get('to');
  const files = useAsync(() => Promise.all(diseases.flatMap((d) => countries.map((c) => loadTs(core, d, c, route.snapshot)))), [diseases.join(), countries.join(), route.snapshot]);
  const series = useMemo(() => {
    const out: SeriesData[] = [];
    for (const f of (files.data ?? []).filter((x): x is TsFile => !!x)) {
      const d = core.diseaseById[f.disease];
      for (const k of Object.keys(f.series)) {
        const m = core.seriesByKey[k]; if (!m) continue;
        if (comparableOnly && k !== d.default_skey && !(fMetric || fDef || fSrc)) continue;
        if (fMetric && m.metric !== fMetric) continue;
        if (fDef && m.case_definition !== fDef) continue;
        if (fSrc && m.source_id !== fSrc) continue;
        const s = toSeries(core, f, k, `${placeName(core, f.iso3)} · ${diseases.length > 1 ? diseaseName(core, f.disease) + ' · ' : ''}${seriesLabel(core, m, { withSource: true })}`);
        if (!s) continue;
        const keep = s.p.map((p, i) => ((!from || p >= from) && (!to || p <= to) ? i : -1)).filter((i) => i >= 0);
        out.push({ ...s, p: keep.map((i) => s.p[i]), v: keep.map((i) => s.v[i]) });
      }
    }
    return out.slice(0, 24);
  }, [files.data, fMetric, fDef, fSrc, comparableOnly, from, to]);
  const allMeta = diseases.flatMap((d) => core.diseaseById[d].series);
  const prov = seriesProv(core, t('explorer.viewTitle', { diseases: diseases.map((d) => diseaseName(core, d)).join(', ') }), series.map((s) => ({ skey: s.skey!, iso3: s.iso3 })), route.snapshot);
  const sortedPlaces = Object.values(core.places).sort((a, b) => placeName(core, a.iso3).localeCompare(placeName(core, b.iso3)));
  return (
    <>
      <section class="card">
        <div class="tools">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend class="small muted">{t('filter.disease')}</legend>
            {tsDiseases.map((d) => <label key={d.id} style={{ marginInlineEnd: '10px' }}><input type="checkbox" checked={diseases.includes(d.id)} onChange={() => { const n = diseases.includes(d.id) ? diseases.filter((x) => x !== d.id) : [...diseases, d.id]; setParams({ d: n.join(',') || 'measles' }); }} /> {diseaseName(core, d.id)}</label>)}
          </fieldset>
        </div>
        <div class="tools">
          <label>{t('explorer.addPlace')} <select value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v && !countries.includes(v)) setParams({ c: [...countries, v].join(',') }); }}>
            <option value="">…</option>{sortedPlaces.map((p) => <option key={p.iso3} value={p.iso3}>{placeName(core, p.iso3)}</option>)}</select></label>
          {countries.map((c) => <button key={c} type="button" class="btn small" onClick={() => setParams({ c: countries.filter((x) => x !== c).join(',') || 'KEN' })} aria-label={t('explorer.removePlace', { name: placeName(core, c) })}>{placeName(core, c)} ×</button>)}
        </div>
        <div class="tools">
          <label>{t('filter.metric')} <select value={fMetric} onChange={(e) => setParams({ metric: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.defaultSeries')}</option>{Array.from(new Set(allMeta.map((m) => m.metric))).map((m) => <option key={m} value={m}>{t('metric.' + m)}</option>)}</select></label>
          <label>{t('filter.caseDefinition')} <select value={fDef} onChange={(e) => setParams({ def: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(allMeta.map((m) => m.case_definition))).map((m) => <option key={m} value={m}>{t('def.' + m)}</option>)}</select></label>
          <label>{t('filter.source')} <select value={fSrc} onChange={(e) => setParams({ src: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(allMeta.map((m) => m.source_id))).map((s) => <option key={s} value={s}>{core.sources[s]?.short_name}</option>)}</select></label>
          <label>{t('filter.from')} <input type="date" value={from ?? ''} onChange={(e) => setParams({ from: (e.target as HTMLInputElement).value || null })} /></label>
          <label>{t('filter.to')} <input type="date" value={to ?? ''} onChange={(e) => setParams({ to: (e.target as HTMLInputElement).value || null })} /></label>
        </div>
        {diseases.length > 1 && <div class="notice warn" role="note" data-testid="cross-disease-warning">{t('warn.crossDisease')}</div>}
      </section>
      {files.loading && <Loading />}
      {!files.loading && !series.length && <div class="notice">{t('explorer.empty')}</div>}
      {series.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <ChartCard id="explorer" title={prov.title} series={series} prov={prov} disease={diseases.length === 1 ? diseases[0] : undefined} defaultTransforms={series.every((s) => s.population) && core.diseaseById[diseases[0]].rate_metric ? 'pc.xi' : 'xi'}
            means={t('explorer.means')} onRestrictComparable={() => setParams({ metric: null, def: null, src: null, cmp: null, d: diseases[0] })} tours={['definitions', 'percapita']} />
          <div class="btnrow" style={{ marginTop: '8px' }}>
            <button type="button" class="btn" onClick={() => exportBundle(core, prov, seriesRows(core, series, prov), 'csv', 'explorer-timeseries')}>{t('action.downloadCsv')}</button>
            <button type="button" class="btn" onClick={() => exportBundle(core, prov, seriesRows(core, series, prov), 'json', 'explorer-timeseries')}>{t('action.downloadJson')}</button>
            {diseases.map((d) => <a key={d} class="btn" href={`${SITE.dataPath}/bulk/timeseries/disease=${d}/data.parquet`}>{t('explorer.parquet', { disease: diseaseName(core, d) })}</a>)}
            <a class="btn" href={href(route, 'workbench/sql')}>{t('explorer.filteredParquet')}</a>
          </div>
        </div>
      )}
    </>
  );
}

function EventExplorer() {
  const { core, route } = useApp();
  const q = route.params;
  const idx = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const fd = q.get('ed') ?? ''; const fs = q.get('status') ?? ''; const fsrc = q.get('src') ?? ''; const from = q.get('from'); const to = q.get('to');
  const all = idx.data?.events ?? [];
  const rows = all.filter((e) => (!fd || e.disease === fd) && (!fs || e.status === fs) && (!fsrc || e.source_ids.includes(fsrc)) && (!from || e.last_report >= from) && (!to || e.first_report <= to));
  const prov: Prov = { title: t('explorer.eventsTitle'), origin: 'site-derived', sourceIds: Array.from(new Set([...rows.flatMap((e) => e.source_ids), 'geonames', 'naturalearth'])), asOf: all.map((e) => e.last_report).sort().pop() ?? null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, method: { name: 'group_by_disease_place_gap', version: '1' } };
  const flat = () => rows.flatMap((e) => (e.locations.length ? e.locations : [{ iso3: '', precision: '', lon: null, lat: null, name: '' }]).map((l) => ({
    event_id: e.event_id, disease: e.disease, name_in_source: e.name_in_source, countries: e.countries.join(';'), first_report: e.first_report, last_report: e.last_report, status: e.status, status_basis: e.status_basis,
    cases: e.cases?.value ?? null, cases_definition: e.cases?.case_definition ?? '', cases_as_of: e.cases?.as_of ?? '', deaths: e.deaths?.value ?? null, n_reports: e.n_reports,
    location_name: l.name, location_precision: l.precision, lon: l.lon, lat: l.lat, location_method: 'gazetteer_match v1', rank_score: e.rank.score, rank_method: 'active_rank v1',
    source_id: e.source_ids.join(';'), source_url: e.latest_url, origin_type: 'site-derived', snapshot_id: prov.snapshotId })));
  const geojson = () => JSON.stringify({ type: 'FeatureCollection', provenance: provBlock(core, prov), features: flat().filter((r) => r.lon !== null).map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { ...r, lon: undefined, lat: undefined } })) }, null, 1);
  return (
    <section class="card">
      <header><h2>{t('explorer.eventsTitle')} ({rows.length})</h2><SourceChip prov={prov} /></header>
      <div class="tools">
        <label>{t('filter.disease')} <select value={fd} onChange={(e) => setParams({ ed: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(all.map((e) => e.disease))).sort().map((d) => <option key={d} value={d}>{diseaseName(core, d)}</option>)}</select></label>
        <label>{t('filter.status')} <select value={fs} onChange={(e) => setParams({ status: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{['reported', 'ongoing', 'declared_over', 'no_recent_update'].map((s) => <option key={s} value={s}>{t('status.' + s)}</option>)}</select></label>
        <label>{t('filter.source')} <select value={fsrc} onChange={(e) => setParams({ src: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(all.flatMap((e) => e.source_ids))).map((s) => <option key={s} value={s}>{core.sources[s]?.short_name}</option>)}</select></label>
        <label>{t('filter.from')} <input type="date" value={from ?? ''} onChange={(e) => setParams({ from: (e.target as HTMLInputElement).value || null })} /></label>
        <label>{t('filter.to')} <input type="date" value={to ?? ''} onChange={(e) => setParams({ to: (e.target as HTMLInputElement).value || null })} /></label>
      </div>
      {idx.loading && <Loading />}
      <div class="tablewrap" tabIndex={0}><table class="data">
        <thead><tr><th>{t('filter.disease')}</th><th>{t('table.place')}</th><th>{t('outbreak.lastReport')}</th><th>{t('outbreak.status')}</th><th class="n">{t('outbreak.cases')}</th><th class="n">{t('outbreak.deaths')}</th><th>{t('map.precision')}</th><th>{t('table.sources')}</th></tr></thead>
        <tbody>{rows.slice(0, 300).map((e) => <tr key={e.event_id}><th scope="row"><a href={href(route, 'outbreak/' + e.event_id)}>{diseaseName(core, e.disease)}</a></th><td>{eventPlaces(core, e)}</td><td>{date(e.last_report)}</td><td>{t('status.' + e.status)}</td><td class="n">{num(e.cases?.value)}</td><td class="n">{num(e.deaths?.value)}</td><td>{Array.from(new Set(e.locations.map((l) => t('precision.' + l.precision)))).join(', ') || '–'}</td><td>{e.source_ids.map((s) => core.sources[s]?.short_name).join(', ')}</td></tr>)}</tbody>
      </table></div>
      <div class="btnrow" style={{ marginTop: '8px' }}>
        <button type="button" class="btn" onClick={() => exportBundle(core, prov, flat(), 'csv', 'explorer-events')}>{t('action.downloadCsv')}</button>
        <button type="button" class="btn" onClick={() => exportBundle(core, prov, flat(), 'json', 'explorer-events')}>{t('action.downloadJson')}</button>
        <button type="button" class="btn" onClick={() => download(slugify('explorer-events') + '.geojson', geojson(), 'application/geo+json')}>GeoJSON</button>
        <a class="btn" href={`${SITE.dataPath}/bulk/events/events.parquet`}>Parquet</a>
      </div>
      <p class="small muted">{t('explorer.eventsNote')}</p>
    </section>
  );
}

function RevExplorer() {
  const { core, route } = useApp();
  const q = route.params;
  const disease = (q.get('d') ?? 'measles').split(',')[0];
  const iso3 = (q.get('c') ?? 'KEN').split(',')[0];
  const rev = useAsync(() => loadRevisions(disease, iso3), [disease, iso3]);
  const rows = Object.entries(rev.data?.changes ?? {}).flatMap(([skey, periods]) => Object.entries(periods).flatMap(([period, h]) => h.map(([si, v]) => ({ series_id: `${skey}.${iso3}`, period, snapshot_id: rev.data!.snapshots[si], value: v, source_id: core.seriesByKey[skey]?.source_id ?? '', origin_type: 'site-derived' }))));
  const prov: Prov = { title: t('explorer.revTitle', { disease: diseaseName(core, disease), name: placeName(core, iso3) }), origin: 'site-derived', sourceIds: Array.from(new Set(['uo_site', ...rows.map((r) => r.source_id).filter(Boolean)])), asOf: core.manifest.generated_at.slice(0, 10), snapshotId: core.manifest.snapshot_id, method: { name: 'revision_recording', version: '1' } };
  return (
    <section class="card">
      <header><h2>{prov.title}</h2><SourceChip prov={prov} /></header>
      <p class="sub">{t('pin.vintage')}</p>
      <div class="tools">
        <label>{t('filter.disease')} <select value={disease} onChange={(e) => setParams({ d: (e.target as HTMLSelectElement).value })}>{core.diseases.filter((d) => d.has_timeseries).map((d) => <option key={d.id} value={d.id}>{diseaseName(core, d.id)}</option>)}</select></label>
        <label>{t('filter.place')} <select value={iso3} onChange={(e) => setParams({ c: (e.target as HTMLSelectElement).value })}>{Object.values(core.places).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.iso3} value={p.iso3}>{placeName(core, p.iso3)}</option>)}</select></label>
      </div>
      <p>{t('explorer.revCount', { n: rows.length, snapshots: core.manifest.snapshots.length })}</p>
      {rows.length > 0 && <div class="tablewrap"><table class="data"><thead><tr><th>{t('table.series')}</th><th>{t('table.period')}</th><th>{t('trace.snapshot')}</th><th class="n">{t('table.value')}</th></tr></thead>
        <tbody>{rows.slice(0, 300).map((r, i) => <tr key={i}><td class="small"><code>{r.series_id}</code></td><td>{r.period}</td><td><code>{r.snapshot_id}</code></td><td class="n">{r.value === null ? t('revisions.removed') : num(r.value)}</td></tr>)}</tbody></table></div>}
      <div class="btnrow" style={{ marginTop: '8px' }}>
        <button type="button" class="btn" disabled={!rows.length} onClick={() => exportBundle(core, prov, rows, 'csv', 'explorer-revisions')}>{t('action.downloadCsv')}</button>
        <a class="btn" href={`${SITE.dataPath}/bulk/revisions/disease=${disease}/revisions.parquet`}>Parquet</a>
        <a class="btn" href={href(route, 'workbench/diff')}>{t('revisions.diffTool')}</a>
      </div>
    </section>
  );
}

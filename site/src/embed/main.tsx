/** Embed entry: a minimal, accessible view with no site chrome. Loads only this site's own assets, sets no cookies,
 *  makes no third-party requests. The source chip and trace panel are kept. Simulation embeds lazy-load their solver. */
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import '../styles/main.css';
import { SITE, absoluteUrl, parseRoute, type Route } from '../lib/app';
import { getJSON, loadCore, loadTs, type Core, type Overview as Ov, type PType, type TsFile } from '../lib/data';
import { altText } from '../lib/exporters';
import { loadLocale, periodLabel, t } from '../lib/i18n';
import { seriesProv, type Prov } from '../lib/prov';
import { mapMetricLabel, placeName, seriesLabel, toSeries } from '../lib/series';
import { activeTransformKeys, applyTransforms, transformsFromParam, type SeriesData } from '../lib/transforms';
import { Chart } from '../components/Chart';
import { SeriesTable } from '../components/ChartCard';
import { LazyMap } from '../components/LazyMap';
import { AppCtx, SourceChip } from '../components/SourceChip';

function diseaseLabel(core: Core, id: string): string { const k = 'disease.' + id; const v = t(k); return v === k ? core.diseaseById[id]?.name ?? id : v; }

function Frame({ title, subtitle, prov, children, route, sitePath }: { title: string; subtitle?: string; prov: Prov | null; children: any; route: Route; sitePath: string }) {
  const pinned = route.snapshot;
  return (
    <div class="wrap">
      <h1 style={{ fontSize: '1.1rem', margin: '4px 0' }}>{title}</h1>
      {subtitle && <p class="sub" data-testid="chart-subtitle">{subtitle}</p>}
      {prov?.origin === 'simulated' && <div class="notice sim" role="note" data-testid="sim-banner">{t('sim.banner')}</div>}
      {children}
      <div class="row" style={{ marginTop: '6px' }}>
        {prov && <SourceChip prov={prov} />}
        <a class="small" href={absoluteUrl(sitePath)} target="_blank" rel="noopener">{t('embed.fullSite')} · {SITE.shortUrl}</a>
      </div>
      {pinned && <p class="small muted" data-testid="pinned-banner">{t('pin.banner', { date: pinned.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), id: pinned })}</p>}
      <p class="small muted">{t('embed.disclaimer')}</p>
    </div>
  );
}

function EmbedChart({ core, route }: { core: Core; route: Route }) {
  const q = route.params;
  const disease = q.get('d') ?? 'measles';
  const d = core.diseaseById[disease];
  const countries = (q.get('c') ?? '').split(',').filter((c) => core.places[c]).slice(0, 10);
  const skeys = (q.get('s') ?? '').split('~').filter((k) => core.seriesByKey[k]);
  const tr = transformsFromParam(q.get('tf'));
  const [files, setFiles] = useState<(TsFile | null)[] | null>(null);
  const [ov, setOv] = useState<Ov | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    if (q.get('global') === '1' || !countries.length) getJSON<Ov>(`overview/${disease}.json`).then(setOv).catch(() => setFiles([]));
    else Promise.all(countries.map((c) => loadTs(core, disease, c, route.snapshot))).then(setFiles);
  }, []);
  const series: SeriesData[] = useMemo(() => {
    if (ov) return [{ id: 'global', label: t('disease.globalLabel', { n: Math.max(...ov.global.n) }), p: ov.global.p, v: ov.global.v, ptype: ov.period_type as PType, incompleteFrom: ov.incomplete_from, skey: ov.skey }];
    const out: SeriesData[] = [];
    for (const f of (files ?? []).filter((x): x is TsFile => !!x)) {
      const keys = skeys.length ? skeys : [d?.default_skey && f.series[d.default_skey] ? d.default_skey : Object.keys(f.series)[0]];
      for (const k of keys) {
        const m = core.seriesByKey[k]; if (!m) continue;
        const s = toSeries(core, f, k, countries.length > 1 ? placeName(core, f.iso3) + (keys.length > 1 ? ' · ' + seriesLabel(core, m, { withSource: true }) : '') : seriesLabel(core, m, { withSource: true }));
        if (s) out.push(s);
      }
    }
    return out;
  }, [files, ov]);
  if (!d) return <p role="alert">{t('disease.unknown', { id: disease })}</p>;
  if (!files && !ov) return <p role="status">{t('state.loading')}</p>;
  const shown = series.map((s) => applyTransforms(s, tr));
  const keys = activeTransformKeys(tr);
  const title = ov ? t('disease.globalTitle', { name: diseaseLabel(core, disease) }) : countries.length === 1 ? t('place.chartTitle', { disease: diseaseLabel(core, disease), name: placeName(core, countries[0]) }) : `${diseaseLabel(core, disease)}: ${countries.map((c) => placeName(core, c)).join(', ')}`;
  const base = seriesProv(core, title, series.filter((s) => s.skey).map((s) => ({ skey: s.skey!, iso3: s.iso3 })), route.snapshot, ov ? { method: { name: 'sum_reporting_countries', version: '1' } } : {});
  const prov: Prov = { ...base, transforms: keys.filter((k) => k !== 'log'), origin: keys.some((k) => k !== 'log') ? 'site-derived' : base.origin };
  const inc = series.some((s) => s.incompleteFrom && s.p.some((p) => p >= s.incompleteFrom!));
  const sitePath = `/${route.locale}/${ov ? 'disease/' + disease : countries.length === 1 ? 'place/' + countries[0] + '?d=' + disease : 'explorer?d=' + disease + '&c=' + countries.join(',')}`;
  return (
    <Frame title={title} subtitle={keys.length ? keys.map((k) => t('transform.' + k, { n: tr.rolling })).join(' · ') : t('transform.none')} prov={prov} route={route} sitePath={sitePath}>
      {!shown.length && <p>{t('explorer.empty')}</p>}
      {shown.length > 0 && !table && <Chart series={shown} xMode={tr.align ? 'index' : 'time'} log={tr.log} ariaLabel={altText(shown, title)} xLabel={tr.align ? t('chart.sinceFirst') : undefined} />}
      {table && <SeriesTable series={shown} />}
      {inc && !tr.excludeIncomplete && <p class="small muted"><span class="badge inc">{t('chart.incompleteShort')}</span> {t('chart.incompleteNote')}</p>}
      <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewChart') : t('action.viewData')}</button>
    </Frame>
  );
}

function EmbedMap({ core, route }: { core: Core; route: Route }) {
  const disease = route.params.get('d') ?? 'measles';
  const region = route.params.get('region') ?? '';
  const [ov, setOv] = useState<Ov | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => { getJSON<Ov>(`overview/${disease}.json`).then(setOv).catch(() => undefined); }, []);
  if (!ov) return <p role="status">{t('state.loading')}</p>;
  const values: Record<string, number | null> = {};
  for (const [iso3, r] of Object.entries(ov.latest)) if (!region || core.places[iso3]?.region === region) values[iso3] = r.metric_value;
  const names: Record<string, string> = {}; for (const k of Object.keys(core.places)) names[k] = placeName(core, k);
  const metric = mapMetricLabel(core, disease, ov.method.window_periods, ov.period_type);
  const meta = core.seriesByKey[ov.skey];
  const title = `${diseaseLabel(core, disease)}: ${metric}`;
  const prov: Prov = { title, origin: 'site-derived', sourceIds: Array.from(new Set([...ov.source_ids, 'naturalearth'])), asOf: meta?.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? ov.snapshot_id, series: [{ skey: ov.skey }], method: { name: ov.method.name, version: ov.method.version, params: { window_periods: ov.method.window_periods } }, caseDefinitions: meta ? [meta.case_definition] : [] };
  const ranked = Object.entries(values).filter(([, v]) => v !== null).sort((a, b) => (b[1] as number) - (a[1] as number));
  return (
    <Frame title={title} subtitle={periodLabel(ov.anchor, ov.period_type)} prov={prov} route={route} sitePath={`/${route.locale}/?d=${disease}`}>
      {!table && <LazyMap values={values} names={names} valueLabel={metric} sourceLabel={ov.source_ids.map((s) => core.sources[s]?.short_name).join(', ')} ariaLabel={t('map.aria', { title })} />}
      {table && <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th scope="col">{t('table.place')}</th><th scope="col" class="n">{metric}</th></tr></thead><tbody>{ranked.map(([k, v]) => <tr key={k}><th scope="row">{names[k]}</th><td class="n">{(v as number).toPrecision(3)}</td></tr>)}</tbody></table></div>}
      <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewMap') : t('action.viewData')}</button>
    </Frame>
  );
}

function EmbedSim({ route }: { route: Route }) {
  const [C, setC] = useState<any>(null);
  useEffect(() => { import('../sim/ui/EmbedSim').then((m) => setC(() => m.default)); }, []);
  return C ? <C route={route} Frame={Frame} /> : <p role="status">{t('state.loading')}</p>;
}

function App() {
  const route = parseRoute();
  const [core, setCore] = useState<Core | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadCore().then(setCore); loadLocale(route.locale).then(() => setReady(true)); }, []);
  if (!core || !ready) return <p role="status">Loading…</p>;
  const kind = route.parts[0];
  return (
    <AppCtx.Provider value={{ core, route }}>
      <main>{kind === 'map' ? <EmbedMap core={core} route={route} /> : kind === 'sim' ? <EmbedSim route={route} /> : <EmbedChart core={core} route={route} />}</main>
    </AppCtx.Provider>
  );
}

render(<App />, document.getElementById('app')!);

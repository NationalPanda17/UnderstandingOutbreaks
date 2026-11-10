/** Geospatial view: period-by-period time slider, event markers / clusters / heatmap, optional population-density layer.
 *  Map state, layers, period, mode, language and snapshot are all encoded in the URL. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { href, navigate, setParams } from '../lib/app';
import { getJSON, type EventIdx, type Overview as Ov } from '../lib/data';
import { caption, exportImage, imageMeta } from '../lib/exporters';
import { periodLabel, smart, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { placeName } from '../lib/series';
import { ErrorBox, FirstUse, Loading, diseaseName, useAsync } from '../components/Layout';
import { LazyMap } from '../components/LazyMap';
import { DENSITY_RAMP, MapLegend, quantileBreaks, type MapPoint } from '../components/mapUtil';
import { SourceChip, useApp } from '../components/SourceChip';

export function MapPage() {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const tsDiseases = core.diseases.filter((d) => d.has_timeseries);
  const q = route.params;
  const disease = q.get('d') && core.diseaseById[q.get('d')!]?.has_timeseries ? q.get('d')! : 'measles';
  const layer = q.get('layer') === 'density' ? 'density' : q.get('layer') === 'none' ? 'none' : 'disease';
  const pm = (['markers', 'clusters', 'heat', 'off'].includes(q.get('pm') ?? '') ? q.get('pm') : 'clusters') as 'markers' | 'clusters' | 'heat' | 'off';
  const evDisease = q.get('ed') ?? '';
  const recentDays = parseInt(q.get('days') ?? '180', 10);
  const selected = (q.get('sel') ?? '').split(',').filter(Boolean);
  const ov = useAsync(() => getJSON<Ov>(`overview/${disease}.json`), [disease]);
  const events = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const [playing, setPlaying] = useState(false);
  const [table, setTable] = useState(false);
  const mapApi = useRef<any>(null);
  const periods = ov.data?.grid.periods ?? [];
  const firstInc = ov.data ? periods.findIndex((p) => p >= ov.data!.incomplete_from) : -1;
  const defIdx = firstInc > 0 ? firstInc - 1 : periods.length - 1;
  const ti = q.get('t') && periods.includes(q.get('t')!) ? periods.indexOf(q.get('t')!) : defIdx;
  const period = periods[ti];
  const incomplete = !!ov.data && !!period && period >= ov.data.incomplete_from;

  useEffect(() => {
    if (!playing || !periods.length) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = setInterval(() => {
      const cur = periods.indexOf(new URLSearchParams(window.location.search).get('t') ?? periods[defIdx]);
      if (cur >= periods.length - 1) { setPlaying(false); return; }
      setParams({ t: periods[cur + 1] });
    }, reduce ? 1500 : 600);
    return () => clearInterval(id);
  }, [playing, periods.length]);

  const names = useMemo(() => { const n: Record<string, string> = {}; for (const k of Object.keys(core.places)) n[k] = placeName(core, k); for (const s of Object.values(core.sources)) n['src:' + s.id] = s.short_name; return n; }, [core, route.locale]);
  const values = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (layer === 'density') { for (const p of Object.values(core.places)) if (p.population && p.area_km2) out[p.iso3] = p.population / p.area_km2; }
    else if (layer === 'disease' && ov.data) for (const [iso3, row] of Object.entries(ov.data.grid.values)) out[iso3] = row[ti] ?? null;
    return out;
  }, [layer, ov.data, ti]);
  // one stable scale across the whole slider, so colours are comparable between periods
  const breaks = useMemo(() => {
    if (layer === 'density') return [10, 50, 100, 250, 500];
    if (!ov.data) return [];
    return quantileBreaks(Object.values(ov.data.grid.values).flat().filter((x): x is number => x !== null && x > 0));
  }, [layer, ov.data]);
  const evs = (events.data?.events ?? []).filter((e) => e.days_since_last_report <= recentDays && (!evDisease || e.disease === evDisease));
  const points: MapPoint[] = pm === 'off' ? [] : evs.flatMap((e) => e.locations.filter((l) => l.lon !== null).map((l, i) => ({
    id: e.event_id, lon: l.lon as number, lat: l.lat as number, label: `${diseaseName(core, e.disease)} — ${l.name}`, precision: l.precision, sources: e.source_ids,
    weight: 1, radius: l.precision === 'country' ? 8 : 6, sub: t('event.lastUpdate', { date: e.last_report }) + (i ? '' : ''),
  })));
  if (ov.error) return <ErrorBox error={ov.error} />;
  const meta = ov.data ? core.seriesByKey[ov.data.skey] : null;
  const metric = layer === 'density' ? t('map.density') : ov.data ? (ov.data.map_metric === 'percent_positive' ? t('map.metric.pctPeriod') : t('map.metric.ratePeriod')) : '';
  const title = layer === 'density' ? t('map.density') : `${diseaseName(core, disease)}: ${metric}${period ? ' · ' + periodLabel(period, ov.data!.period_type) : ''}`;
  const prov: Prov = layer === 'density'
    ? { title, origin: 'site-derived', sourceIds: ['worldbank', 'geonames', 'naturalearth'], asOf: null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, method: { name: 'population_density', version: '1' } }
    : { title, origin: 'site-derived', sourceIds: Array.from(new Set([...(ov.data?.source_ids ?? []), 'naturalearth', ...(points.length ? [...new Set(evs.flatMap((e) => e.source_ids)), 'geonames'] : [])])), asOf: meta?.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, series: ov.data ? [{ skey: ov.data.skey }] : [], method: { name: 'period_rate', version: '1' }, caseDefinitions: meta ? [meta.case_definition] : [] };
  const ranked = Object.entries(values).filter(([, v]) => v !== null).sort((a, b) => (b[1] as number) - (a[1] as number));
  const doExport = async (kind: 'png' | 'svg') => {
    if (!mapApi.current) return;
    const size = mapApi.current.size();
    await exportImage(kind, { imageHref: mapApi.current.image(), width: size.width, height: size.height }, imageMeta(core, prov, title, incomplete ? t('chart.incomplete') : undefined), title, provBlock(core, prov), caption(core, prov, title),
      `${title}. ${ranked.slice(0, 5).map(([k, v]) => `${names[k]}: ${smart(v as number)}`).join('; ')}.`);
  };

  return (
    <>
      <h1>{t('mappage.title')}</h1>
      <p class="lead">{t('mappage.lead')}</p>
      <FirstUse id="map-compare" title={t('firstuse.compare.title')}>{t('firstuse.compare.body')}</FirstUse>
      <section class="card">
        <header><div><h2>{title}</h2><p class="sub">{meta && layer === 'disease' && t('def.' + meta.case_definition)}{incomplete && <> <span class="badge inc">{t('chart.incompleteShort')}</span></>}</p></div><SourceChip prov={prov} /></header>
        <div class="tools" role="group" aria-label={t('mappage.layers')}>
          <label>{t('mappage.layer')} <select value={layer} onChange={(e) => setParams({ layer: (e.target as HTMLSelectElement).value === 'disease' ? null : (e.target as HTMLSelectElement).value })}>
            <option value="disease">{t('mappage.layer.disease')}</option><option value="density">{t('map.density')}</option><option value="none">{t('mappage.layer.none')}</option></select></label>
          {layer === 'disease' && <label>{t('filter.disease')} <select value={disease} onChange={(e) => setParams({ d: (e.target as HTMLSelectElement).value, t: null })}>{tsDiseases.map((x) => <option key={x.id} value={x.id}>{diseaseName(core, x.id)}</option>)}</select></label>}
          <label>{t('mappage.events')} <select value={pm} onChange={(e) => setParams({ pm: (e.target as HTMLSelectElement).value })}>
            <option value="clusters">{t('mappage.pm.clusters')}</option><option value="markers">{t('mappage.pm.markers')}</option><option value="heat">{t('mappage.pm.heat')}</option><option value="off">{t('mappage.pm.off')}</option></select></label>
          {pm !== 'off' && <label>{t('mappage.window')} <select value={String(recentDays)} onChange={(e) => setParams({ days: (e.target as HTMLSelectElement).value })}>{[30, 90, 180, 365, 2000].map((n) => <option key={n} value={String(n)}>{n >= 2000 ? t('mappage.allTime') : t('mappage.days', { n })}</option>)}</select></label>}
          {analyst && pm !== 'off' && <label>{t('mappage.eventDisease')} <select value={evDisease} onChange={(e) => setParams({ ed: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set((events.data?.events ?? []).map((e) => e.disease))).sort().map((d) => <option key={d} value={d}>{diseaseName(core, d)}</option>)}</select></label>}
        </div>
        {layer === 'disease' && periods.length > 0 && (
          <div class="tools" role="group" aria-label={t('mappage.slider')}>
            <button type="button" class="btn small" onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? t('mappage.pause') : t('mappage.play')}</button>
            <label style={{ flex: 1, minWidth: '220px' }}><span class="sr">{t('mappage.slider')}</span>
              <input type="range" min={0} max={periods.length - 1} value={ti} style={{ width: '100%' }} aria-valuetext={period ? periodLabel(period, ov.data!.period_type) : ''}
                onInput={(e) => setParams({ t: periods[parseInt((e.target as HTMLInputElement).value, 10)] })} /></label>
            <b>{period ? periodLabel(period, ov.data!.period_type) : ''}</b>
          </div>
        )}
        {ov.loading && <Loading />}
        {!table && (
          <LazyMap tall values={layer === 'none' ? {} : values} breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} names={names} valueLabel={metric}
            sourceLabel={prov.sourceIds.filter((s) => s !== 'naturalearth' && s !== 'geonames').map((s) => core.sources[s]?.short_name).join(', ')}
            points={points} pointMode={pm === 'off' ? 'markers' : pm} selected={selected}
            onSelect={(iso3) => navigate(href(route, 'place/' + iso3, { d: disease }))} onPoint={(id) => navigate(href(route, 'outbreak/' + id))}
            view={q.get('lng') ? { lng: parseFloat(q.get('lng')!), lat: parseFloat(q.get('lat') ?? '18'), z: parseFloat(q.get('z') ?? '1.1') } : undefined}
            onMove={(v) => setParams({ lng: String(v.lng), lat: String(v.lat), z: String(v.z) })} ariaLabel={t('map.aria', { title })} apiRef={mapApi} />
        )}
        {!table && layer !== 'none' && <MapLegend breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} title={metric} />}
        {table && (
          <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th scope="col">{t('table.place')}</th><th scope="col" class="n">{metric}</th></tr></thead>
            <tbody>{ranked.map(([k, v]) => <tr key={k}><th scope="row"><a href={href(route, 'place/' + k, { d: disease })}>{names[k]}</a></th><td class="n">{smart(v as number)}</td></tr>)}</tbody></table>
            {points.length > 0 && <table class="data"><thead><tr><th scope="col">{t('mappage.events')}</th><th scope="col">{t('map.precision')}</th><th scope="col">{t('map.source')}</th></tr></thead>
              <tbody>{points.map((p, i) => <tr key={i}><th scope="row"><a href={href(route, 'outbreak/' + p.id)}>{p.label}</a></th><td>{t('precision.' + p.precision)}</td><td>{p.sources.map((s) => core.sources[s]?.short_name).join(', ')}</td></tr>)}</tbody></table>}
          </div>
        )}
        {incomplete && <p class="small muted"><span class="badge inc">{t('chart.incompleteShort')}</span> {t('chart.incompleteNote')}</p>}
        <p class="means">{layer === 'density' ? t('mappage.means.density') : t('mappage.means.disease')} {pm !== 'off' && t('mappage.means.points')}</p>
        <div class="btnrow">
          <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewMap') : t('action.viewData')}</button>
          <button type="button" class="btn small" disabled={table} onClick={() => doExport('png')}>{t('action.png')}</button>
          <button type="button" class="btn small" disabled={table} onClick={() => doExport('svg')}>{t('action.svg')}</button>
          {analyst && <a class="btn small" href={href(route, 'workbench/map-select', { d: disease })}>{t('mappage.select')}</a>}
        </div>
      </section>
    </>
  );
}

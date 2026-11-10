/** Geospatial view: period-by-period time slider, event markers / clusters / heatmap, optional population-density layer.
 *  Map state, layers, period, mode, language and snapshot are all encoded in the URL. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { href, navigate, setParams } from '../lib/app';
import { getJSON, type EventIdx, type Overview as Ov } from '../lib/data';
import { caption, exportImage, imageMeta, serializeSvg } from '../lib/exporters';
import { periodLabel, smart, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { placeName } from '../lib/series';
import { ErrorBox, FirstUse, Loading, diseaseName, useAsync } from '../components/Layout';
import { LazyMap } from '../components/LazyMap';
import { DENSITY_RAMP, MapLegend, REGION_VIEWS, classifyMissing, quantileBreaks, type MapPoint, type Missing } from '../components/mapUtil';
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
  // v: interactive map | equal-area static map | small multiples. proj: Mercator or globe. rg: region preset.
  const view = (['flat', 'grid'].includes(q.get('v') ?? '') ? q.get('v') : 'map') as 'map' | 'flat' | 'grid';
  const proj = q.get('proj') === 'globe' ? 'globe' : 'mercator';
  const rg = REGION_VIEWS[q.get('rg') ?? ''] ? q.get('rg')! : 'world';
  const gridBy = q.get('g') === 'diseases' ? 'diseases' : 'time';
  const [stat, setStat] = useState<any>(null);
  useEffect(() => { if (view !== 'map' && !stat) import('../components/StaticMap').then(setStat).catch(() => undefined); }, [view]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ov = useAsync(() => getJSON<Ov>(`overview/${disease}.json`), [disease]);
  const allOv = useAsync(() => (view === 'grid' && gridBy === 'diseases' ? Promise.all(tsDiseases.map((d) => getJSON<Ov>(`overview/${d.id}.json`))) : Promise.resolve(null)), [view, gridBy]);
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
  // Why a place has no value this period: it matters, because an empty area is easily read as "no disease".
  const miss = useMemo(() => (layer === 'disease' && ov.data ? classifyMissing(ov.data.grid.values, ti) : {}), [layer, ov.data, ti]);
  const missing = useMemo(() => Object.fromEntries(Object.entries(miss).map(([k, m]) => [k, m.kind])) as Record<string, Missing>, [miss]);
  const missingLabel = useMemo(() => {
    const out: Record<string, string> = {};
    if (layer !== 'disease' || !ov.data) return out;
    for (const k of Object.keys(core.places)) {
      const m = miss[k];
      if (!ov.data.grid.values[k]) out[k] = t('map.miss.never');
      else if (m) out[k] = m.kind === 'pending' ? t('map.miss.pending', { period: periodLabel(periods[m.last], ov.data.period_type) }) : m.last < 0 ? t('map.miss.neverWindow') : t('map.miss.none');
    }
    return out;
  }, [miss, route.locale]);
  // one stable scale across the whole slider, so colours are comparable between periods
  const breaks = useMemo(() => {
    if (layer === 'density') return [10, 50, 100, 250, 500];
    if (!ov.data) return [];
    return quantileBreaks(Object.values(ov.data.grid.values).flat().filter((x): x is number => x !== null && x > 0));
  }, [layer, ov.data]);
  const evs = (events.data?.events ?? []).filter((e) => e.days_since_last_report <= recentDays && (!evDisease || e.disease === evDisease));
  const points: MapPoint[] = pm === 'off' ? [] : evs.flatMap((e) => e.locations.filter((l) => l.lon !== null).map((l, i) => ({
    id: e.event_id, lon: l.lon as number, lat: l.lat as number, label: `${diseaseName(core, e.disease)} — ${l.name}`, precision: l.precision, sources: e.source_ids,
    weight: 1, radius: e.days_since_last_report <= 30 ? 8 : e.days_since_last_report <= 90 ? 6.5 : 5, sub: t('event.lastUpdate', { date: e.last_report }) + (i ? '' : ''),
  })));
  // small multiples: one panel per period (shared scale) or per disease (each on its own scale)
  const steps = ov.data?.period_type === 'W' ? [1, 4, 13, 52] : ov.data?.period_type === 'M' ? [1, 3, 12] : [1];
  const step = steps.includes(parseInt(q.get('step') ?? '', 10)) ? parseInt(q.get('step')!, 10) : ov.data?.period_type === 'W' ? 4 : 1;
  const panels = useMemo(() => {
    if (view !== 'grid') return [];
    if (layer === 'density') return [{ key: 'density', title: t('map.density'), values }];
    if (gridBy === 'diseases') return (allOv.data ?? []).map((o) => {
      const vals: Record<string, number | null> = {};
      for (const [iso3, r] of Object.entries(o.latest)) vals[iso3] = r.metric_value;
      return { key: o.disease, title: diseaseName(core, o.disease), note: periodLabel(o.anchor, o.period_type), values: vals, breaks: quantileBreaks(Object.values(vals).filter((x): x is number => x !== null)) };
    });
    if (!ov.data) return [];
    const idx: number[] = [];
    for (let i = Math.max(defIdx, 0); i >= 0 && idx.length < 12; i -= step) idx.unshift(i);
    return idx.map((i) => {
      const vals: Record<string, number | null> = {};
      for (const [iso3, row] of Object.entries(ov.data!.grid.values)) vals[iso3] = row[i] ?? null;
      const m = classifyMissing(ov.data!.grid.values, i);
      return { key: periods[i], title: periodLabel(periods[i], ov.data!.period_type), values: vals, missing: Object.fromEntries(Object.entries(m).map(([k, x]) => [k, x.kind])) as Record<string, Missing> };
    });
  }, [view, layer, gridBy, ov.data, allOv.data, step, route.locale]);
  if (ov.error) return <ErrorBox error={ov.error} />;
  const meta = ov.data ? core.seriesByKey[ov.data.skey] : null;
  const metric = layer === 'density' ? t('map.density') : ov.data ? (ov.data.map_metric === 'percent_positive' ? t('map.metric.pctPeriod') : t('map.metric.ratePeriod')) : '';
  const title = layer === 'density' ? t('map.density') : `${diseaseName(core, disease)}: ${metric}${period ? ' · ' + periodLabel(period, ov.data!.period_type) : ''}`;
  const prov: Prov = layer === 'density'
    ? { title, origin: 'site-derived', sourceIds: ['worldbank', 'geonames', 'naturalearth'], asOf: null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, method: { name: 'population_density', version: '1' } }
    : { title, origin: 'site-derived', sourceIds: Array.from(new Set([...(ov.data?.source_ids ?? []), 'naturalearth', ...(points.length ? [...new Set(evs.flatMap((e) => e.source_ids)), 'geonames'] : [])])), asOf: meta?.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, series: ov.data ? [{ skey: ov.data.skey }] : [], method: { name: 'period_rate', version: '1' }, caseDefinitions: meta ? [meta.case_definition] : [] };
  const ranked = Object.entries(values).filter(([, v]) => v !== null).sort((a, b) => (b[1] as number) - (a[1] as number));
  const doExport = async (kind: 'png' | 'svg') => {
    const alt = `${title}. ${ranked.slice(0, 5).map(([k, v]) => `${names[k]}: ${smart(v as number)}`).join('; ')}.`;
    if (view === 'flat') {
      if (!svgRef.current) return;
      await exportImage(kind, serializeSvg(svgRef.current), imageMeta(core, prov, title, incomplete ? t('chart.incomplete') : undefined), title, provBlock(core, prov), caption(core, prov, title), alt);
      return;
    }
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
        <div class="tools" role="group" aria-label={t('mappage.view')}>
          <label>{t('mappage.view')} <select value={view} onChange={(e) => setParams({ v: (e.target as HTMLSelectElement).value === 'map' ? null : (e.target as HTMLSelectElement).value })} data-testid="map-view">
            <option value="map">{t('mappage.view.map')}</option><option value="flat">{t('mappage.view.flat')}</option><option value="grid">{t('mappage.view.grid')}</option></select></label>
          {view === 'map' && <label>{t('mappage.proj')} <select value={proj} onChange={(e) => setParams({ proj: (e.target as HTMLSelectElement).value === 'globe' ? 'globe' : null })}>
            <option value="mercator">{t('mappage.proj.mercator')}</option><option value="globe">{t('mappage.proj.globe')}</option></select></label>}
          <label>{t('mappage.region')} <select value={rg} onChange={(e) => { const k = (e.target as HTMLSelectElement).value; const r = REGION_VIEWS[k]; setParams({ rg: k === 'world' ? null : k, lng: String(r.lng), lat: String(r.lat), z: String(r.z) }); }}>
            {Object.keys(REGION_VIEWS).map((k) => <option key={k} value={k}>{t('mappage.rg.' + k)}</option>)}</select></label>
          {view === 'grid' && layer === 'disease' && <label>{t('mappage.grid.by')} <select value={gridBy} onChange={(e) => setParams({ g: (e.target as HTMLSelectElement).value === 'diseases' ? 'diseases' : null })}>
            <option value="time">{t('mappage.grid.time')}</option><option value="diseases">{t('mappage.grid.diseases')}</option></select></label>}
          {view === 'grid' && layer === 'disease' && gridBy === 'time' && steps.length > 1 && <label>{t('mappage.grid.step')} <select value={String(step)} onChange={(e) => setParams({ step: (e.target as HTMLSelectElement).value })}>
            {steps.map((n) => <option key={n} value={String(n)}>{t('mappage.grid.stepN', { n })}</option>)}</select></label>}
        </div>
        <div class="tools" role="group" aria-label={t('mappage.layers')}>
          <label>{t('mappage.layer')} <select value={layer} onChange={(e) => setParams({ layer: (e.target as HTMLSelectElement).value === 'disease' ? null : (e.target as HTMLSelectElement).value })}>
            <option value="disease">{t('mappage.layer.disease')}</option><option value="density">{t('map.density')}</option><option value="none">{t('mappage.layer.none')}</option></select></label>
          {layer === 'disease' && <label>{t('filter.disease')} <select value={disease} onChange={(e) => setParams({ d: (e.target as HTMLSelectElement).value, t: null })}>{tsDiseases.map((x) => <option key={x.id} value={x.id}>{diseaseName(core, x.id)}</option>)}</select></label>}
          {view === 'map' && <label>{t('mappage.events')} <select value={pm} onChange={(e) => setParams({ pm: (e.target as HTMLSelectElement).value })}>
            <option value="clusters">{t('mappage.pm.clusters')}</option><option value="markers">{t('mappage.pm.markers')}</option><option value="heat">{t('mappage.pm.heat')}</option><option value="off">{t('mappage.pm.off')}</option></select></label>}
          {view === 'map' && pm !== 'off' && <label>{t('mappage.window')} <select value={String(recentDays)} onChange={(e) => setParams({ days: (e.target as HTMLSelectElement).value })}>{[30, 90, 180, 365, 2000].map((n) => <option key={n} value={String(n)}>{n >= 2000 ? t('mappage.allTime') : t('mappage.days', { n })}</option>)}</select></label>}
          {view === 'map' && analyst && pm !== 'off' && <label>{t('mappage.eventDisease')} <select value={evDisease} onChange={(e) => setParams({ ed: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set((events.data?.events ?? []).map((e) => e.disease))).sort().map((d) => <option key={d} value={d}>{diseaseName(core, d)}</option>)}</select></label>}
        </div>
        {layer === 'disease' && periods.length > 0 && !(view === 'grid') && (
          <div class="tools" role="group" aria-label={t('mappage.slider')}>
            <button type="button" class="btn small" onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? t('mappage.pause') : t('mappage.play')}</button>
            <label style={{ flex: 1, minWidth: '220px' }}><span class="sr">{t('mappage.slider')}</span>
              <input type="range" min={0} max={periods.length - 1} value={ti} style={{ width: '100%' }} aria-valuetext={period ? periodLabel(period, ov.data!.period_type) : ''}
                onInput={(e) => setParams({ t: periods[parseInt((e.target as HTMLInputElement).value, 10)] })} /></label>
            <button type="button" class="btn small" disabled={ti <= 0} aria-label={t('mappage.prev')} onClick={() => setParams({ t: periods[ti - 1] })}>‹</button>
            <button type="button" class="btn small" disabled={ti >= periods.length - 1} aria-label={t('mappage.next')} onClick={() => setParams({ t: periods[ti + 1] })}>›</button>
            <b>{period ? periodLabel(period, ov.data!.period_type) : ''}</b>
          </div>
        )}
        {ov.loading && <Loading />}
        {!table && view === 'map' && (
          <LazyMap tall projection={proj} missing={missing} missingLabel={missingLabel} values={layer === 'none' ? {} : values} breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} names={names} valueLabel={metric}
            sourceLabel={prov.sourceIds.filter((s) => s !== 'naturalearth' && s !== 'geonames').map((s) => core.sources[s]?.short_name).join(', ')}
            points={points} pointMode={pm === 'off' ? 'markers' : pm} selected={selected}
            onSelect={(iso3) => navigate(href(route, 'place/' + iso3, { d: disease }))} onPoint={(id) => navigate(href(route, 'outbreak/' + id))}
            view={q.get('lng') ? { lng: parseFloat(q.get('lng')!), lat: parseFloat(q.get('lat') ?? '18'), z: parseFloat(q.get('z') ?? '1.1') } : undefined}
            onMove={(v) => setParams({ lng: String(v.lng), lat: String(v.lat), z: String(v.z) })} ariaLabel={t('map.aria', { title })} apiRef={mapApi} />
        )}
        {!table && view === 'flat' && stat && (
          <stat.StaticMap svgRef={svgRef} values={layer === 'none' ? {} : values} missing={missing} missingLabel={missingLabel} breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} names={names} valueLabel={metric}
            region={rg} height={rg === 'world' ? 500 : 620} title={t('map.aria', { title })} onSelect={(iso3: string) => navigate(href(route, 'place/' + iso3, { d: disease }))} />
        )}
        {!table && view === 'grid' && stat && layer !== 'none' && (
          <stat.MapGrid panels={panels} breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} region={rg}
            onPanel={gridBy === 'time' ? (k: string) => setParams({ t: k, v: null }) : (k: string) => setParams({ d: k, g: null, v: null, t: null })} />
        )}
        {!table && view !== 'map' && !stat && <Loading />}
        {!table && layer !== 'none' && !(view === 'grid' && gridBy === 'diseases') && <MapLegend breaks={breaks} ramp={layer === 'density' ? DENSITY_RAMP : undefined} title={metric} pending={layer === 'disease'} />}
        {table && (
          <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th scope="col">{t('table.place')}</th><th scope="col" class="n">{metric}</th></tr></thead>
            <tbody>{ranked.map(([k, v]) => <tr key={k}><th scope="row"><a href={href(route, 'place/' + k, { d: disease })}>{names[k]}</a></th><td class="n">{smart(v as number)}</td></tr>)}</tbody></table>
            {points.length > 0 && <table class="data"><thead><tr><th scope="col">{t('mappage.events')}</th><th scope="col">{t('map.precision')}</th><th scope="col">{t('map.source')}</th></tr></thead>
              <tbody>{points.map((p, i) => <tr key={i}><th scope="row"><a href={href(route, 'outbreak/' + p.id)}>{p.label}</a></th><td>{t('precision.' + p.precision)}</td><td>{p.sources.map((s) => core.sources[s]?.short_name).join(', ')}</td></tr>)}</tbody></table>}
          </div>
        )}
        {incomplete && <p class="small muted"><span class="badge inc">{t('chart.incompleteShort')}</span> {t('chart.incompleteNote')}</p>}
        <p class="means">{layer === 'density' ? t('mappage.means.density') : t('mappage.means.disease')} {layer === 'disease' && t('mappage.means.missing')} {view === 'map' && pm !== 'off' && t('mappage.means.points')} {view === 'map' ? t('mappage.means.proj') : view === 'flat' ? t('mappage.means.flat') : gridBy === 'diseases' ? t('mappage.grid.ownScale') : t('mappage.grid.sharedScale')}</p>
        <div class="btnrow">
          <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewMap') : t('action.viewData')}</button>
          <button type="button" class="btn small" disabled={table || view === 'grid'} onClick={() => doExport('png')}>{t('action.png')}</button>
          <button type="button" class="btn small" disabled={table || view === 'grid'} onClick={() => doExport('svg')}>{t('action.svg')}</button>
          {analyst && <a class="btn small" href={href(route, 'workbench/map-select', { d: disease })}>{t('mappage.select')}</a>}
        </div>
      </section>
    </>
  );
}

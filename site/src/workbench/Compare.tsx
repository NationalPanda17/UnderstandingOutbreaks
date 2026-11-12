/** Snapshot diff, custom data overlay, map selection, and linked views. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { href, setParams } from '../lib/app';
import { getJSON, getOptional, loadTs, type EventIdx, type Overview as Ov, type PType, type TsFile } from '../lib/data';
import { exportBundle } from '../lib/exporters';
import { date, num, periodLabel, smart, snapLabel, t } from '../lib/i18n';
import { seriesProv, type Prov } from '../lib/prov';
import { placeName, seriesLabel, toSeries } from '../lib/series';
import type { SeriesData } from '../lib/transforms';
import { Chart } from '../components/Chart';
import { ChartCard } from '../components/ChartCard';
import { EventRow } from '../components/Events';
import { ErrorBox, Loading, diseaseName, useAsync } from '../components/Layout';
import { LazyMap } from '../components/LazyMap';
import { quantileBreaks } from '../components/mapUtil';
import { SourceChip, useApp } from '../components/SourceChip';
import { aggregateSeries, diffEvents, diffSnapshots, guessMapping, parseCSV, validateOverlay, type DiffRow, type EventState, type OverlayMapping } from './logic';

function DiseaseSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { core } = useApp();
  return <label>{t('filter.disease')} <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>{core.diseases.filter((d) => d.has_timeseries).map((d) => <option key={d.id} value={d.id}>{diseaseName(core, d.id)}</option>)}</select></label>;
}

// ---------------------------------------------------------------- snapshot diff

/** `plain` is the reader-facing page: readable dates, a default that has something to show, and outbreak changes. */
export function Diff({ plain }: { plain?: boolean }) {
  const { core, route } = useApp();
  const snaps = core.manifest.snapshots;
  const known = (id: string | null) => (id && snaps.some((s) => s.id === id) ? id : null);
  const [disease, setDiseaseState] = useState(route.params.get('d') ?? '');
  // Reader-facing default: the latest snapshot against the last one from an earlier day (a day's change), not the
  // one a few minutes before it.
  const lastId = snaps[snaps.length - 1]?.id ?? '';
  const dayBefore = plain ? snaps.filter((s) => s.id.slice(0, 8) < lastId.slice(0, 8)).pop()?.id : undefined;
  const [a, setAState] = useState(known(route.params.get('a')) ?? dayBefore ?? snaps[Math.max(0, snaps.length - 2)]?.id ?? '');
  const [b, setBState] = useState(known(route.params.get('b')) ?? snaps[snaps.length - 1]?.id ?? '');
  // The choice lives in the address, so a comparison can be linked to and cited.
  const setDisease = (v: string) => { setDiseaseState(v); setParams({ d: v }); };
  const setA = (v: string) => { setAState(v); setParams({ a: v }); };
  const setB = (v: string) => { setBState(v); setParams({ b: v }); };
  const rixQ = useAsync(() => getJSON<any>('revisions/index.json'), []);
  // With no disease chosen, start on one that has recorded changes, so the first view is not an empty table.
  useEffect(() => { if (!disease && rixQ.data) setDiseaseState(Object.keys(rixQ.data.countries_with_changes)[0] ?? 'covid19'); }, [rixQ.data]);
  const order = a <= b;
  const res = useAsync(async () => {
    if (!disease) return [] as DiffRow[];
    const rix = await getJSON<any>('revisions/index.json');
    const ia = rix.snapshots.indexOf(a); const ib = rix.snapshots.indexOf(b);
    const countries: string[] = rix.countries_with_changes[disease] ?? [];
    const files = await Promise.all(countries.map((c) => getOptional<any>(`revisions/${disease}/${c}.json`)));
    const rows: DiffRow[] = [];
    files.forEach((f, i) => { if (f) rows.push(...diffSnapshots(f.changes, countries[i], ia, ib)); });
    return rows;
  }, [disease, a, b]);
  const rows = res.data ?? [];
  const bySource = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) { const sid = core.seriesByKey[r.series_id.slice(0, -4)]?.source_id ?? '?'; m.set(sid, (m.get(sid) ?? 0) + 1); } return Array.from(m.entries()); }, [rows]);
  const prov: Prov = { title: t('diff.resultTitle', { a, b }), origin: 'site-derived', sourceIds: Array.from(new Set(['uo_site', ...bySource.map(([s]) => s).filter((s) => s !== '?')])), asOf: core.manifest.generated_at.slice(0, 10), snapshotId: b, method: { name: 'snapshot_diff', version: '1', params: { a, b, disease } } };
  return (
    <>
      <h2>{plain ? t('datecompare.values') : t('diff.title')}</h2>
      <p class="muted">{t('diff.lead')} {t('pin.vintage')}</p>
      <section class="card">
        <div class="tools">
          <DiseaseSelect value={disease} onChange={setDisease} />
          <label>{t('diff.from')} <select value={a} data-testid="diff-a" onChange={(e) => setA((e.target as HTMLSelectElement).value)}>{snaps.map((s) => <option key={s.id} value={s.id}>{plain ? snapLabel(s.id) : s.id}</option>)}</select></label>
          <label>{t('diff.to')} <select value={b} data-testid="diff-b" onChange={(e) => setB((e.target as HTMLSelectElement).value)}>{snaps.map((s) => <option key={s.id} value={s.id}>{plain ? snapLabel(s.id) : s.id}</option>)}</select></label>
        </div>
        {!order && <div class="notice warn" role="alert">{t('diff.order')}</div>}
        {snaps.length < 2 && <div class="notice">{t('diff.oneSnapshot')}</div>}
        {res.loading && <Loading />}
        <header><h3>{t('diff.count', { n: rows.length })}</h3><SourceChip prov={prov} /></header>
        {bySource.length > 0 && <p class="small">{t('diff.bySource')}: {bySource.map(([s, n]) => `${core.sources[s]?.short_name ?? s} (${n})`).join(', ')}</p>}
        {rows.length > 0 && <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th>{t('table.place')}</th><th>{t('table.series')}</th><th>{t('table.period')}</th><th class="n">{plain ? snapLabel(a) : a.slice(0, 13)}</th><th class="n">{plain ? snapLabel(b) : b.slice(0, 13)}</th><th class="n">{t('diff.change')}</th><th>{t('diff.kind')}</th></tr></thead>
          <tbody>{rows.slice(0, 500).map((r) => { const m = core.seriesByKey[r.series_id.slice(0, -4)]; return <tr key={r.series_id + r.period}><th scope="row">{placeName(core, r.series_id.slice(-3))}</th><td class="small">{m ? seriesLabel(core, m, { withSource: true }) : r.series_id}</td><td>{r.period}</td><td class="n">{num(r.a)}</td><td class="n">{num(r.b)}</td><td class="n">{r.change === null ? '–' : num(r.change, { signDisplay: 'always' })}</td><td>{t('diff.kind.' + r.kind)}</td></tr>; })}</tbody></table></div>}
        <div class="btnrow" style={{ marginTop: '8px' }}><button type="button" class="btn small" disabled={!rows.length} onClick={() => exportBundle(core, prov, rows.map((r) => ({ ...r, source_id: core.seriesByKey[r.series_id.slice(0, -4)]?.source_id ?? '', snapshot_a: a, snapshot_b: b })), 'csv', 'snapshot-diff')}>{t('action.downloadCsv')}</button></div>
      </section>
      {plain && <EventDiff a={a} b={b} />}
    </>
  );
}

/** Outbreak events that are new or changed between two snapshots: status, stated counts, notices, countries. */
function EventDiff({ a, b }: { a: string; b: string }) {
  const { core, route } = useApp();
  const hist = useAsync(() => getOptional<{ source_ids: string[]; events: Record<string, { disease: string; countries: string[]; history: EventState[] }> }>('events/history.json'), []);
  const rows = useMemo(() => (hist.data ? diffEvents(hist.data.events, a, b) : []), [hist.data, a, b]);
  if (!hist.data) return null;
  const places = (cs: string[]) => (cs.length ? cs.slice(0, 4).map((c) => placeName(core, c)).join(', ') + (cs.length > 4 ? ` +${cs.length - 4}` : '') : t('event.multiCountry'));
  const prov: Prov = { title: t('evdiff.title'), origin: 'site-derived', sourceIds: hist.data.source_ids, asOf: core.manifest.generated_at.slice(0, 10), snapshotId: b, method: { name: 'snapshot_diff', version: '1', params: { a, b } } };
  const cell = (s: EventState | null) => (s ? `${t('status.' + s.status)} · ${s.cases === null ? '–' : num(s.cases)} / ${s.deaths === null ? '–' : num(s.deaths)} · ${t('event.nReports', { n: s.n_reports })} · ${s.countries.length ? t('event.scope.multi', { n: s.countries.length }) : t('event.scope.none')}` : '–');
  return (
    <section class="card" style={{ marginTop: '16px' }} data-testid="event-diff">
      <header><h2>{t('evdiff.title')}</h2><SourceChip prov={prov} /></header>
      <p class="sub">{t('evdiff.lead')}</p>
      <h3>{t('evdiff.count', { n: rows.length })}</h3>
      {rows.length > 0 && <div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th scope="col">{t('evdiff.event')}</th><th scope="col">{t('diff.kind')}</th><th scope="col">{snapLabel(a)}</th><th scope="col">{snapLabel(b)}</th></tr></thead>
        <tbody>{rows.slice(0, 200).map((r) => <tr key={r.event_id}><th scope="row"><a href={href(route, 'outbreak/' + r.event_id)}>{diseaseName(core, r.disease)} — {places(r.countries)}</a></th>
          <td>{r.kind === 'new' ? t('diff.kind.new') : r.what.map((w) => t('evdiff.what.' + w)).join(', ')}</td><td class="small">{cell(r.before)}</td><td class="small">{cell(r.after)}</td></tr>)}</tbody></table></div>}
      <p class="small muted">{t('evdiff.note')}</p>
    </section>
  );
}

// ---------------------------------------------------------------- custom overlay (local only)

export function Overlay() {
  const { core, route } = useApp();
  const [disease, setDisease] = useState('measles');
  const [iso3, setIso3] = useState('KEN');
  const [csv, setCsv] = useState<{ columns: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<OverlayMapping | null>(null);
  const [fileName, setFileName] = useState('');
  const [place, setPlace] = useState('');
  const ts = useAsync(() => loadTs(core, disease, iso3, route.snapshot), [disease, iso3, route.snapshot]);
  const result = csv && map ? validateOverlay(csv, map) : null;
  const places = result ? Array.from(new Set(result.points.map((p) => p.place))) : [];
  const chosen = places.includes(place) ? place : places[0] ?? '';
  const d = core.diseaseById[disease];
  const key = d?.default_skey && ts.data?.series[d.default_skey] ? d.default_skey : Object.keys(ts.data?.series ?? {})[0];
  const official = key ? toSeries(core, ts.data, key, `${placeName(core, iso3)} · ${seriesLabel(core, core.seriesByKey[key], { withSource: true })}`) : null;
  const user: SeriesData | null = result && result.points.length ? (() => { const pts = result.points.filter((p) => p.place === chosen); return { id: 'user', label: `${t('overlay.yourData')}${chosen ? ': ' + chosen : ''}`, p: pts.map((p) => p.date), v: pts.map((p) => p.value), ptype: (official?.ptype ?? 'W') as PType, userSupplied: true, color: '#3b3b3b' }; })() : null;
  const onFile = async (f: File | undefined) => { if (!f) return; const parsed = parseCSV(await f.text()); setCsv(parsed); setMap(guessMapping(parsed.columns)); setFileName(f.name); };
  const provOfficial = official ? seriesProv(core, t('overlay.resultTitle', { disease: diseaseName(core, disease), name: placeName(core, iso3) }), [{ skey: key!, iso3 }], route.snapshot) : null;
  return (
    <>
      <h2>{t('overlay.title')}</h2>
      <p class="muted">{t('overlay.lead')}</p>
      <div class="notice" role="note" data-testid="overlay-local"><b>{t('overlay.localTitle')}</b> {t('overlay.local')}</div>
      <section class="card">
        <div class="tools">
          <DiseaseSelect value={disease} onChange={setDisease} />
          <label>{t('filter.place')} <select value={iso3} onChange={(e) => setIso3((e.target as HTMLSelectElement).value)}>{Object.values(core.places).sort((x, y) => x.name.localeCompare(y.name)).map((p) => <option key={p.iso3} value={p.iso3}>{placeName(core, p.iso3)}</option>)}</select></label>
          <label class="btn">{t('overlay.choose')}<input type="file" accept=".csv,text/csv,text/plain" class="sr" onChange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} /></label>
          {fileName && <span class="small muted">{fileName}</span>}
        </div>
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); }} style={{ border: '2px dashed var(--line)', borderRadius: '8px', padding: '14px', textAlign: 'center' }} class="muted small">{t('overlay.drop')}</div>
        {csv && map && (
          <div class="tools" style={{ marginTop: '8px' }}>
            <label>{t('overlay.colDate')} <select value={map.date} onChange={(e) => setMap({ ...map, date: (e.target as HTMLSelectElement).value })}>{csv.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>{t('overlay.colValue')} <select value={map.value} onChange={(e) => setMap({ ...map, value: (e.target as HTMLSelectElement).value })}>{csv.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>{t('overlay.colPlace')} <select value={map.place ?? ''} onChange={(e) => setMap({ ...map, place: (e.target as HTMLSelectElement).value || null })}><option value="">{t('pivot.none')}</option>{csv.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            {places.length > 1 && <label>{t('overlay.showPlace')} <select value={chosen} onChange={(e) => setPlace((e.target as HTMLSelectElement).value)}>{places.map((p) => <option key={p} value={p}>{p || '–'}</option>)}</select></label>}
          </div>
        )}
        {result && result.errors.map((e) => <div class="notice warn" role="alert" key={e}>{t('overlay.err.' + e)}</div>)}
        {result && result.warnings.map((w) => <div class="notice" role="note" key={w}>{t('overlay.warn.' + w, { n: result.skipped })}</div>)}
        {result && !result.errors.length && <p class="small">{t('overlay.rows', { n: result.points.length })}</p>}
      </section>
      {ts.loading && <Loading />}
      {official && provOfficial && (
        <div style={{ marginTop: '16px' }}>
          <ChartCard id="overlay-chart" title={provOfficial.title} series={user ? [official, user] : [official]} prov={provOfficial} disease={disease} means={user ? t('overlay.means') : t('overlay.meansEmpty')} />
          {user && <p class="small"><span class="badge">{t('origin.user-supplied')}</span> {t('overlay.exportNote')}</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- map selection: aggregate and compare

export function MapSelect() {
  const { core, route } = useApp();
  const disease = route.params.get('d') && core.diseaseById[route.params.get('d')!]?.has_timeseries ? route.params.get('d')! : 'measles';
  const groupA = (route.params.get('a') ?? '').split(',').filter((c) => core.places[c]);
  const groupB = (route.params.get('b') ?? '').split(',').filter((c) => core.places[c]);
  const [active, setActive] = useState<'a' | 'b'>('a');
  const ov = useAsync(() => getJSON<Ov>(`overview/${disease}.json`), [disease]);
  const files = useAsync(() => Promise.all([...groupA, ...groupB].map((c) => loadTs(core, disease, c, route.snapshot))), [disease, groupA.join(), groupB.join(), route.snapshot]);
  const toggle = (iso3: string) => { const cur = active === 'a' ? groupA : groupB; const next = cur.includes(iso3) ? cur.filter((x) => x !== iso3) : [...cur, iso3].slice(0, 40); setParams({ [active]: next.join(',') || null }); };
  const names = useMemo(() => { const n: Record<string, string> = {}; for (const k of Object.keys(core.places)) n[k] = placeName(core, k); return n; }, [core]);
  const centroids = useMemo(() => Object.fromEntries(Object.values(core.places).map((p) => [p.iso3, p.centroid])), [core]);
  const d = core.diseaseById[disease];
  const build = (group: string[], label: string, color: string): SeriesData | null => {
    const fs = (files.data ?? []).filter((f): f is TsFile => !!f && group.includes(f.iso3) && !!f.series[d.default_skey!]);
    if (!fs.length) return null;
    const ss = fs.map((f) => toSeries(core, f, d.default_skey!, f.iso3)).filter((s): s is SeriesData => !!s);
    const agg = aggregateSeries(ss);
    const pop = fs.reduce((s, f) => s + (core.places[f.iso3]?.population ?? 0), 0);
    return { id: label, label: `${label} (${fs.length})`, p: agg.p, v: agg.v, ptype: ss[0].ptype, population: pop || null, incompleteFrom: ss[0].incompleteFrom, color };
  };
  const sA = build(groupA, t('mapsel.groupA'), '#0072B2'); const sB = build(groupB, t('mapsel.groupB'), '#E69F00');
  const series = [sA, sB].filter((s): s is SeriesData => !!s);
  if (ov.error) return <ErrorBox error={ov.error} />;
  const values: Record<string, number | null> = {}; if (ov.data) for (const [k, r] of Object.entries(ov.data.latest)) values[k] = r.metric_value;
  const title = t('mapsel.resultTitle', { disease: diseaseName(core, disease) });
  const prov = d.default_skey ? seriesProv(core, title, [...groupA, ...groupB].map((c) => ({ skey: d.default_skey!, iso3: c })), route.snapshot, { method: { name: 'sum_selected_places', version: '1', params: { a: groupA, b: groupB, rule: 'period kept only when every selected place reported' } }, sourceIds: ['worldbank', 'naturalearth'] }) : null;
  return (
    <>
      <h2>{t('mapsel.title')}</h2>
      <p class="muted">{t('mapsel.lead')}</p>
      <section class="card">
        <div class="tools">
          <DiseaseSelect value={disease} onChange={(v) => setParams({ d: v })} />
          <span class="seg" role="group" aria-label={t('mapsel.active')}><button type="button" aria-pressed={active === 'a'} onClick={() => setActive('a')}>{t('mapsel.groupA')} ({groupA.length})</button><button type="button" aria-pressed={active === 'b'} onClick={() => setActive('b')}>{t('mapsel.groupB')} ({groupB.length})</button></span>
          <button type="button" class="btn small" onClick={() => setParams({ a: null, b: null })}>{t('mapsel.clear')}</button>
        </div>
        <LazyMap values={values} breaks={quantileBreaks(Object.values(values).filter((x): x is number => x !== null))} names={names} selected={[...groupA, ...groupB]} onSelect={toggle} onRegion={(list) => setParams({ [active]: Array.from(new Set([...(active === 'a' ? groupA : groupB), ...list])).slice(0, 40).join(',') })} centroids={centroids} ariaLabel={t('map.aria', { title })} />
        <p class="small muted">{t('mapsel.hint')}</p>
        <label class="small">{t('mapsel.addByList')} <select value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) toggle(v); }}><option value="">…</option>{Object.values(core.places).sort((x, y) => x.name.localeCompare(y.name)).map((p) => <option key={p.iso3} value={p.iso3}>{names[p.iso3]}</option>)}</select></label>
        <p class="small">{t('mapsel.groupA')}: {groupA.map((c) => names[c]).join(', ') || '–'}<br />{t('mapsel.groupB')}: {groupB.map((c) => names[c]).join(', ') || '–'}</p>
      </section>
      {files.loading && <Loading />}
      {series.length > 0 && prov && <div style={{ marginTop: '16px' }}><ChartCard id="mapsel-chart" title={title} series={series} prov={prov} defaultTransforms={d.rate_metric ? 'pc.xi' : 'xi'} means={t('mapsel.means')} /></div>}
    </>
  );
}

// ---------------------------------------------------------------- linked views

export function Linked() {
  const { core, route } = useApp();
  const disease = route.params.get('d') && core.diseaseById[route.params.get('d')!]?.has_timeseries ? route.params.get('d')! : 'covid19';
  const from = route.params.get('from'); const to = route.params.get('to');
  const sel = (route.params.get('sel') ?? '').split(',').filter((c) => core.places[c]);
  const ov = useAsync(() => getJSON<Ov>(`overview/${disease}.json`), [disease]);
  const events = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const names = useMemo(() => { const n: Record<string, string> = {}; for (const k of Object.keys(core.places)) n[k] = placeName(core, k); return n; }, [core]);
  if (ov.error) return <ErrorBox error={ov.error} />;
  if (!ov.data) return <Loading />;
  const o = ov.data;
  const periods = o.grid.periods; const inRange = (p: string) => (!from || p >= from) && (!to || p <= to);
  const idx = periods.map((p, i) => (inRange(p) ? i : -1)).filter((i) => i >= 0);
  const values: Record<string, number | null> = {};
  for (const [iso3, row] of Object.entries(o.grid.values)) { const xs = idx.map((i) => row[i]).filter((x): x is number => x !== null); values[iso3] = xs.length ? xs.reduce((a, b) => a + b, 0) / (o.map_metric === 'percent_positive' ? xs.length : 1) : null; }
  const total: SeriesData = { id: 'g', label: t('disease.globalLabel', { n: Math.max(...o.global.n) }), p: o.global.p.filter((p) => p >= periods[0]), v: o.global.v.slice(o.global.p.findIndex((p) => p >= periods[0])), ptype: o.period_type, incompleteFrom: o.incomplete_from };
  const ranked = Object.entries(values).filter(([k, v]) => v !== null && (!sel.length || sel.includes(k))).sort((a, b) => (b[1] as number) - (a[1] as number));
  const evs = (events.data?.events ?? []).filter((e) => (!from || e.last_report >= from) && (!to || e.first_report <= to) && (!sel.length || e.countries.some((c) => sel.includes(c))) && e.disease === disease);
  const meta = core.seriesByKey[o.skey];
  const range = `${from ? date(from) : periodLabel(periods[0], o.period_type)} – ${to ? date(to) : periodLabel(periods[periods.length - 1], o.period_type)}`;
  const prov: Prov = { title: t('linked.resultTitle', { disease: diseaseName(core, disease), range }), origin: 'site-derived', sourceIds: Array.from(new Set([...o.source_ids, 'naturalearth'])), asOf: meta?.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? o.snapshot_id, series: [{ skey: o.skey }], method: { name: 'range_rate', version: '1', params: { from, to, places: sel } } };
  return (
    <>
      <h2>{t('linked.title')}</h2>
      <p class="muted">{t('linked.lead')}</p>
      <div class="tools"><DiseaseSelect value={disease} onChange={(v) => setParams({ d: v, from: null, to: null })} /><button type="button" class="btn small" onClick={() => setParams({ from: null, to: null, sel: null })}>{t('linked.reset')}</button><span class="small"><b>{range}</b>{sel.length > 0 && <> · {sel.map((c) => names[c]).join(', ')}</>}</span><SourceChip prov={prov} /></div>
      <div class="grid two">
        <section class="card"><h3>{t('linked.brush')}</h3><Chart series={[total]} ariaLabel={t('linked.brush')} onBrush={(a, b) => setParams({ from: a, to: b })} compact bands={from && to ? [{ x0: from, x1: to, label: '' }] : undefined} /><p class="small muted">{t('linked.brushHint')}</p></section>
        <section class="card"><h3>{t('linked.map')}</h3><LazyMap values={values} breaks={quantileBreaks(Object.values(values).filter((x): x is number => x !== null))} names={names} selected={sel} onSelect={(iso3) => setParams({ sel: (sel.includes(iso3) ? sel.filter((x) => x !== iso3) : [...sel, iso3]).join(',') || null })} ariaLabel={t('map.aria', { title: prov.title })} /></section>
        <section class="card"><h3>{t('linked.table')}</h3><div class="tablewrap" tabIndex={0}><table class="data"><thead><tr><th>{t('table.place')}</th><th class="n">{o.map_metric === 'percent_positive' ? t('map.metric.pctPeriod') : t('linked.rateInRange')}</th></tr></thead><tbody>{ranked.slice(0, 100).map(([k, v]) => <tr key={k}><th scope="row"><a href={href(route, 'place/' + k, { d: disease })}>{names[k]}</a></th><td class="n">{smart(v as number)}</td></tr>)}</tbody></table></div></section>
        <section class="card"><h3>{t('linked.events', { n: evs.length })}</h3>{!evs.length && <p class="muted small">{t('changes.none')}</p>}<ul class="list">{evs.slice(0, 8).map((e) => <EventRow key={e.event_id} e={e} />)}</ul></section>
      </div>
    </>
  );
}

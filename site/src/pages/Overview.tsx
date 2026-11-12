/** Global overview: choropleth for time-series diseases, ranked active outbreaks, trend sparklines, recent flags. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { absoluteUrl, href, navigate, setParams } from '../lib/app';
import { getJSON, getOptional, type Core, type EventIdx, type Flag, type Overview as Ov } from '../lib/data';
import { caption, copyText, exportImage, imageMeta, serializeSvg } from '../lib/exporters';
import { date, num, periodInSentence, periodLabel, smart, t } from '../lib/i18n';
import { provBlock, type Prov } from '../lib/prov';
import { mapMetricLabel, placeName, measureLabel, measureInSentence } from '../lib/series';
import { Sparkline } from '../components/Chart';
import { EventRow, eventPlaces } from '../components/Events';
import { AgeBadge, Breakdown, DiseaseBadge, ErrorBox, HowToRead, Loading, diseaseName, useAsync } from '../components/Layout';
import { Search } from '../components/Search';
import { CiteButton, globalStatement } from '../components/Cite';
import { loadReporting, reportingShort } from '../components/ReportingHealth';
import { LazyMap } from '../components/LazyMap';
import { CountryPopover, MapLegend, fixedBreaks, type MapPoint } from '../components/mapUtil';
import { Dialog, SourceChip, useApp } from '../components/SourceChip';

/** What the map says about one country, spelled out: the value, how many periods of the window it rests on, and for
 *  influenza how many samples. A value that cannot be computed says why instead of showing a number. */
export function windowLines(pk: Ov['latest'][string], metricLabel: string, ptype: string): string[] {
  const out: string[] = [];
  if (pk.metric_value !== null) out.push(`${metricLabel}: ${smart(pk.metric_value)}`);
  else out.push(pk.not_computable ? t('map.notComputable.' + pk.not_computable) : t('map.noDataWindow'));
  if (pk.specimens !== undefined && pk.specimens !== null && pk.detections_paired !== undefined && pk.detections_paired !== null) out.push(t('map.paired', { k: num(pk.detections_paired), n: num(pk.specimens) }));
  if (pk.value !== null) out.push(`${t('table.count')}: ${num(pk.value)}`);
  const w = pk.window_periods ?? 1;
  if (w > 1) out.push(pk.scaled_from_periods ? t('map.weeksScaled', { n: pk.n_periods, w }) : t('map.weeksOf', { n: pk.n_periods, w }));
  void ptype;
  return out;
}

export function overviewProv(core: Core, ov: Ov, snapshot: string | null): Prov {
  const meta = core.seriesByKey[ov.skey];
  return {
    title: `${diseaseName(core, ov.disease)}: ${mapMetricLabel(core, ov.disease, ov.method.window_periods, ov.period_type)}`,
    origin: 'site-derived', sourceIds: Array.from(new Set([...ov.source_ids, 'naturalearth'])), asOf: meta?.retrieved_at?.slice(0, 10) ?? null,
    snapshotId: snapshot ?? ov.snapshot_id, series: [{ skey: ov.skey }], method: { name: ov.method.name, version: ov.method.version, params: { window_periods: ov.method.window_periods, anchor: ov.anchor } },
    caseDefinitions: meta ? [meta.case_definition] : [],
  };
}

export function FlagList({ flags, limit }: { flags: Flag[]; limit: number }) {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  // one entry per series: the most recent flagged period, plus how many recent periods were flagged
  const bySeries = new Map<string, { f: Flag; n: number }>();
  for (const f of flags) { const e = bySeries.get(f.series_id); if (!e) bySeries.set(f.series_id, { f, n: 1 }); else e.n += 1; }
  const items = Array.from(bySeries.values()).slice(0, limit);
  if (!items.length) return <p class="muted small">{t('flags.none')}</p>;
  return (
    <ul class="list small">
      {items.map(({ f, n }) => {
        const meta = core.seriesByKey[f.skey];
        return (
          <li key={f.series_id} data-flag>
            <a href={href(route, 'place/' + f.iso3, { d: f.disease })}>{placeName(core, f.iso3)}</a> · {diseaseName(core, f.disease)} · {periodLabel(f.period, meta?.period_type ?? 'W')}
            <div class="muted">{t('flags.text', { method: f.method })}{n > 1 && <> {t('flags.more', { n })}</>}</div>
            {analyst && f.basis === 'percent_positive' && <div class="muted">{t('flags.detailPct', { value: num(f.value), detections: num(f.detections ?? null), specimens: num(f.specimens ?? null), mean: num(f.baseline_mean), threshold: num(f.threshold) })}</div>}
            {analyst && f.basis !== 'percent_positive' && <div class="muted">{t('flags.detail', { value: num(f.value), mean: num(f.baseline_mean), threshold: num(f.threshold), from: date(f.baseline_periods[0]), to: date(f.baseline_periods[1]) })}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** The disease the home map and the full map open on: the freshest series the site has. */
export const HOME_DISEASE = 'influenza';

/** Why the map shows the period it shows: the latest complete one, and how far the next one has filled in. A period
 *  is mapped once about nine in ten of the countries that usually report have reported it. */
export function periodNote(ov: Ov, usual: number | null | undefined): string {
  const out = [t('period.latestComplete', { period: periodInSentence(ov.anchor, ov.period_type) })];
  const i = ov.global.p.findIndex((p) => p >= ov.incomplete_from);
  const n = i >= 0 ? ov.global.n?.[i] : undefined;
  if (i >= 0 && n !== undefined && n !== null && usual) out.push(t('period.pending', { period: periodLabel(ov.global.p[i], ov.period_type), n, usual: Math.round(usual) }));
  return out.join(' ');
}

export function Overview() {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const tsDiseases = core.diseases.filter((d) => d.has_timeseries);
  // The map opens on the freshest series the site has (influenza is weekly; measles is monthly and arrives about three
  // months late), so the first view is as recent as official reporting allows.
  const fallback = core.diseaseById[HOME_DISEASE]?.has_timeseries ? HOME_DISEASE : tsDiseases[0]?.id ?? 'measles';
  const disease = route.params.get('d') && core.diseaseById[route.params.get('d')!]?.has_timeseries ? route.params.get('d')! : fallback;
  const region = route.params.get('region') ?? '';
  const type = route.params.get('type') ?? '';
  const [table, setTable] = useState(false);
  const [embed, setEmbed] = useState(false);
  const mapApi = useRef<any>(null);
  // The home page draws a lightweight static map first (about 440 KB less to download than the interactive one)
  // and loads the interactive map, with its basemap, only when the visitor asks to pan and zoom.
  const [interactive, setInteractive] = useState(() => { try { return sessionStorage.getItem('uo-map-interactive') === '1'; } catch { return false; } });
  const goInteractive = () => { try { sessionStorage.setItem('uo-map-interactive', '1'); } catch { /* storage unavailable: the choice lasts for this page only */ } setInteractive(true); };
  const [stat, setStat] = useState<any>(null);
  useEffect(() => { if (!interactive && !stat) import('../components/StaticMap').then(setStat).catch(() => setInteractive(true)); }, [interactive]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const regions = useMemo(() => Array.from(new Set(Object.values(core.places).map((p) => p.region))).sort(), [core]);

  const ov = useAsync(() => getJSON<Ov>(`overview/${disease}.json`), [disease]);
  const events = useAsync(() => getJSON<{ events: EventIdx[]; n_events: number }>('events/active.json'), []);
  const flags = useAsync(() => getOptional<{ flags: Flag[] }>('flags/recent.json'), []);
  const rep = useAsync(() => loadReporting(disease), [disease]);
  const sparks = useAsync(() => getJSON<{ diseases: Pick<Ov, 'disease' | 'skey' | 'source_ids' | 'snapshot_id' | 'period_type' | 'incomplete_from' | 'global'>[] }>('overview/summary.json').then((x) => x.diseases), []);

  const inRegion = (iso3: string) => !region || core.places[iso3]?.region === region;
  const values = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (ov.data) for (const [iso3, r] of Object.entries(ov.data.latest)) if (inRegion(iso3)) out[iso3] = r.metric_value;
    return out;
  }, [ov.data, region]);
  const breaks = useMemo(() => fixedBreaks(core.diseaseById[disease]?.map_metric), [disease]);
  const ranked = useMemo(() => Object.entries(values).filter(([, v]) => v !== null).sort((a, b) => (b[1] as number) - (a[1] as number)), [values]);
  const names = useMemo(() => { const n: Record<string, string> = {}; for (const k of Object.keys(core.places)) n[k] = placeName(core, k); for (const s of Object.values(core.sources)) n['src:' + s.id] = s.short_name; return n; }, [core, route.locale]);

  const active = (events.data?.events ?? []).filter((e) => e.rank.active
    && (!region || e.countries.some(inRegion)) && (!type || (type === 'ts') === !!core.diseaseById[e.disease]?.has_timeseries)
    && (!route.params.get('ed') || e.disease === route.params.get('ed')));

  // Active event notices on the overview map: where official notices place events that are still being reported.
  const showEvents = route.params.get('ev') !== '0';
  const points: MapPoint[] = !showEvents ? [] : active.flatMap((e) => e.locations.filter((l) => l.lon !== null && (!region || inRegion(l.iso3 ?? e.countries[0]))).map((l) => ({
    id: e.event_id, lon: l.lon as number, lat: l.lat as number, label: `${diseaseName(core, e.disease)} — ${l.name}`, precision: l.precision, sources: e.source_ids,
    radius: e.days_since_last_report <= 30 ? 7.5 : 5.5, sub: t('event.lastUpdate', { date: e.last_report }),
  })));
  const headline = (sparks.data ?? []).map((o) => {
    const i = o.global.p.map((p, k) => (p < o.incomplete_from && o.global.v[k] !== null ? k : -1)).filter((k) => k >= 0).pop();
    const m = core.seriesByKey[o.skey];
    return i === undefined || !m ? null : { o, m, last: [o.global.p[i], o.global.v[i] as number] as [string, number], nAt: o.global.n?.[i] ?? null };
  }).filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => 'WMY'.indexOf(x.o.period_type) - 'WMY'.indexOf(y.o.period_type) || (x.last[0] < y.last[0] ? 1 : -1)).slice(0, 3);
  if (ov.error) return <ErrorBox error={ov.error} />;
  const d = core.diseaseById[disease];
  const baseProv = ov.data ? overviewProv(core, ov.data, route.snapshot) : null;
  const prov = baseProv && points.length ? { ...baseProv, sourceIds: Array.from(new Set([...baseProv.sourceIds, ...active.flatMap((e) => e.source_ids), 'geonames'])) } : baseProv;
  const metricLabel = ov.data ? mapMetricLabel(core, disease, ov.data.method.window_periods, ov.data.period_type) : '';
  const windowText = ov.data ? `${periodLabel(ov.data.latest[Object.keys(ov.data.latest)[0]]?.window[0] ?? ov.data.anchor, ov.data.period_type)} – ${periodLabel(ov.data.anchor, ov.data.period_type)}` : '';
  const meta = ov.data ? core.seriesByKey[ov.data.skey] : null;
  const baseTitle = `${diseaseName(core, disease)}: ${metricLabel}`;
  const title = ov.data?.period_type === 'Y' ? t('age.titleLatest', { title: baseTitle, year: ov.data.anchor.slice(0, 4) }) : baseTitle;
  const embedUrl = absoluteUrl(`/embed/${route.locale}/map?d=${disease}${region ? '&region=' + encodeURIComponent(region) : ''}&snapshot=${core.manifest.snapshot_id}`);

  const exportMap = async (kind: 'png' | 'svg') => {
    if (!prov) return;
    const legend = `${metricLabel} · ${windowText}`;
    if (!interactive) {
      if (!svgRef.current) return;
      await exportImage(kind, serializeSvg(svgRef.current), imageMeta(core, prov, title, legend), title, provBlock(core, prov), caption(core, prov, title, legend),
        `${title}. ${ranked.slice(0, 5).map(([k, v]) => `${names[k]}: ${smart(v as number)}`).join('; ')}.`);
      return;
    }
    if (!mapApi.current) return;
    const size = mapApi.current.size();
    await exportImage(kind, { imageHref: mapApi.current.image(), width: size.width, height: size.height }, imageMeta(core, prov, title, legend), title, provBlock(core, prov), caption(core, prov, title, legend),
      `${title}. ${ranked.slice(0, 5).map(([k, v]) => `${names[k]}: ${smart(v as number)}`).join('; ')}.`);
  };

  const mapContext = `${diseaseName(core, disease)} · ${windowText}`;
  const pk = picked && ov.data ? ov.data.latest[picked] : null;
  const popover = picked ? (
    <CountryPopover name={names[picked] ?? picked} context={mapContext} to={href(route, 'place/' + picked, { d: disease })} onClose={() => setPicked(null)}
      lines={pk ? [
        ...windowLines(pk, metricLabel, ov.data!.period_type),
        ...(meta ? [`${measureLabel(meta.metric, meta.case_definition)}`] : []),
        ...(pk.last_period ? [`${t('table.lastPeriod')}: ${periodLabel(pk.last_period, ov.data!.period_type)}`] : []),
        ...(rep.data && reportingShort(rep.data, picked) ? [`${t('health.title')}: ${reportingShort(rep.data, picked)}`] : []),
      ] : [t('map.miss.never')]}>
      {pk && pk.metric_value !== null && prov && <CiteButton prov={{ ...prov, series: [{ skey: ov.data!.skey, iso3: picked }] }} title={title} subtitle={windowText}
        statement={t('citep.stmt.place', { place: names[picked] ?? picked, metric: metricLabel, value: smart(pk.metric_value), window: windowText })} url={href(route, 'place/' + picked, { d: disease })} />}
    </CountryPopover>
  ) : null;
  return (
    <>
      <h1>{t('overview.title')}</h1>
      <p class="lead">{t('overview.leadShort')}</p>
      <Search hero />

      {/* What the official reports say right now, in sentences built from the data. Every sentence links to its page. */}
      <section class="card summary" data-testid="hero" aria-labelledby="summary-h">
        <h2 id="summary-h">{t('summary.title')}</h2>
        <ul class="summarylist">
          {active.slice(0, 3).map((e) => (
            <li key={e.event_id} data-testid="summary-event"><a href={href(route, 'outbreak/' + e.event_id)}><b>{diseaseName(core, e.disease)}</b> — {eventPlaces(core, e)}</a>: {t('summary.event', { date: date(e.last_report, 'long'), n: e.n_reports })}</li>
          ))}
          {headline.map(({ o, last, nAt, m }) => (
            <li key={o.disease} data-testid="summary-disease"><a href={href(route, 'disease/' + o.disease)}><b>{diseaseName(core, o.disease)}</b></a>: {nAt !== null && o.global.n_total
              ? t('summary.disease', { value: num(last[1]), measure: measureInSentence(m.metric, m.case_definition), period: periodInSentence(last[0], o.period_type), n: nAt, N: o.global.n_total })
              : t('summary.diseaseNoN', { value: num(last[1]), measure: measureInSentence(m.metric, m.case_definition), period: periodInSentence(last[0], o.period_type) })}</li>
          ))}
        </ul>
        {events.loading && !active.length && <Loading />}
        <p class="summarylinks"><a href={href(route, 'outbreaks')}>{t('overview.allOutbreaks', { n: events.data?.n_events ?? 0 })}</a> · <a href={href(route, 'changes')}>{t('nav.changes')}</a></p>
        <HowToRead><p>{t('summary.note')}</p><p>{t('hero.note')}</p></HowToRead>
      </section>

      <div class="grid side">
        <section class="card" id="overview-map">
          <header>
            <div><h2>{title}</h2><p class="sub">{windowText}{meta && <> · {t('def.' + meta.case_definition)}</>} <DiseaseBadge d={d} /> {ov.data && <AgeBadge period={ov.data.anchor} ptype={ov.data.period_type} />}{meta?.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}</p></div>
            {prov && <SourceChip prov={prov} />}
          </header>
          {ov.data && <p class="sub" data-testid="period-note">{periodNote(ov.data, (meta?.lag as any)?.completeness?.usual_reporters)}</p>}
          <div class="tools" role="group" aria-label={t('overview.filters')}>
            <label>{t('filter.disease')} <select value={disease} onChange={(e) => setParams({ d: (e.target as HTMLSelectElement).value })} data-testid="disease-select">
              {tsDiseases.map((x) => <option key={x.id} value={x.id}>{diseaseName(core, x.id)}</option>)}
            </select></label>
            <label>{t('filter.region')} <select value={region} onChange={(e) => setParams({ region: (e.target as HTMLSelectElement).value || null })}>
              <option value="">{t('filter.allRegions')}</option>{regions.map((r) => <option key={r} value={r}>{t('region.' + r)}</option>)}
            </select></label>
            {analyst && <label>{t('filter.dataType')} <select value={type} onChange={(e) => setParams({ type: (e.target as HTMLSelectElement).value || null })}>
              <option value="">{t('filter.allTypes')}</option><option value="ts">{t('badge.timeseries')}</option><option value="ev">{t('badge.events-only')}</option>
            </select></label>}
          </div>
          {ov.loading && <Loading />}
          {ov.data && !table && !interactive && stat && (
            <div style={{ position: 'relative' }}>
              <stat.StaticMap svgRef={svgRef} values={values} breaks={breaks} names={names} valueLabel={metricLabel} context={mapContext} height={470} title={t('map.aria', { title })}
                points={points} onPoint={(id: string) => navigate(href(route, 'outbreak/' + id))} onSelect={(iso3: string) => setPicked(iso3)} />
              {popover}
              <button type="button" class="btn small mapswap" onClick={goInteractive} data-testid="map-interactive">{t('overview.panZoom')}</button>
            </div>
          )}
          {ov.data && !table && !interactive && !stat && <Loading />}
          {ov.data && !table && interactive && (
            <div style={{ position: 'relative' }}>{popover}<LazyMap context={mapContext} values={values} breaks={breaks} names={names} valueLabel={metricLabel} sourceLabel={prov ? prov.sourceIds.map((s) => core.sources[s]?.short_name).join(', ') : ''}
              points={points} pointMode="markers" onPoint={(id) => navigate(href(route, 'outbreak/' + id))}
              onSelect={(iso3) => setPicked(iso3)} ariaLabel={t('map.aria', { title })} apiRef={mapApi} /></div>
          )}
          {ov.data && !table && <MapLegend breaks={breaks} title={metricLabel} />}
          {ov.data && !table && <p class="small"><label><input type="checkbox" checked={showEvents} onChange={(e) => setParams({ ev: (e.target as HTMLInputElement).checked ? null : '0' })} /> {t('overview.showEvents')}</label></p>}
          {ov.data && table && (
            <div class="tablewrap" tabIndex={0}><table class="data">
              <thead><tr><th scope="col">{t('table.place')}</th><th scope="col" class="n">{metricLabel}</th><th scope="col" class="n">{t('table.count')}</th><th scope="col">{t('table.lastPeriod')}</th></tr></thead>
              <tbody>
                {ranked.map(([k, v]) => <tr key={k}><th scope="row"><a href={href(route, 'place/' + k, { d: disease })}>{names[k]}</a></th><td class="n">{smart(v as number)}</td><td class="n">{num(ov.data!.latest[k].value)}</td><td>{ov.data!.latest[k].last_period ? periodLabel(ov.data!.latest[k].last_period!, ov.data!.period_type) : '–'}</td></tr>)}
                {Object.entries(values).filter(([, v]) => v === null).map(([k]) => <tr key={k} class="inc"><th scope="row">{names[k]}</th><td class="n" colSpan={3}>{t('map.noDataWindow')}</td></tr>)}
              </tbody>
            </table></div>
          )}
          <HowToRead>
            <p>{t(d.map_metric === 'percent_positive' ? 'overview.means.pct' : 'overview.means.rate', { window: windowText })} {t('overview.means.caveat')}</p>
            <p>{t('legend.scale.shared')}</p>
            {showEvents && points.length > 0 && <p>{t('overview.eventsOnMap')}</p>}
            <p>{t('map.attr.boundaries')} {t('map.attr.population')}{points.length ? ' ' + t('map.attr.gazetteer') : ''}</p>
          </HowToRead>
          {meta && meta.case_definition === 'mixed' && <div class="notice warn" role="note">{t('warn.mixedSeries')}</div>}
          <div class="btnrow">
            <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewMap') : t('action.viewData')}</button>
            <button type="button" class="btn small" disabled={table} onClick={() => exportMap('png')}>{t('action.png')}</button>
            <button type="button" class="btn small" disabled={table} onClick={() => exportMap('svg')}>{t('action.svg')}</button>
            {prov && <CiteButton prov={prov} title={title} subtitle={windowText} />}
            <button type="button" class="btn small" onClick={() => setEmbed(true)}>{t('action.embed')}</button>
            <a class="btn small" href={href(route, 'map', { d: disease })}>{t('overview.openMap')}</a>
            <a class="btn small" href={href(route, 'disease/' + disease)}>{t('overview.openDisease', { disease: diseaseName(core, disease) })}</a>
          </div>
          {embed && (
            <Dialog title={t('embed.title')} onClose={() => setEmbed(false)} modal>
              <p>{t('embed.intro')}</p>
              <pre data-testid="embed-snippet">{`<iframe src="${embedUrl}" title="${title}" width="100%" height="560" style="border:1px solid #d9e1e3;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`}</pre>
              <button type="button" class="btn" onClick={() => copyText(`<iframe src="${embedUrl}" title="${title}" width="100%" height="560" style="border:1px solid #d9e1e3;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`)}>{t('action.copy')}</button>
              <p class="small muted">{t('embed.privacy')}</p>
            </Dialog>
          )}
        </section>

        <div class="grid">
          <section class="card">
            <header><h2>{t('overview.active')}</h2></header>
            <p class="sub">{t('overview.activeSub')}</p>
            {events.loading && <Loading />}
            <ul class="list">{active.slice(0, analyst ? 8 : 5).map((e) => <EventRow key={e.event_id} e={e} showScore={analyst} />)}</ul>
            {!events.loading && !active.length && <p class="muted">{t('overview.noActive')}</p>}
            <p><a href={href(route, 'outbreaks')}>{t('overview.allOutbreaks', { n: events.data?.n_events ?? 0 })}</a></p>
          </section>
          <section class="card">
            <header><h2>{t('overview.flags')}</h2></header>
            <p class="sub">{t('flags.neutral')}</p>
            {analyst
              ? <FlagList flags={flags.data?.flags ?? []} limit={8} />
              : <details class="more"><summary>{t('flags.show', { n: new Set((flags.data?.flags ?? []).map((f) => f.series_id)).size })}</summary><FlagList flags={flags.data?.flags ?? []} limit={5} /></details>}
            <p class="small"><a href={href(route, 'changes')}>{t('nav.changes')}</a> · <a href={href(route, 'methodology')}>{t('flags.method')}</a></p>
          </section>
        </div>
      </div>

      <h2>{t('overview.trends')}</h2>
      <p class="muted small">{t('overview.trendsSub')}</p>
      {/* Simple mode keeps the page short: the trend cards open on request. */}
      <details class="more" open={analyst} data-testid="trends"><summary>{t('overview.trendsShow', { n: sparks.data?.length ?? 0 })}</summary>
      <div class="grid three">
        {(sparks.data ?? []).map((o) => {
          const cut = o.global.p.length - (o.period_type === 'Y' ? 30 : o.period_type === 'M' ? 60 : 104);
          const p = o.global.p.slice(Math.max(0, cut)); const v = o.global.v.slice(Math.max(0, cut));
          const comp = p.map((x, i) => [x, v[i]] as const).filter(([x]) => x < o.incomplete_from);
          const last = comp[comp.length - 1];
          const nAt = last ? o.global.n[o.global.p.indexOf(last[0])] : null;
          const m = core.seriesByKey[o.skey];
          return (
            <section class="card" key={o.disease}>
              <div class="row"><h3 style={{ margin: 0 }}><a href={href(route, 'disease/' + o.disease)}>{diseaseName(core, o.disease)}</a></h3><Sparkline p={p} v={v} incompleteFrom={o.incomplete_from} label={t('overview.sparkAria', { disease: diseaseName(core, o.disease) })} /></div>
              <p class="small muted">{m && `${measureLabel(m.metric, m.case_definition)}`} · {last ? `${periodLabel(last[0], o.period_type)}: ${num(last[1])}` : t('chart.noData')}{last && nAt !== null && o.global.n_total ? ` · ${t('total.nOfN', { n: nAt, N: o.global.n_total })}` : ''} {last && <AgeBadge period={last[0]} ptype={o.period_type} />}{m?.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}</p>
              <Breakdown g={o.global} ptype={o.period_type} />
              {(() => { const sp = { title: t('overview.sparkTitle', { disease: diseaseName(core, o.disease) }), origin: 'site-derived' as const, sourceIds: o.source_ids.filter((s) => s !== 'worldbank'), asOf: m?.retrieved_at?.slice(0, 10) ?? null, snapshotId: o.snapshot_id, series: [{ skey: o.skey }], method: { name: 'sum_reporting_countries', version: '1' } };
                return <div class="chipline"><SourceChip compact prov={sp} />{last && m && <> <CiteButton inline prov={sp} title={sp.title} url={href(route, 'disease/' + o.disease)}
                  statement={globalStatement(diseaseName(core, o.disease), periodLabel(last[0], o.period_type), num(last[1]), `${measureLabel(m.metric, m.case_definition)}`, nAt, o.global.n_total)} /></>}</div>; })()}
            </section>
          );
        })}
      </div>
      </details>
    </>
  );
}

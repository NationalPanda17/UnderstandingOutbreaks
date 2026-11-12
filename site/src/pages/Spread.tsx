/** Outbreak Spread Explorer: where and when official notices about one outbreak were published.
 *
 *  It is a map of reporting, not of transmission. Rules this page keeps:
 *   - no arrows or lines between places, and no inferred route: how a disease reached a place is shown only in the
 *     notice's own words;
 *   - dates are "first official notice", never "first case"; onset appears only where a notice states it;
 *   - each country's reporting completeness sits next to its date;
 *   - nothing here projects forward in time. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { href, setParams } from '../lib/app';
import { getJSON, getOptional, loadTs, type EventIdx } from '../lib/data';
import { CAVEAT, buildBundle, copyText, download, pinnedUrl, slugify, zip, type Row } from '../lib/exporters';
import { date, num, t } from '../lib/i18n';
import { placeName, toSeries, measureLabel } from '../lib/series';
import type { SeriesData } from '../lib/transforms';
import { Chart } from '../components/Chart';
import { ContextLinks } from '../components/ContextLinks';
import { eventPlaces, eventProv } from '../components/Events';
import { ErrorBox, Ext, Loading, diseaseName, useAsync } from '../components/Layout';
import { loadReporting, reportingText } from '../components/ReportingHealth';
import { SourceChip, useApp } from '../components/SourceChip';
import { FitMap } from '../components/StaticMap';

interface Report { report_id: string; source_id: string; title: string; url: string; published: string; fetch_id: string; countries: string[]; broad?: boolean; counts?: { cases?: { quote: string; case_definition: string }; deaths?: { quote: string } }; route_quotes?: string[]; onset_quotes?: string[] }
interface Loc { iso3: string; precision: string; lon: number | null; lat: number | null; name: string; report_id?: string; note?: string }

const SHOWN = '#8f7fc0'; const NEWEST = '#451c7e'; const ADJ = 'url(#fm-adj)';
const MANY = 12;

function Picker() {
  const { core, route } = useApp();
  const idx = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  if (idx.loading) return <Loading />;
  if (!idx.data) return <ErrorBox error={idx.error} />;
  const list = idx.data.events
    .filter((e) => e.countries.length > 1 || e.locations.some((l) => l.precision !== 'country'))
    .sort((a, b) => (a.last_report < b.last_report ? 1 : -1)).slice(0, 60);
  return (
    <>
      <h1>{t('spread.title')}</h1>
      <p class="lead">{t('spread.lead')}</p>
      <div class="notice">{t('spread.isReporting')}</div>
      <section class="card">
        <h2>{t('spread.pick')}</h2>
        <p class="sub">{t('spread.pickNote')}</p>
        <ul class="list">
          {list.map((e) => (
            <li key={e.event_id}>
              <a href={href(route, 'spread/' + e.event_id)}>{diseaseName(core, e.disease)} — {eventPlaces(core, e)}</a>
              <span class="small muted"> · {t('spread.noticesTo', { n: e.n_reports, date: date(e.last_report) })}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default function Spread({ parts }: { parts: string[] }) {
  const id = parts[0];
  if (!id) return <Picker />;
  return <Explorer key={id} id={id} />;
}

function Explorer({ id }: { id: string }) {
  const { core, route } = useApp();
  const ev = useAsync(() => getOptional<any>(`events/${id}.json`), [id]);
  const disease: string | undefined = ev.data?.disease;
  const rep = useAsync(() => (disease ? loadReporting(disease) : Promise.resolve(null)), [disease]);
  const [playing, setPlaying] = useState(false);
  const [adjacent, setAdjacent] = useState(true);
  const [zoom, setZoom] = useState('');
  const [sameScale, setSameScale] = useState(true);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const model = useMemo(() => {
    const e = ev.data; if (!e) return null;
    const reports = (e.reports as Report[]).slice().sort((a, b) => (a.published < b.published ? -1 : a.published > b.published ? 1 : 0));
    const byId: Record<string, Report> = {}; for (const r of reports) byId[r.report_id] = r;
    const first: Record<string, Report> = {};
    for (const r of reports) if (!r.broad) for (const c of r.countries) if (!first[c]) first[c] = r;
    // A place the site located from a notice that lists no country field still has a notice behind it.
    for (const l of e.locations as Loc[]) if (l.report_id && byId[l.report_id] && (!first[l.iso3] || byId[l.report_id].published < first[l.iso3].published)) first[l.iso3] = byId[l.report_id];
    const dates = Array.from(new Set(reports.map((r) => r.published)));
    const order = Object.keys(first).sort((a, b) => (first[a].published < first[b].published ? -1 : first[a].published > first[b].published ? 1 : placeName(core, a).localeCompare(placeName(core, b))));
    const regions = (e.locations as Loc[]).filter((l) => l.precision !== 'country' && l.lon !== null && l.lat !== null);
    return { reports, byId, first, dates, order, regions };
  }, [ev.data]);

  const at = route.params.get('at');
  const idx = model ? Math.max(0, at && model.dates.includes(at) ? model.dates.indexOf(at) : model.dates.length - 1) : 0;
  const setIdx = (i: number) => { if (model) setParams({ at: i >= model.dates.length - 1 ? null : model.dates[i] }); };
  useEffect(() => {
    if (!playing || !model) return;
    if (idx >= model.dates.length - 1) { setPlaying(false); return; }
    const h = setTimeout(() => setIdx(idx + 1), 1100);
    return () => clearTimeout(h);
  }, [playing, idx, model]);

  const linked: { disease: string; iso3: string }[] = ev.data?.linked_series ?? [];
  const chartPlaces = useMemo(() => (model ? model.order.filter((c) => linked.some((l) => l.iso3 === c)).slice(0, 6) : []), [model, ev.data]);
  const tsData = useAsync(async () => {
    if (!disease || !chartPlaces.length) return [] as SeriesData[];
    const skey = core.diseaseById[disease]?.default_skey; if (!skey) return [];
    const all = await Promise.all(chartPlaces.map((c) => loadTs(core, disease, c, route.snapshot).then((ts) => toSeries(core, ts, skey, placeName(core, c))).catch(() => null)));
    return all.filter(Boolean) as SeriesData[];
  }, [disease, chartPlaces.join(','), route.snapshot]);

  if (ev.loading) return <Loading />;
  if (!ev.data || !model) return <ErrorBox error={t('outbreak.unknown', { id })} />;
  const e = ev.data;
  const { reports, first, dates, order, regions, byId } = model;
  const now = dates[idx];
  const last = reports[reports.length - 1];
  const brief: EventIdx = { ...e, n_reports: reports.length, latest_url: last.url, latest_title: last.title };
  const prov = eventProv(core, brief, route.snapshot);
  const title = `${diseaseName(core, e.disease)} — ${eventPlaces(core, brief)}`;

  const shown = order.filter((c) => first[c].published <= now);
  const everNamed = new Set(order);
  const adj = new Set<string>();
  if (adjacent) for (const c of shown) for (const n of core.places[c]?.neighbours ?? []) if (!shown.includes(n)) adj.add(n);
  const fills: Record<string, string> = {}; const notes: Record<string, string> = {}; const names: Record<string, string> = {};
  for (const c of Object.keys(core.places)) names[c] = placeName(core, c);
  for (const n of adj) { fills[n] = ADJ; notes[n] = t('spread.adjacentNote'); }
  for (const c of shown) { fills[c] = first[c].published === now ? NEWEST : SHOWN; notes[c] = t('spread.firstNoticeOn', { date: date(first[c].published) }); }
  const centroids: Record<string, [number, number] | null> = {}; for (const [k, p] of Object.entries(core.places)) centroids[k] = p.centroid;
  const zoomable = Array.from(new Set(regions.map((l) => l.iso3)));
  const focus = zoom && zoomable.includes(zoom) ? [zoom] : order.length ? order : (e.countries as string[]);
  const labels = shown.length <= MANY && !zoom ? shown.map((c) => ({ iso3: c, text: date(first[c].published) })) : [];
  const rings = regions.filter((l) => !l.report_id || !byId[l.report_id] || byId[l.report_id].published <= now)
    .map((l, i) => ({ id: l.name + i, lon: l.lon as number, lat: l.lat as number, solid: l.precision === 'point', label: `${l.name}, ${placeName(core, l.iso3)} · ${t('precision.' + l.precision)}${l.note ? ' · ' + l.note : ''}` }));
  // The count shown is the latest one a notice had stated by this date, in the notice's own words.
  const stated = reports.filter((r) => r.published <= now && r.counts?.cases && !e.counts_suppressed).pop();
  const reporting = (c: string) => (rep.data ? reportingText(rep.data, c) : null);

  // Sequence: one entry per notice that was the first to name at least one country.
  const groups: { r: Report; countries: string[] }[] = [];
  for (const c of order) { const g = groups.find((x) => x.r.report_id === first[c].report_id); if (g) g.countries.push(c); else groups.push({ r: first[c], countries: [c] }); }
  // A country can be mentioned in the text of an earlier notice that does not list it as a country. Show that sentence
  // as a quote beside the country; the map keeps the date of the notice that lists it.
  const earlier: Record<string, { r: Report; q: string }> = {};
  for (const c of order) {
    const nm = core.places[c]?.name; if (!nm) continue;
    for (const r of reports) {
      if (r.published >= first[c].published) break;
      const q = [...(r.route_quotes ?? []), ...(r.onset_quotes ?? [])].find((x) => x.includes(nm));
      if (q) { earlier[c] = { r, q }; break; }
    }
  }
  const unplaced = reports.filter((r) => !r.countries.length && ((r.route_quotes?.length ?? 0) > 0 || (r.onset_quotes?.length ?? 0) > 0));

  const retrieved = (r: Report) => core.fetches[r.fetch_id]?.retrieved_at ?? '';
  const caveats = [t('spread.caveatReporting'), t('spread.caveatFirst'), t('spread.caveatNamed'), CAVEAT];
  const rows: Row[] = order.map((c) => {
    const r = first[c];
    return {
      iso3: c, place: placeName(core, c), first_official_notice_date: r.published, notice_title: r.title, source_id: r.source_id, source_url: r.url, retrieved_at: retrieved(r),
      countries_named_in_that_notice: r.countries.length, cases_quote: r.countries.length === 1 ? r.counts?.cases?.quote ?? '' : '',
      route_wording_quoted: (r.route_quotes ?? []).join(' | '), onset_wording_quoted: (r.onset_quotes ?? []).join(' | '),
      earlier_mention_date: earlier[c]?.r.published ?? '', earlier_mention_quoted: earlier[c]?.q ?? '', earlier_mention_url: earlier[c]?.r.url ?? '',
      reporting_on_this_site: reporting(c) ?? '', adjacent_countries_without_a_notice: (core.places[c]?.neighbours ?? []).filter((n) => !everNamed.has(n)).join(' '),
      origin_type: 'site-derived', caveat: caveats.join(' '),
    };
  });
  const DICT: Record<string, string> = {
    iso3: 'ISO 3166-1 alpha-3 code of the country.', place: 'Country name.',
    first_official_notice_date: 'Publication date of the earliest official notice in this event that names the country. It is not the date of the first case.',
    notice_title: 'Title of that notice, as published by the source.', source_id: 'Source registry id of the publisher of that notice.', source_url: 'Address of the notice.', retrieved_at: 'When this site retrieved the notice listing (UTC).',
    countries_named_in_that_notice: 'How many countries the notice names. A notice naming many countries says little about any one of them.',
    cases_quote: 'Case count as worded in the notice, given only when the notice names a single country. Extracted automatically; read the notice.',
    route_wording_quoted: 'Sentences from the notice about importation, travel or evacuation, quoted verbatim. This site infers no route.',
    onset_wording_quoted: 'Sentences from the notice that state symptom onset, quoted verbatim.',
    earlier_mention_date: 'Date of an earlier notice whose quoted text mentions the country without listing it as a country of the notice.', earlier_mention_quoted: 'That sentence, verbatim.', earlier_mention_url: 'Address of that earlier notice.',
    reporting_on_this_site: 'How regularly and completely this country appears in the routine series this site holds for the disease. Empty when there is no such series.',
    adjacent_countries_without_a_notice: 'Countries sharing a land border that no notice in this event names. Adjacent only: it says nothing about spread.',
    origin_type: 'site-derived: the grouping of notices into one event and this ordering are made by this site.', caveat: 'Limits that apply to every row.',
  };
  const base = slugify('spread ' + id);
  const exportCsv = () => download(`${base}.zip`, zip(buildBundle(core, prov, rows, 'csv', base, DICT)), 'application/zip');
  const exportGeo = () => {
    const feats: any[] = [];
    for (const c of order) {
      const p = core.places[c]; if (!p?.centroid) continue; const r = first[c];
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.centroid }, properties: { kind: 'country', iso3: c, name: placeName(core, c), precision: 'country', position_note: 'Middle of the country, not a case location.', first_official_notice_date: r.published, notice_title: r.title, source_id: r.source_id, source_url: r.url, retrieved_at: retrieved(r), route_wording_quoted: r.route_quotes ?? [], onset_wording_quoted: r.onset_quotes ?? [], reporting_on_this_site: reporting(c) } });
    }
    for (const l of regions) {
      const r = l.report_id ? byId[l.report_id] : undefined;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lon, l.lat] }, properties: { kind: l.precision === 'point' ? 'place named in a notice' : 'first-level region', iso3: l.iso3, name: l.name, precision: l.precision, position_note: l.note ?? null, notice_date: r?.published ?? null, notice_title: r?.title ?? null, source_id: r?.source_id ?? null, source_url: r?.url ?? null, retrieved_at: r ? retrieved(r) : null } });
    }
    const meta = { title, event_id: id, origin_type: 'site-derived', what_this_is: 'Where and when official notices about this event were published. A map of reporting, not of transmission. No route between places is stated or implied.', sources: prov.sourceIds.map((s) => ({ id: s, name: core.sources[s]?.name ?? s, license: core.sources[s]?.license ?? null })), snapshot_id: prov.snapshotId, last_notice: e.last_report, caveats, link: pinnedUrl(prov.snapshotId) };
    download(`${base}.geojson`, JSON.stringify({ type: 'FeatureCollection', metadata: meta, features: feats }, null, 2), 'application/geo+json');
  };
  const copyLink = async () => { if (await copyText(pinnedUrl(prov.snapshotId))) { setCopied(true); setTimeout(() => setCopied(false), 1800); } };

  // Shared axes for the small charts: a common window around the event, and optionally a common height.
  const series = tsData.data ?? [];
  const annual = series.some((s) => s.ptype === 'Y');
  const startYear = Number(e.first_report.slice(0, 4)) - (annual ? 6 : 1);
  const x0 = `${startYear}-${annual ? '01-01' : e.first_report.slice(5)}`;
  const cut = series.map((s) => { const k = s.p.findIndex((p) => p >= x0); return k < 0 ? { ...s, p: [], v: [] } : { ...s, p: s.p.slice(k), v: s.v.slice(k) }; });
  const x1 = cut.reduce((m, s) => (s.p.length && s.p[s.p.length - 1] > m ? s.p[s.p.length - 1] : m), e.last_report as string);
  const y1 = Math.max(0, ...cut.flatMap((s) => s.v.filter((v): v is number => v !== null)));
  const meta = disease ? core.seriesByKey[core.diseaseById[disease]?.default_skey ?? ''] : undefined;

  return (
    <>
      <p class="small"><a href={href(route, 'outbreak/' + id)}>← {t('spread.backToOutbreak')}</a> · <a href={href(route, 'spread')}>{t('spread.other')}</a></p>
      <h1>{t('spread.title')}: {title}</h1>
      <p><span class="badge ev">{t('badge.event')}</span> <SourceChip prov={prov} /></p>
      <div class="notice" data-testid="spread-guard"><b>{t('spread.isReportingShort')}</b> {t('spread.isReporting')}</div>

      <section class="card">
        <h2>{t('spread.mapTitle')}</h2>
        <p class="sub">{t('spread.mapSub', { date: date(now, 'long') })}</p>
        <div class="row" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <button type="button" class="btn small" onClick={() => { if (!playing && idx >= dates.length - 1) setIdx(0); setPlaying(!playing); }} disabled={dates.length < 2}>{playing ? t('spread.pause') : t('spread.play')}</button>
          <button type="button" class="btn small" onClick={() => { setPlaying(false); setIdx(Math.max(0, idx - 1)); }} disabled={idx === 0} aria-label={t('spread.prev')}>‹</button>
          <input type="range" min={0} max={dates.length - 1} step={1} value={idx} disabled={dates.length < 2} style={{ flex: '1 1 220px' }}
            aria-label={t('spread.slider')} aria-valuetext={date(now, 'long')} onInput={(x) => { setPlaying(false); setIdx(Number((x.target as HTMLInputElement).value)); }} />
          <button type="button" class="btn small" onClick={() => { setPlaying(false); setIdx(Math.min(dates.length - 1, idx + 1)); }} disabled={idx >= dates.length - 1} aria-label={t('spread.next')}>›</button>
          <b aria-live="polite">{date(now, 'long')}</b>
        </div>
        <div class="row small" style={{ flexWrap: 'wrap', gap: '14px', margin: '8px 0' }}>
          <label><input type="checkbox" checked={adjacent} onChange={(x) => setAdjacent((x.target as HTMLInputElement).checked)} /> {t('spread.showAdjacent')}</label>
          {zoomable.length > 0 && (
            <label>{t('spread.zoom')}{' '}
              <select value={zoom} onChange={(x) => setZoom((x.target as HTMLSelectElement).value)}>
                <option value="">{t('spread.zoomAll')}</option>
                {zoomable.map((c) => <option key={c} value={c}>{placeName(core, c)}</option>)}
              </select>
            </label>
          )}
        </div>
        <FitMap focus={focus} fills={fills} labels={labels} rings={rings} names={names} notes={notes} centroids={centroids} title={t('spread.mapAria', { title, date: date(now, 'long'), n: shown.length })} svgRef={svgRef} />
        <ul class="legend small" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', listStyle: 'none', padding: 0, margin: '8px 0' }}>
          <li><span class="sw" style={{ display: 'inline-block', width: '14px', height: '14px', background: NEWEST, verticalAlign: '-2px', borderRadius: '3px' }} /> {t('spread.legendNew')}</li>
          <li><span class="sw" style={{ display: 'inline-block', width: '14px', height: '14px', background: SHOWN, verticalAlign: '-2px', borderRadius: '3px' }} /> {t('spread.legendEarlier')}</li>
          {adjacent && <li><span class="sw" style={{ display: 'inline-block', width: '14px', height: '14px', background: 'repeating-linear-gradient(135deg,#fafafa 0 3px,#9aa7aa 3px 5px)', border: '1px solid #9aa7aa', verticalAlign: '-2px', borderRadius: '3px' }} /> {t('spread.legendAdjacent')}</li>}
          {regions.some((l) => l.precision === 'admin1') && <li>◌ {t('spread.legendRegion')}</li>}
          {regions.some((l) => l.precision === 'point') && <li>● {t('spread.legendPoint')}</li>}
        </ul>
        <p class="small" data-testid="spread-count">
          {e.counts_suppressed ? t('spread.countSuppressed')
            : stated ? <>{t('spread.statedBy', { date: date(stated.published) })} <q class="quote">{stated.counts!.cases!.quote}</q> <span class="muted">({t('def.' + stated.counts!.cases!.case_definition)} · {t('event.auto')} · <Ext url={stated.url}>{t('event.originalNotice')}</Ext>)</span></>
              : t('spread.noCountYet')}
        </p>
        <p class="small muted">{t('spread.mapNote')}</p>
        {adjacent && adj.size > 0 && <p class="small"><b>{t('spread.adjacentList')}</b> {Array.from(adj).map((c) => placeName(core, c)).sort().join(', ')}. <span class="muted">{t('spread.adjacentNote')}</span></p>}
        <div class="row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <button type="button" class="btn small" onClick={exportGeo}>{t('spread.geojson')}</button>
          <button type="button" class="btn small" onClick={exportCsv}>{t('action.downloadCsv')}</button>
          <button type="button" class="btn small" onClick={copyLink}>{copied ? t('action.copied') : t('spread.pinned')}</button>
        </div>
        <p class="small muted">{t('spread.exportNote')}</p>
      </section>

      <section class="card" data-testid="spread-sequence">
        <h2>{t('spread.seqTitle')}</h2>
        <p class="sub">{t('spread.seqSub')}</p>
        {!rep.loading && !rep.data && <p class="small muted">{t('spread.noSeries')}</p>}
        <ol class="list">
          {groups.map((g) => {
            const pending = g.r.published > now;
            const head = g.countries.slice(0, 8); const rest = g.countries.slice(8);
            const line = (c: string) => (
              <li key={c}><a href={href(route, 'place/' + c, disease && core.diseaseById[disease]?.has_timeseries ? { d: disease } : {})}>{placeName(core, c)}</a>
                {g.countries.length <= 8 && <span class="small muted"> · {reporting(c) ?? (rep.data ? t('spread.notInSeries') : t('spread.completenessUnknown'))}</span>}
                {earlier[c] && <div class="small">{t('spread.earlierMention', { date: date(earlier[c].r.published) })} <q class="quote">{earlier[c].q}</q> <Ext url={earlier[c].r.url}>{t('event.originalNotice')}</Ext></div>}</li>
            );
            return (
              <li key={g.r.report_id} style={pending ? { opacity: 0.45 } : undefined}>
                <div class="row"><b>{date(g.r.published, 'long')}</b><span class="badge">{core.sources[g.r.source_id]?.short_name}</span><span class="small muted">{t('spread.firstNotice')}</span></div>
                <div><Ext url={g.r.url}>{g.r.title}</Ext> <span class="small muted">({t('outbreak.sourceTitle')})</span></div>
                {g.r.countries.length > 5 && <p class="small muted">{t('spread.broadNotice', { n: g.r.countries.length })}</p>}
                <ul class="list small">{head.map(line)}</ul>
                {rest.length > 0 && <details class="small"><summary>{t('spread.moreCountries', { n: rest.length })}</summary><p>{rest.map((c) => placeName(core, c)).join(', ')}</p></details>}
                {(g.r.route_quotes?.length ?? 0) > 0
                  ? <div class="small">{t('spread.routeSays')} {g.r.route_quotes!.slice(0, 3).map((q, i) => <q key={i} class="quote" style={{ display: 'block', margin: '3px 0' }}>{q}</q>)}</div>
                  : <div class="small muted">{t('spread.noRoute')}</div>}
                {(g.r.onset_quotes?.length ?? 0) > 0 && <div class="small">{t('spread.onsetSays')} {g.r.onset_quotes!.slice(0, 2).map((q, i) => <q key={i} class="quote" style={{ display: 'block', margin: '3px 0' }}>{q}</q>)}</div>}
                {g.r.countries.length === 1 && g.r.counts?.cases && !e.counts_suppressed && <div class="small muted">{t('outbreak.stated')} <q class="quote">{g.r.counts.cases.quote}</q></div>}
              </li>
            );
          })}
        </ol>
        {unplaced.length > 0 && (
          <details class="small">
            <summary>{t('spread.unplaced', { n: unplaced.length })}</summary>
            <ul class="list">{unplaced.map((r) => (
              <li key={r.report_id}><b>{date(r.published)}</b> · <Ext url={r.url}>{r.title}</Ext>
                {[...(r.route_quotes ?? []).slice(0, 2), ...(r.onset_quotes ?? []).slice(0, 1)].map((q, i) => <q key={i} class="quote" style={{ display: 'block', margin: '3px 0' }}>{q}</q>)}</li>
            ))}</ul>
          </details>
        )}
        <p class="small muted">{t('spread.tagNote')} {t('spread.seqNote')}</p>
      </section>

      <section class="card" data-testid="spread-series">
        <h2>{t('spread.seriesTitle')}</h2>
        {tsData.loading ? <Loading /> : !cut.some((s) => s.p.length) ? <p class="muted">{t('spread.noLinked')}</p> : (
          <>
            <p class="sub">{t('spread.seriesSub')}{meta ? ` ${measureLabel(meta.metric, meta.case_definition)}, ${core.sources[meta.source_id]?.short_name ?? meta.source_id}.` : ''}</p>
            <label class="small"><input type="checkbox" checked={sameScale} onChange={(x) => setSameScale((x.target as HTMLInputElement).checked)} /> {t('spread.sameScale')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', marginTop: '8px' }}>
              {cut.filter((s) => s.p.length).map((s) => (
                <figure key={s.id} style={{ margin: 0 }}>
                  <figcaption class="small"><b>{s.label}</b> <span class="muted">· {t('spread.firstNoticeOn', { date: date(first[s.iso3!]?.published) })} · {reporting(s.iso3!) ?? t('spread.completenessUnknown')}</span></figcaption>
                  <Chart series={[s]} compact height={190} ariaLabel={`${s.label}: ${t('spread.seriesTitle')}`} domain={{ x0, x1, y1: sameScale ? y1 : undefined }}
                    marks={first[s.iso3!] && first[s.iso3!].published >= x0 ? [{ x: first[s.iso3!].published, label: t('spread.mark') }] : undefined} />
                </figure>
              ))}
            </div>
            <p class="small muted">{t('spread.seriesNote')}</p>
          </>
        )}
      </section>

      <section class="card">
        <h2>{t('spread.limitsTitle')}</h2>
        <ul class="list small">
          <li>{t('spread.caveatReporting')}</li>
          <li>{t('spread.caveatFirst')}</li>
          <li>{t('spread.caveatNamed')}</li>
          <li>{t('spread.caveatNoForecast')}</li>
          <li>{t('spread.caveatData')}</li>
        </ul>
      </section>
      <ContextLinks disease={e.disease} />
      <p class="small muted">{t('spread.totals', { n: num(order.length), r: num(reports.length) })}</p>
    </>
  );
}

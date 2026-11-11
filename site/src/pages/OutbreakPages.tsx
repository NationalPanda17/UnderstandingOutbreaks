/** Outbreak list (all event sources, transparent ranking) and auto-generated outbreak detail pages. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { href, navigate, setParams } from '../lib/app';
import { getJSON, getOptional, type EventIdx } from '../lib/data';
import { exportBundle } from '../lib/exporters';
import { date, num, t } from '../lib/i18n';
import { placeName } from '../lib/series';
import { ContextLinks } from '../components/ContextLinks';
import { EventRow, EventSummary, StatusBadge, eventPlaces, eventProv } from '../components/Events';
import { ErrorBox, Ext, Loading, diseaseName, useAsync } from '../components/Layout';
import { LazyMap } from '../components/LazyMap';
import { SourceChip, useApp } from '../components/SourceChip';
import { WatchButton } from './Watchlists';

export function Outbreaks() {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const idx = useAsync(() => getJSON<{ events: EventIdx[]; methods: any }>('events/index.json'), []);
  const fd = route.params.get('d') ?? ''; const fc = route.params.get('c') ?? ''; const fs = route.params.get('status') ?? ''; const fsrc = route.params.get('src') ?? '';
  const sort = route.params.get('sort') ?? 'rank';
  const only = route.params.get('all') !== '1';
  const events = useMemo(() => {
    let e = idx.data?.events ?? [];
    if (fd) e = e.filter((x) => x.disease === fd);
    if (fc) e = e.filter((x) => x.countries.includes(fc));
    if (fs) e = e.filter((x) => x.status === fs);
    if (fsrc) e = e.filter((x) => x.source_ids.includes(fsrc));
    if (only && !fs) e = e.filter((x) => x.rank.active);
    return e.slice().sort((a, b) => (sort === 'recent' ? (a.last_report < b.last_report ? 1 : -1) : b.rank.score - a.rank.score));
  }, [idx.data, fd, fc, fs, fsrc, sort, only]);
  if (idx.error) return <ErrorBox error={idx.error} />;
  const all = idx.data?.events ?? [];
  const diseases = Array.from(new Set(all.map((e) => e.disease))).sort();
  const countries = Array.from(new Set(all.flatMap((e) => e.countries))).sort((a, b) => placeName(core, a).localeCompare(placeName(core, b)));
  const prov = { title: t('outbreaks.title'), origin: 'site-derived' as const, sourceIds: Array.from(new Set(events.flatMap((e) => e.source_ids))), asOf: all.map((e) => e.last_report).sort().pop() ?? null, snapshotId: route.snapshot ?? core.manifest.snapshot_id, method: { name: 'active_rank', version: '1', params: idx.data?.methods?.ranking?.weights } };
  return (
    <>
      <h1>{t('outbreaks.title')}</h1>
      <p class="small"><a href={href(route, 'spread')}>{t('spread.title')}</a>: {t('spread.isReportingShort')}</p>
      <p class="lead">{t('outbreaks.lead')}</p>
      <div class="tools" role="group" aria-label={t('overview.filters')}>
        <label>{t('filter.disease')} <select value={fd} onChange={(e) => setParams({ d: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{diseases.map((d) => <option key={d} value={d}>{diseaseName(core, d)}</option>)}</select></label>
        <label>{t('filter.place')} <select value={fc} onChange={(e) => setParams({ c: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{countries.map((c) => <option key={c} value={c}>{placeName(core, c)}</option>)}</select></label>
        <label>{t('filter.sort')} <select value={sort} onChange={(e) => setParams({ sort: (e.target as HTMLSelectElement).value })}><option value="rank">{t('sort.rank')}</option><option value="recent">{t('sort.recent')}</option></select></label>
        <label><input type="checkbox" checked={!only} onChange={(e) => setParams({ all: (e.target as HTMLInputElement).checked ? '1' : null })} /> {t('outbreaks.includeOld')}</label>
        {analyst && <>
          <label>{t('filter.status')} <select value={fs} onChange={(e) => setParams({ status: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{['reported', 'ongoing', 'declared_over', 'no_recent_update'].map((s) => <option key={s} value={s}>{t('status.' + s)}</option>)}</select></label>
          <label>{t('filter.source')} <select value={fsrc} onChange={(e) => setParams({ src: (e.target as HTMLSelectElement).value || null })}><option value="">{t('filter.any')}</option>{Array.from(new Set(all.flatMap((e) => e.source_ids))).map((s) => <option key={s} value={s}>{core.sources[s]?.short_name}</option>)}</select></label>
        </>}
      </div>
      <section class="card">
        <header><h2>{t('outbreaks.count', { n: events.length })}</h2><SourceChip prov={prov} /></header>
        <p class="sub">{t('outbreaks.rankNote')} <a href={href(route, 'methodology')}>{t('nav.methodology')}</a></p>
        {analyst && idx.data && <p class="small muted">{t('rank.formula')} <code>{JSON.stringify(idx.data.methods.ranking.weights)}</code></p>}
        {idx.loading && <Loading />}
        <ul class="list">{events.slice(0, 150).map((e) => <EventRow key={e.event_id} e={e} showScore={analyst} />)}</ul>
        {analyst && (
          <div class="btnrow"><button type="button" class="btn small" onClick={() => exportBundle(core, prov, events.flatMap((e) => (e.locations.length ? e.locations : [{ iso3: '', precision: '', lon: null, lat: null, name: '' }]).map((l) => ({ event_id: e.event_id, disease: e.disease, countries: e.countries.join(';'), first_report: e.first_report, last_report: e.last_report, status: e.status, status_basis: e.status_basis, cases: e.cases?.value ?? null, cases_definition: e.cases?.case_definition ?? '', deaths: e.deaths?.value ?? null, n_reports: e.n_reports, location_name: l.name, location_precision: l.precision, lon: l.lon, lat: l.lat, location_method: 'gazetteer_match v1', rank_score: e.rank.score, source_id: e.source_ids.join(';'), source_url: e.latest_url, origin_type: 'site-derived', snapshot_id: prov.snapshotId }))), 'csv', 'outbreak-events')}>{t('action.downloadCsv')}</button></div>
        )}
      </section>
    </>
  );
}

/** One dot per official notice on a time axis. Height is the case count the notice states (read automatically);
 *  a hollow dot on the baseline means no count was read. An out-of-line dot usually exposes a misread figure. */
function NoticeDots({ reports, sources }: { reports: any[]; sources: Record<string, { short_name: string }> }) {
  const [tip, setTip] = useState<number | null>(null);
  if (reports.length < 2) return null;
  const W = 720, H = 190, L = 46, R = 14, T = 16, B = 34;
  const t0 = Date.parse(reports[0].published), t1 = Date.parse(reports[reports.length - 1].published);
  const span = Math.max(1, t1 - t0);
  const vals = reports.map((r) => (r.counts?.cases?.value as number | undefined) ?? null);
  const max = Math.max(1, ...vals.filter((v): v is number => v !== null));
  const x = (r: any) => L + ((Date.parse(r.published) - t0) / span) * (W - L - R);
  const y = (v: number | null) => (v === null ? H - B : H - B - (v / max) * (H - B - T));
  const cur = tip !== null ? reports[tip] : null;
  return (
    <div class="noticedots" data-testid="notice-dots">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={t('timeline.aria')}>
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="#8fa1a5" />
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="#d9e1e3" />
        <text x={L - 6} y={T + 4} text-anchor="end" font-size="11" fill="#4a5b5f">{num(max)}</text>
        <text x={L - 6} y={H - B + 4} text-anchor="end" font-size="11" fill="#4a5b5f">0</text>
        <text x={L} y={H - 8} font-size="11" fill="#4a5b5f">{date(reports[0].published)}</text>
        <text x={W - R} y={H - 8} text-anchor="end" font-size="11" fill="#4a5b5f">{date(reports[reports.length - 1].published)}</text>
        {reports.map((r, i) => (
          <g key={r.report_id} tabIndex={0} role="img" aria-label={`${date(r.published, 'long')}: ${r.title}. ${vals[i] !== null ? t('timeline.stated', { n: num(vals[i]) }) + ' “' + r.counts.cases.quote + '”' : t('timeline.noCount')}`}
            onFocus={() => setTip(i)} onBlur={() => setTip(null)} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} style={{ outline: 'none' }}>
            <circle cx={x(r)} cy={y(vals[i])} r={tip === i ? 7 : 5} fill={vals[i] === null ? '#fff' : '#0b6e75'} stroke={tip === i ? '#17272b' : '#0b6e75'} stroke-width={tip === i ? 2.5 : 1.5} />
          </g>
        ))}
      </svg>
      <p class="small" aria-live="polite" style={{ minHeight: '3.2em' }}>
        {cur ? <><b>{date(cur.published, 'long')}</b> · {sources[cur.source_id]?.short_name} · {cur.title}. {cur.counts?.cases ? <>{t('timeline.stated', { n: num(cur.counts.cases.value) })} <q class="quote">{cur.counts.cases.quote}</q></> : t('timeline.noCount')}</> : <span class="muted">{t('timeline.hint')}</span>}
      </p>
      <p class="small muted">{t('timeline.means')}</p>
    </div>
  );
}

export function Outbreak({ id }: { id: string }) {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const ev = useAsync(() => getOptional<any>(`events/${id}.json`), [id]);
  const idx = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  // An id retired by a merge (two events found to be one outbreak) forwards to the event that replaced it.
  const replacement = !ev.loading && !ev.data ? idx.data?.events.find((x) => x.supersedes?.includes(id))?.event_id : undefined;
  useEffect(() => { if (replacement) navigate(href(route, 'outbreak/' + replacement)); }, [replacement]);
  if (ev.loading || (!ev.data && (idx.loading || replacement))) return <Loading />;
  if (!ev.data) return <ErrorBox error={t('outbreak.unknown', { id })} />;
  const e = ev.data;
  const brief = idx.data?.events.find((x) => x.event_id === id) ?? (e as EventIdx & { n_reports: number });
  const briefE: EventIdx = { ...(brief as any), n_reports: e.reports.length, latest_url: e.reports[e.reports.length - 1].url, latest_title: e.reports[e.reports.length - 1].title };
  const prov = eventProv(core, briefE, route.snapshot);
  const names: Record<string, string> = {}; for (const s of Object.values(core.sources)) names['src:' + s.id] = s.short_name;
  const points = (e.locations as any[]).filter((l) => l.lon !== null).map((l, i) => ({ id: String(i), lon: l.lon, lat: l.lat, label: l.name, precision: l.precision, sources: l.source_ids ?? ['geonames'], radius: l.precision === 'country' ? 11 : l.precision === 'admin1' ? 8 : 6, color: l.precision === 'country' ? '#b89c4a' : l.precision === 'admin1' ? '#7a5c00' : '#3b2e00', sub: l.note }));
  const title = `${diseaseName(core, e.disease)} — ${eventPlaces(core, briefE)}`;
  return (
    <>
      <div class="row"><h1>{title}</h1><WatchButton item={{ kind: 'event', event: id }} /></div>
      <p><StatusBadge e={briefE} /> <span class="badge ev">{t('badge.event')}</span> <SourceChip prov={prov} /></p>
      <div class="grid side">
        <div class="grid">
          <section class="card">
            <h2>{t('outbreak.summary')}</h2>
            <EventSummary e={briefE} core={core} />
            <div class="readouts">
              <div>{t('outbreak.status')}<b>{t('status.' + e.status)}</b><span class="small">{t('statusbasis.' + e.status_basis)}</span></div>
              <div>{t('outbreak.cases')}<b>{e.cases ? num(e.cases.value) : '–'}</b><span class="small">{e.cases ? `${t('def.' + e.cases.case_definition)} · ${t('chip.asOf', { date: date(e.cases.as_of) })} · ${t('event.auto')}` : t('outbreak.notStated')}</span></div>
              <div>{t('outbreak.deaths')}<b>{e.deaths ? num(e.deaths.value) : '–'}</b><span class="small">{e.deaths ? t('chip.asOf', { date: date(e.deaths.as_of) }) : t('outbreak.notStated')}</span></div>
              <div>{t('outbreak.lastReport')}<b>{date(e.last_report)}</b><span class="small">{t('outbreak.daysAgo', { n: e.days_since_last_report })}</span></div>
            </div>
            {e.status_quote && <p class="small">{t('outbreak.statusQuote')} <q class="quote">{e.status_quote}</q></p>}
            <p class="small muted">{t('outbreak.countsNote')}</p>
          </section>
          <section class="card">
            <h2>{t('outbreak.timeline')}</h2>
            <NoticeDots reports={e.reports as any[]} sources={core.sources} />
            <ol class="list">
              {(e.reports as any[]).slice().reverse().map((r) => (
                <li key={r.report_id}>
                  <div class="row"><b>{date(r.published, 'long')}</b><span class="badge">{core.sources[r.source_id]?.short_name}</span></div>
                  <div><Ext url={r.url}>{r.title}</Ext> <span class="small muted">({t('outbreak.sourceTitle')})</span></div>
                  {(r.counts?.cases || r.counts?.deaths) && <div class="small muted">{t('outbreak.stated')} {r.counts.cases && <q class="quote">{r.counts.cases.quote}</q>} {r.counts.deaths && <q class="quote">{r.counts.deaths.quote}</q>}</div>}
                  {analyst && <div class="small muted"><code>{r.report_id}</code> · <code>{r.raw_record_ref}</code> · {t('outbreak.modified')} {r.last_modified}</div>}
                </li>
              ))}
            </ol>
          </section>
          {(e.history?.length > 1 || analyst) && (
            <section class="card">
              <h2>{t('outbreak.revisions')}</h2>
              <p class="sub">{t('pin.vintage')}</p>
              <div class="tablewrap"><table class="data"><thead><tr><th>{t('trace.snapshot')}</th><th>{t('outbreak.status')}</th><th class="n">{t('outbreak.cases')}</th><th class="n">{t('outbreak.deaths')}</th><th class="n">{t('outbreak.reports')}</th></tr></thead>
                <tbody>{(e.history as any[]).slice().reverse().map((h) => <tr key={h.snapshot_id}><th scope="row"><code>{h.snapshot_id}</code></th><td>{t('status.' + h.status)}</td><td class="n">{num(h.cases)}</td><td class="n">{num(h.deaths)}</td><td class="n">{h.n_reports}</td></tr>)}</tbody></table></div>
            </section>
          )}
        </div>
        <div class="grid">
          <section class="card">
            <h2>{t('outbreak.locations')}</h2>
            {points.length ? <LazyMap points={points} pointMode="markers" names={names} ariaLabel={t('map.aria', { title })} view={{ lng: points[0].lon, lat: points[0].lat, z: 2.4 }} /> : <p class="muted">{t('outbreak.noLocation')}</p>}
            <p class="small muted">{t('outbreak.precisionNote')}</p>
            <p><a class="btn small" href={href(route, 'spread/' + id)} data-testid="open-spread">{t('spread.open')}</a></p>
            <div class="tablewrap"><table class="data"><thead><tr><th>{t('table.place')}</th><th>{t('map.precision')}</th>{analyst && <th>{t('trace.method')}</th>}</tr></thead>
              <tbody>{(e.locations as any[]).map((l, i) => <tr key={i}><th scope="row">{l.name}{l.precision !== 'country' && <span class="muted">, {placeName(core, l.iso3)}</span>}</th><td>{t('precision.' + l.precision)}</td>{analyst && <td class="small"><code>{l.method} v{l.method_version}</code> {l.gazetteer_ref}</td>}</tr>)}</tbody></table></div>
          </section>
          {e.linked_series?.length > 0 && (
            <section class="card"><h2>{t('outbreak.linked')}</h2>
              <ul class="list small">{(e.linked_series as any[]).map((l) => <li key={l.iso3}><a href={href(route, 'place/' + l.iso3, { d: l.disease })}>{diseaseName(core, l.disease)} · {placeName(core, l.iso3)}</a></li>)}</ul></section>
          )}
          {analyst && <section class="card"><h2>{t('rank.title')}</h2><p class="small">{t('rank.formula')}</p><dl class="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>{Object.entries(e.rank.components).map(([k, v]) => <><dt>{t('rank.' + k)}</dt><dd>{(v as number).toFixed(3)}</dd></>)}<dt><b>{t('rank.score')}</b></dt><dd><b>{e.rank.score.toFixed(3)}</b></dd></dl><p class="small muted">{e.quality_flags.map((q: string) => t('qf.' + q)).join(' · ')}</p></section>}
          <ContextLinks disease={e.disease} iso3={e.countries[0]} />
        </div>
      </div>
    </>
  );
}

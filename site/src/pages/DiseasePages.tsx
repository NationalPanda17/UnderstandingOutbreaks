/** Disease list and disease detail. Event-only diseases get the same page with no time-series section. */
import { href } from '../lib/app';
import { getJSON, getOptional, type EventIdx, type Overview as Ov, type PType } from '../lib/data';
import { num, periodLabel, smart, t } from '../lib/i18n';
import { mapMetricLabel, placeName, seriesLabel } from '../lib/series';
import type { SeriesData } from '../lib/transforms';
import { ChartCard } from '../components/ChartCard';
import { ContextLinks } from '../components/ContextLinks';
import { EventRow } from '../components/Events';
import { DiseaseBadge, ErrorBox, Ext, Loading, diseaseName, useAsync } from '../components/Layout';
import { SourceChip, useApp } from '../components/SourceChip';
import { WatchButton } from './Watchlists';

export function Diseases() {
  const { core, route } = useApp();
  const events = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const count = (id: string) => (events.data?.events ?? []).filter((e) => e.disease === id).length;
  const type = route.params.get('type') ?? '';
  const list = core.diseases.filter((d) => !type || d.badge === type).filter((d) => d.has_timeseries || count(d.id) > 0 || events.loading);
  return (
    <>
      <h1>{t('diseases.title')}</h1>
      <p class="lead">{t('diseases.lead')}</p>
      <div class="tabs">
        <a href={href(route, 'diseases', { type: null })} aria-current={!type ? 'page' : undefined}>{t('filter.allTypes')}</a>
        <a href={href(route, 'diseases', { type: 'timeseries' })} aria-current={type === 'timeseries' ? 'page' : undefined}>{t('badge.timeseries')}</a>
        <a href={href(route, 'diseases', { type: 'events-only' })} aria-current={type === 'events-only' ? 'page' : undefined}>{t('badge.events-only')}</a>
      </div>
      <div class="grid three">
        {list.map((d) => (
          <section class="card" key={d.id}>
            <h2 style={{ fontSize: '1.05rem' }}><a href={href(route, 'disease/' + d.id)}>{diseaseName(core, d.id)}</a></h2>
            <p><DiseaseBadge d={d} /> <span class="small muted">{t('diseases.events', { n: count(d.id) })}</span></p>
          </section>
        ))}
        {count('other') > 0 && <section class="card"><h2 style={{ fontSize: '1.05rem' }}><a href={href(route, 'outbreaks', { d: 'other' })}>{t('disease.other')}</a></h2><p><span class="badge ev">{t('badge.events-only')}</span> <span class="small muted">{t('diseases.events', { n: count('other') })}</span></p><p class="small muted">{t('diseases.otherNote')}</p></section>}
      </div>
    </>
  );
}

export function DiseasePage({ id }: { id: string }) {
  const { core, route } = useApp();
  const d = core.diseaseById[id];
  const ov = useAsync(() => (d?.has_timeseries ? getOptional<Ov>(`overview/${id}.json`) : Promise.resolve(null)), [id]);
  const events = useAsync(() => getJSON<{ events: EventIdx[] }>('events/index.json'), []);
  const regions = useAsync(() => getOptional<{ countries: Record<string, { years: [number, number]; latest_year: number | null; n_matched: number }> }>(`subnational/${id}/index.json`), [id]);
  if (!d) return <ErrorBox error={t('disease.unknown', { id })} />;
  const name = diseaseName(core, id);
  const mine = (events.data?.events ?? []).filter((e) => e.disease === id).sort((a, b) => (a.last_report < b.last_report ? 1 : -1));
  const o = ov.data;
  const meta = o ? core.seriesByKey[o.skey] : null;
  const global: SeriesData | null = o ? { id: 'global', label: t('disease.globalLabel', { n: Math.max(...o.global.n) }), p: o.global.p, v: o.global.v, ptype: o.period_type as PType, incompleteFrom: o.incomplete_from } : null;
  const top = o ? Object.entries(o.latest).filter(([, r]) => r.metric_value !== null).sort((a, b) => (b[1].metric_value as number) - (a[1].metric_value as number)).slice(0, 15) : [];
  const rec = core.reconciliation[id];
  return (
    <>
      <div class="row"><h1>{name}</h1><WatchButton item={{ kind: 'disease', disease: id }} /></div>
      <p><DiseaseBadge d={d} />{d.seasonal && <> <span class="badge">{t('disease.seasonal')}</span></>}{meta?.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}</p>
      <p class="lead">{t(d.has_timeseries ? 'disease.leadTs' : 'disease.leadEvents', { name })}</p>
      {ov.loading && <Loading />}
      {o && global && meta && (
        <>
          <ChartCard id="disease-global" title={t('disease.globalTitle', { name })} series={[global]}
            prov={{ title: t('disease.globalTitle', { name }), origin: 'site-derived', sourceIds: [meta.source_id], asOf: meta.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? o.snapshot_id, series: [{ skey: o.skey }], method: { name: 'sum_reporting_countries', version: '1' }, caseDefinitions: [meta.case_definition] }}
            yLabel={t('metric.' + meta.metric)} means={t('disease.globalMeans')} embed={{ kind: 'chart', params: { d: id, global: '1' } }} tours={['epicurve', 'recentlow']} />
          {meta.case_definition === 'mixed' && <div class="notice warn" role="note">{t('warn.mixedSeries')}</div>}
          <section class="card" style={{ marginTop: '16px' }}>
            <header><h2>{t('disease.top', { metric: mapMetricLabel(core, id, o.method.window_periods, o.period_type) })}</h2>
              <SourceChip compact prov={{ title: t('disease.top', { metric: mapMetricLabel(core, id, o.method.window_periods, o.period_type) }), origin: 'site-derived', sourceIds: o.source_ids, asOf: meta.retrieved_at?.slice(0, 10) ?? null, snapshotId: route.snapshot ?? o.snapshot_id, series: [{ skey: o.skey }], method: { name: o.method.name, version: o.method.version, params: { window_periods: o.method.window_periods } } }} /></header>
            <p class="sub">{periodLabel(o.anchor, o.period_type)} · {t('disease.topCaveat')}</p>
            <div class="tablewrap"><table class="data">
              <thead><tr><th scope="col">{t('table.place')}</th><th scope="col" class="n">{mapMetricLabel(core, id, o.method.window_periods, o.period_type)}</th><th scope="col" class="n">{t('table.count')}</th></tr></thead>
              <tbody>{top.map(([k, r]) => <tr key={k}><th scope="row"><a href={href(route, 'place/' + k, { d: id })}>{placeName(core, k)}</a></th><td class="n">{smart(r.metric_value)}</td><td class="n">{num(r.value)}</td></tr>)}</tbody>
            </table></div>
            <p class="small"><a href={href(route, '', { d: id })}>{t('disease.seeMap')}</a></p>
          </section>
        </>
      )}

      <section class="card" style={{ marginTop: '16px' }}>
        <h2>{t('disease.events', { name })}</h2>
        {!mine.length && !events.loading && <p class="muted">{t('disease.noEvents')}</p>}
        <ul class="list">{mine.slice(0, 12).map((e) => <EventRow key={e.event_id} e={e} />)}</ul>
        {mine.length > 12 && <p><a href={href(route, 'outbreaks', { d: id })}>{t('overview.allOutbreaks', { n: mine.length })}</a></p>}
      </section>

      {d.series.length > 0 && (
        <section class="card" style={{ marginTop: '16px' }}>
          <h2>{t('disease.seriesTitle')}</h2>
          <p class="sub">{t('disease.seriesSub')}</p>
          <ul class="list small">
            {d.series.filter((s) => route.mode === 'analyst' || s.skey === d.default_skey || s.n_places > 20).map((s) => (
              <li key={s.skey}><b>{seriesLabel(core, s, { withSource: true })}</b> · {t('ptype.' + s.period_type)} · {t('disease.nPlaces', { n: s.n_places })} <span class="badge">{t('origin.' + s.origin_type)}</span>{s.stale && <> <span class="badge stale">{t('badge.stale')}</span></>}{s.skey === d.default_skey && <> <span class="badge ts">{t('place.defaultSeries')}</span></>}
                <div class="muted">{s.case_definition_note} {s.surveillance_system_note}</div></li>
            ))}
          </ul>
          {rec && <p class="small">{t('disease.reconcile', { overlaps: num(rec.overlaps), n: num(rec.disagreements) })}</p>}
        </section>
      )}
      <section class="card" style={{ marginTop: '16px' }}>
        <h2>{t('disease.ids')}</h2>
        <dl class="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
          <dt>ICD-11</dt><dd>{d.icd11 ? <Ext url={`https://icd.who.int/browse/2024-01/mms/en#/?q=${d.icd11}`}>{d.icd11}</Ext> : t('disease.idBlank')}</dd>
          <dt>MeSH</dt><dd>{d.mesh ? <Ext url={`https://meshb.nlm.nih.gov/record/ui?ui=${d.mesh}`}>{d.mesh}</Ext> : t('disease.idBlank')}</dd>
        </dl>
        <p class="small muted">{t('disease.idsNote')}</p>
      </section>
      <ContextLinks disease={id} />
      {regions.data && Object.keys(regions.data.countries).length > 0 && (
        <section class="card" style={{ marginTop: '16px' }}>
          <h2>{t('disease.regionsTitle')}</h2>
          <p class="small muted">{t('disease.regionsLead')}</p>
          <ul class="cols">{Object.entries(regions.data.countries).map(([k, v]) => [placeName(core, k), k, v] as const).sort((a, b) => a[0].localeCompare(b[0])).map(([nm, k, v]) =>
            <li key={k}><a href={href(route, 'place/' + k, { d: id }) + '#place-regions'}>{nm}</a> <span class="small muted">{v.years[0] === v.years[1] ? v.years[0] : `${v.years[0]}–${v.latest_year ?? v.years[1]}`}</span></li>)}</ul>
        </section>
      )}
    </>
  );
}

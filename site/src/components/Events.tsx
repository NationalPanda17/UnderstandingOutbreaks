/** Shared pieces for event-based outbreaks: provenance, neutral status labels, automated summaries with marked quotes. */
import { href } from '../lib/app';
import type { Core, EventIdx } from '../lib/data';
import { date, num, t } from '../lib/i18n';
import type { Prov } from '../lib/prov';
import { placeName } from '../lib/series';
import { diseaseName } from './Layout';
import { SourceChip, useApp } from './SourceChip';

export function eventProv(core: Core, e: EventIdx, snapshot: string | null): Prov {
  return {
    title: t('event.provTitle', { disease: diseaseName(core, e.disease), places: eventPlaces(core, e) }),
    origin: 'site-derived', sourceIds: Array.from(new Set([...e.source_ids, ...(e.locations.length ? ['geonames', 'naturalearth'] : [])])),
    asOf: e.last_report, snapshotId: snapshot ?? core.manifest.snapshot_id,
    method: { name: 'group_by_disease_place_gap', version: '1', params: { max_gap_days: 120 } },
    links: [{ label: t('event.originalNotice'), url: e.latest_url, kind: 'deep', sourceId: e.source_ids[e.source_ids.length - 1], external: true }],
    notes: [t('event.summaryNote')],
  };
}

export function eventPlaces(core: Core, e: EventIdx): string {
  if (!e.countries.length) return t('event.multiCountry');
  const names = e.countries.map((c) => placeName(core, c));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
}

export function StatusBadge({ e }: { e: EventIdx }) {
  return <span class="badge" title={t('status.' + e.status + '.explain')}>{t('status.' + e.status)}</span>;
}

/** Conservative, template-built summary. Quoted source phrases are visibly marked; nothing is presented as the source's own words otherwise. */
export function EventSummary({ e, core }: { e: EventIdx; core: Core }) {
  const src = e.source_ids.map((s) => core.sources[s]?.short_name ?? s).join(', ');
  return (
    <div data-testid="event-summary">
      <p>
        {t('event.sum.intro', { n: e.n_reports, source: src, disease: diseaseName(core, e.disease), places: eventPlaces(core, e), first: date(e.first_report, 'long'), last: date(e.last_report, 'long') })}{' '}
        {e.cases && <>{t('event.sum.cases', { date: date(e.cases.as_of, 'long') })} <q class="quote">{e.cases.quote}</q>. </>}
        {e.deaths && <>{t('event.sum.deaths')} <q class="quote">{e.deaths.quote}</q>. </>}
        {!e.cases && !e.deaths && <>{t('event.sum.noCounts')} </>}
        {t('status.' + e.status + '.explain')}
      </p>
      <p class="small muted"><span class="badge">{t('event.automated')}</span> {t('event.summaryNote')} <a class="ext" href={e.latest_url} target="_blank" rel="noopener noreferrer">{t('event.originalNotice')}</a></p>
    </div>
  );
}

export function EventRow({ e, showScore }: { e: EventIdx; showScore?: boolean }) {
  const { core, route } = useApp();
  return (
    <li>
      <div class="row">
        <a href={href(route, 'outbreak/' + e.event_id)}><b>{diseaseName(core, e.disease)}</b> — {eventPlaces(core, e)}</a>
        <StatusBadge e={e} />
      </div>
      <div class="small muted">
        {t('event.lastUpdate', { date: date(e.last_report) })}
        {e.cases && <> · {t('event.reportedCases', { n: num(e.cases.value) })}</>}
        {e.deaths && <> · {t('event.reportedDeaths', { n: num(e.deaths.value) })}</>}
        {' · '}{t('event.nReports', { n: e.n_reports })}
        {showScore && <> · {t('rank.score')}: {e.rank.score.toFixed(3)}</>}
      </div>
      <div style={{ marginTop: '4px' }}><SourceChip prov={eventProv(core, e, route.snapshot)} compact /></div>
    </li>
  );
}

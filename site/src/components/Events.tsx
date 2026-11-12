/** Shared pieces for event-based outbreaks: provenance, neutral status labels, automated summaries with marked quotes. */
import { href } from '../lib/app';
import type { Core, EventIdx } from '../lib/data';
import { date, num, t } from '../lib/i18n';
import type { Prov } from '../lib/prov';
import { placeName } from '../lib/series';
import { diseaseName } from './Layout';
import { CiteButton } from './Cite';
import { SourceChip, useApp } from './SourceChip';

/** Grouping method as published in events/index.json (methods.grouping). Kept in step by a test. */
export const GROUPING = { version: '3', max_gap_days: 120, max_notice_countries: 10 };

export function eventProv(core: Core, e: EventIdx, snapshot: string | null): Prov {
  return {
    title: t('event.provTitle', { disease: diseaseName(core, e.disease), places: eventPlaces(core, e) }),
    origin: 'site-derived', sourceIds: Array.from(new Set([...e.source_ids, ...(e.locations.length ? ['geonames', 'naturalearth'] : [])])),
    asOf: e.last_report, asOfKind: 'published', snapshotId: snapshot ?? core.manifest.snapshot_id,
    method: { name: 'group_by_disease_place_gap', version: GROUPING.version, params: { max_gap_days: GROUPING.max_gap_days, max_notice_countries: GROUPING.max_notice_countries } },
    links: [{ label: t('event.originalNotice'), url: e.latest_url, kind: 'deep', sourceId: e.source_ids[e.source_ids.length - 1], external: true }],
    notes: [t('event.summaryNote')],
  };
}

export function eventPlaces(core: Core, e: EventIdx): string {
  if (!e.countries.length) return t('event.multiCountry');
  const names = e.countries.map((c) => placeName(core, c));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
}

/** The event's stated figures as one sentence. Counts are given in the notice's own words, in quotation marks. */
export function eventStatement(core: Core, e: EventIdx): string {
  const head = `${diseaseName(core, e.disease)}, ${eventPlaces(core, e)}`;
  const src = core.sources[e.source_ids[e.source_ids.length - 1]]?.short_name ?? '';
  if (e.counts_suppressed || (!e.cases && !e.deaths)) return t('citep.stmt.eventNone', { head, n: e.n_reports, first: date(e.first_report, 'long'), last: date(e.last_report, 'long') });
  const quotes = [e.cases?.quote, e.deaths?.quote].filter(Boolean).map((q) => `“${q}”`).join('; ');
  return t('citep.stmt.event', { head, source: src, date: date((e.cases ?? e.deaths)!.as_of, 'long'), quotes });
}

export function EventCite({ e, inline }: { e: EventIdx; inline?: boolean }) {
  const { core, route } = useApp();
  // a quoted figure is cited to the notices alone, not to the gazetteer and boundaries used to place it on a map
  return <CiteButton inline={inline} prov={{ ...eventProv(core, e, route.snapshot), sourceIds: e.source_ids }} title={`${diseaseName(core, e.disease)} — ${eventPlaces(core, e)}`} statement={eventStatement(core, e)} url={href(route, 'outbreak/' + e.event_id)} />;
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
        {e.cases && !e.counts_suppressed && <>{t('event.sum.cases', { date: date(e.cases.as_of, 'long') })} <q class="quote">{e.cases.quote}</q>. </>}
        {e.deaths && !e.counts_suppressed && <>{t('event.sum.deaths')} <q class="quote">{e.deaths.quote}</q>. </>}
        {e.counts_suppressed && <>{t('event.countsHidden.' + e.counts_suppressed)} </>}
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
        {' · '}<span data-testid="event-scope">{e.countries.length === 1 ? t('event.scope.one', { place: placeName(core, e.countries[0]) }) : e.countries.length > 1 ? t('event.scope.multi', { n: e.countries.length }) : t('event.scope.none')}</span>
        {e.cases && !e.counts_suppressed && <> · {t('event.reportedCases', { n: num(e.cases.value) })} <span class="badge">{t('def.' + e.cases.case_definition)}</span> <span>{t('chip.asOf', { date: date(e.cases.as_of) })}</span></>}
        {e.deaths && !e.counts_suppressed && <> · {t('event.reportedDeaths', { n: num(e.deaths.value) })}</>}
        {(e.cases || e.deaths) && !e.counts_suppressed && <> <span class="badge auto" title={t('event.autoExplain')}>{t('event.autoCheck')}</span></>}
        {' · '}<span title={e.counts_suppressed ? t('event.countsHidden.' + e.counts_suppressed) : undefined}>{t('event.nReports', { n: e.n_reports })}</span>
        {showScore && <> · {t('rank.score')}: {e.rank.score.toFixed(3)}</>}
      </div>
      <div style={{ marginTop: '4px' }} class="chipline"><SourceChip prov={eventProv(core, e, route.snapshot)} compact /> <EventCite e={e} inline /></div>
    </li>
  );
}

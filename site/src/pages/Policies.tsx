/** Standing pages a reader expects of a publication: privacy, accessibility, corrections policy, editorial
 *  standards; the weekly briefing; and the "page not found" page. Text lives in the translation files. */
import { useState } from 'preact/hooks';
import { SITE, absoluteUrl, href } from '../lib/app';
import { getJSON, type EventIdx } from '../lib/data';
import { copyText } from '../lib/exporters';
import { date, num, periodLabel, t } from '../lib/i18n';
import { measureInSentence, placeName } from '../lib/series';
import { eventPlaces, eventProv } from '../components/Events';
import { Empty, ErrorBox, Ext, HowToRead, Loading, diseaseName, useAsync } from '../components/Layout';
import { Search } from '../components/Search';
import { SourceChip, useApp } from '../components/SourceChip';
import { Paras, Sections } from './InfoPages';

function PolicyNav({ current }: { current: string }) {
  const { route } = useApp();
  return (
    <nav class="policynav" aria-label={t('policy.nav')}>
      {['privacy', 'accessibility', 'corrections', 'editorial-standards'].map((p) => <a key={p} href={href(route, p)} aria-current={p === current ? 'page' : undefined}>{t('title.' + p)}</a>)}
    </nav>
  );
}

function Policy({ id, sections, children }: { id: string; sections: string[]; children?: any }) {
  const { route } = useApp();
  const base = 'policy.' + id;
  return (
    <div class="prose" data-testid={'policy-' + id}>
      <h1>{t('title.' + id)}</h1>
      <p class="lead">{t(base + '.lead')}</p>
      <Sections base={base} ids={sections} />
      {children}
      <p class="small muted">{t('policy.updated', { date: date(t(base + '.updated'), 'long') })} · <a href={href(route, 'about') + '#contact'}>{t('contact.title')}</a></p>
      <PolicyNav current={id} />
    </div>
  );
}

export function Privacy() { return <Policy id="privacy" sections={['collect', 'device', 'hosting', 'thirdparty']} />; }
export function Accessibility() { return <Policy id="accessibility" sections={['aim', 'works', 'limits', 'feedback']} />; }
export function CorrectionsPolicy() {
  const { route } = useApp();
  return <Policy id="corrections" sections={['principle', 'report', 'process', 'record']}><p><a class="btn" href={href(route, 'changelog')}>{t('nav.changelog')}</a></p></Policy>;
}
export function EditorialStandards() { return <Policy id="editorial-standards" sections={['publish', 'never', 'words', 'automation', 'independence']} />; }

/** A real page for an address that leads nowhere: say so, offer the search, and list where people usually want to go. */
export function NotFound() {
  const { route } = useApp();
  return (
    <div class="notfound" data-testid="not-found">
      <p class="nf-code" aria-hidden="true">404</p>
      <h1>{t('notfound.title')}</h1>
      <p class="lead">{t('notfound.lead')}</p>
      <Search hero id="notfound-search" />
      <ul class="nf-links">
        {[['', 'nav.overview'], ['outbreaks', 'nav.outbreaks'], ['map', 'nav.map'], ['diseases', 'nav.diseases'], ['briefing', 'title.briefing'], ['about', 'nav.about']].map(([p, k]) => <li key={p}><a href={href(route, p)}>{t(k)}</a></li>)}
      </ul>
    </div>
  );
}

interface Week {
  week: string; from: string; to: string; generated_at: string; snapshot_id: string; source_ids: string[];
  new_events: EventIdx[]; updated_events: EventIdx[]; status_changes: { event_id: string; from: string; to: string }[];
  movers: { disease: string; iso3: string; skey: string; period: string; value: number; prev_period: string; change_pct: number; abs_change: number }[];
  new_flags: { series_id: string }[]; corrections: { date: string; title: string }[];
}
export function weekTitle(week: string): { n: number; year: string } { const [y, w] = week.split('-W'); return { n: parseInt(w, 10), year: y }; }

/** "This week in official reports": one readable page per ISO week, at an address that does not change
 *  (/briefing/2026-W47). The current week's page is rewritten at each update until the week ends. */
export function Briefing({ week }: { week?: string }) {
  const { core, route } = useApp();
  const [copied, setCopied] = useState(false);
  const idx = useAsync(() => getJSON<{ weeks: string[] }>('weekly/index.json'), []);
  const valid = !week || /^\d{4}-W\d{2}$/.test(week);
  const w = useAsync(() => (valid ? getJSON<Week>(week ? `weekly/${week}.json` : 'weekly/latest.json') : Promise.reject(new Error('unknown week'))), [week]);
  if (!valid || (w.error && week)) return <NotFound />;
  if (w.error) return <ErrorBox error={w.error} />;
  if (!w.data) return <Loading />;
  const d = w.data; const wt = weekTitle(d.week);
  const weeks = idx.data?.weeks ?? [d.week];
  const current = weeks[weeks.length - 1] === d.week;
  const permalink = absoluteUrl(href(route, 'briefing/' + d.week));
  const prov = { title: t('briefing.title', wt), origin: 'site-derived' as const, sourceIds: d.source_ids, asOf: d.to, snapshotId: d.snapshot_id, method: { name: 'weekly_changes', version: '1' } };
  const line = (e: EventIdx) => (
    <li key={e.event_id}>
      <a href={href(route, 'outbreak/' + e.event_id)}><b>{diseaseName(core, e.disease)}</b> — {eventPlaces(core, e)}</a>: {t('summary.event', { date: date(e.last_report, 'long'), n: e.n_reports })}
      {e.cases && !e.counts_suppressed && <> {t('briefing.states')} <q class="quote">{e.cases.quote}</q>.</>}
      {' '}<span class="small"><Ext url={e.latest_url}>{core.sources[eventProv(core, e, null).links?.[0]?.sourceId ?? '']?.short_name ?? t('event.originalNotice')}</Ext></span>
    </li>
  );
  const flagged = new Set(d.new_flags.map((f) => f.series_id)).size;
  return (
    <article class="prose briefing" data-testid="briefing">
      <p class="kicker">{t('briefing.kicker')}</p>
      <h1>{t('briefing.title', wt)}</h1>
      <p class="lead">{t('briefing.lead', { from: date(d.from, 'long'), to: date(d.to, 'long') })}</p>
      <p class="chipline"><SourceChip prov={prov} />
        <button type="button" class="btn small" onClick={async () => { if (await copyText(permalink)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>{copied ? t('action.copied') : t('briefing.copyLink')}</button>
        <button type="button" class="btn small" onClick={() => window.print()}>{t('briefing.print')}</button>
      </p>
      {current && <p class="notice" role="note">{t('briefing.current')}</p>}

      <h2>{t('briefing.new', { n: d.new_events.length })}</h2>
      {d.new_events.length ? <ul class="brieflist">{d.new_events.map(line)}</ul> : <Empty>{t('briefing.noneNew')}</Empty>}

      <h2>{t('briefing.updated', { n: d.updated_events.length })}</h2>
      {d.updated_events.length ? <ul class="brieflist">{d.updated_events.map(line)}</ul> : <Empty>{t('briefing.noneUpdated')}</Empty>}

      <h2>{t('briefing.movers')}</h2>
      {d.movers.length ? (
        <ul class="brieflist">{d.movers.slice(0, 8).map((m) => { const meta = core.seriesByKey[m.skey]; if (!meta) return null; return (
          <li key={m.disease + m.iso3}><a href={href(route, 'place/' + m.iso3, { d: m.disease })}><b>{placeName(core, m.iso3)}</b>, {diseaseName(core, m.disease)}</a>: {t('briefing.mover', { value: num(m.value), measure: measureInSentence(meta.metric, meta.case_definition), period: periodLabel(m.period, meta.period_type), prev: num(m.value - m.abs_change), prevPeriod: periodLabel(m.prev_period, meta.period_type) })}</li>
        ); })}</ul>
      ) : <Empty>{t('briefing.noneMovers')}</Empty>}
      <HowToRead><p>{t('changes.moversCaveat')}</p><p>{t('briefing.moversNote')}</p></HowToRead>

      <h2>{t('briefing.alsoTitle')}</h2>
      <ul class="brieflist">
        <li>{t('briefing.status', { n: d.status_changes.length })}</li>
        <li>{t('briefing.flags', { n: flagged })} <a href={href(route, 'methodology') + '#flags'}>{t('flags.method')}</a></li>
        <li>{t('briefing.corrections', { n: d.corrections.length })} <a href={href(route, 'changelog')}>{t('nav.changelog')}</a></li>
      </ul>
      <p><a href={href(route, 'changes', { week: d.week })}>{t('briefing.fullList')}</a></p>

      <section class="briefmeta">
        <h2>{t('briefing.citeTitle')}</h2>
        <p>{t('briefing.cite', { site: SITE.name, n: wt.n, year: wt.year, from: date(d.from, 'long'), to: date(d.to, 'long') })} <span class="nowrap">{permalink}</span></p>
        <h2>{t('briefing.archive')}</h2>
        <ul class="weeks">{weeks.slice().reverse().map((x) => <li key={x}><a href={href(route, 'briefing/' + x)} aria-current={x === d.week ? 'page' : undefined}>{t('briefing.weekLabel', weekTitle(x))}</a></li>)}</ul>
      </section>
    </article>
  );
}

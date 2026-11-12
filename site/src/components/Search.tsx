/** Header search box: diseases, countries, "disease in country", reported events and the site's own pages.
 *  Everything is matched in the browser against data the site already loads; nothing typed is sent anywhere. */
import { useMemo, useRef, useState } from 'preact/hooks';
import { href, navigate } from '../lib/app';
import { getJSON, type EventIdx } from '../lib/data';
import { date, periodLabel, t } from '../lib/i18n';
import { entry, search, type Entry } from '../lib/search';
import { placeName } from '../lib/series';
import { diseaseName } from './Layout';
import { useApp } from './SourceChip';

const PAGES: [string, string][] = [['', 'nav.overview'], ['outbreaks', 'nav.outbreaks'], ['map', 'nav.map'], ['diseases', 'nav.diseases'], ['changes', 'nav.changes'], ['learn', 'nav.learn'],
  ['researchers', 'nav.researchers'], ['about', 'nav.about'], ['methodology', 'nav.methodology'], ['sources', 'nav.sources'], ['data-quality', 'nav.quality'], ['changelog', 'nav.changelog'],
  ['glossary', 'nav.glossary'], ['reporters-guide', 'nav.reporters'], ['cite', 'nav.cite'], ['watchlists', 'nav.watchlists'], ['workbench', 'workbench.title'], ['explorer', 'search.page.explorer']];

export function Search({ hero }: { hero?: boolean }) {
  const { core, route } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [events, setEvents] = useState<EventIdx[] | null>(null);
  const wanted = useRef(false);
  const loadEvents = () => { if (wanted.current) return; wanted.current = true; getJSON<{ events: EventIdx[] }>('events/index.json').then((x) => setEvents(x.events)).catch(() => undefined); };
  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const d of core.diseases) {
      // how recent the default series is, so a searcher can tell an annual 2024 series from a weekly one at a glance
      const def = d.series.find((x) => x.skey === d.default_skey);
      const latest = def?.lag?.data_edge ? t('search.latest', { period: periodLabel(def.lag.data_edge, def.period_type) }) : d.has_timeseries ? '' : t('search.eventsOnly');
      const e = entry('disease', d.id, diseaseName(core, d.id), 'disease/' + d.id, [d.name, ...(d.aliases ?? [])], [t('search.kind.disease'), latest].filter(Boolean).join(' · '));
      e.note = latest || undefined;
      out.push(e);
    }
    for (const p of Object.values(core.places)) out.push(entry('place', p.iso3, placeName(core, p.iso3), 'place/' + p.iso3, [p.name, p.iso3], t('search.kind.place')));
    for (const [path, key] of PAGES) out.push(entry('page', path, t(key), path, [], t('search.kind.page')));
    for (const e of events ?? []) {
      const where = e.countries.map((c) => placeName(core, c)).join(', ');
      out.push(entry('event', e.event_id, `${diseaseName(core, e.disease)}${where ? ' · ' + where : ''}`, 'outbreak/' + e.event_id, [e.name_in_source, ...e.countries.map((c) => core.places[c]?.name ?? '')], t('search.kind.event', { date: date(e.last_report) })));
    }
    return out;
  }, [core, events, route.locale]);
  const results = useMemo(() => search(q, entries, (d, p) => t('search.combo', { disease: d, place: p })), [q, entries]);
  const go = (i: number) => { const r = results[i]; if (!r) return; setOpen(false); setQ(''); navigate(href(route, r.path, r.params)); };
  const show = open && q.trim().length > 0;
  return (
    <div class={'search' + (hero ? ' hero' : '')} role="search">
      <label class={hero ? 'searchlabel' : 'sr'} for="site-search">{hero ? t('search.heroLabel') : t('search.label')}</label>
      <input id="site-search" type="search" value={q} placeholder={hero ? t('search.heroPlaceholder') : t('search.placeholder')} autocomplete="off" spellcheck={false}
        {...({ role: 'combobox' } as any)} aria-expanded={show} aria-controls="site-search-list" aria-autocomplete="list" aria-activedescendant={show && results[sel] ? 'site-search-' + sel : undefined}
        onFocus={() => { loadEvents(); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setSel(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {show && (
        <ul id="site-search-list" role="listbox" aria-label={t('search.results')}>
          {results.map((r, i) => (
            <li key={r.kind + r.path + (r.params?.d ?? '')} id={'site-search-' + i} role="option" aria-selected={i === sel} class={i === sel ? 'on' : undefined}
              onMouseDown={(e) => { e.preventDefault(); go(i); }} onMouseEnter={() => setSel(i)}>
              <span>{r.label}</span>{r.sub && <span class="small muted">{r.sub}</span>}
            </li>
          ))}
          {!results.length && <li class="small muted" role="option" aria-selected={false} aria-disabled>{t('search.none')}</li>}
        </ul>
      )}
      <span class="sr" role="status">{show ? t('search.count', { n: results.length }) : ''}</span>
    </div>
  );
}

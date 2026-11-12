/** Site chrome: header with language switcher and Simple / Analyst toggle, persistent data notice, footer disclaimers. */
import { useEffect, useState } from 'preact/hooks';
import { Search } from './Search';
import { OFFERED, SITE, href, navigate, setParams, storage, type Route } from '../lib/app';
import type { Core, Disease } from '../lib/data';
import { date, num, periodLabel, snapLabel, t } from '../lib/i18n';
import { useApp } from './SourceChip';

const NAV: { path: string; key: string; cls?: string }[] = [
  { path: '', key: 'nav.overview' },
  { path: 'outbreaks', key: 'nav.outbreaks' },
  { path: 'map', key: 'nav.map' },
  { path: 'diseases', key: 'nav.diseases' },
  { path: 'changes', key: 'nav.changes' },
  { path: 'learn', key: 'nav.learn', cls: 'learn' },
];
/** Reference pages, grouped under one "More" menu so the main navigation stays on one row. */
const MORE: { path: string; key: string }[] = [
  { path: 'about', key: 'nav.about' },
  { path: 'methodology', key: 'nav.methodology' },
  { path: 'sources', key: 'nav.sources' },
  { path: 'data-quality', key: 'nav.quality' },
  { path: 'reporters-guide', key: 'nav.reporters' },
  { path: 'researchers', key: 'nav.researchers' },
  { path: 'glossary', key: 'nav.glossary' },
  { path: 'watchlists', key: 'nav.watchlists' },
];

/** The "More" menu: a button that opens a short list of reference pages. Closes on Escape, on a click outside and
 *  when a link is followed. */
function MoreMenu({ current }: { current: (p: string) => boolean }) {
  const { route } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [route.parts.join('/')]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.moremenu')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); document.getElementById('more-button')?.focus(); } };
    document.addEventListener('click', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const here = MORE.some((m) => current(m.path));
  return (
    <div class="moremenu">
      <button type="button" id="more-button" class={here ? 'on' : undefined} aria-expanded={open} aria-controls="more-list" onClick={() => setOpen(!open)} data-testid="more-menu">{t('nav.more')} <span aria-hidden="true">▾</span></button>
      <ul id="more-list" hidden={!open}>
        {MORE.map((m) => <li key={m.path}><a href={href(route, m.path)} aria-current={current(m.path) ? 'page' : undefined}>{t(m.key)}</a></li>)}
      </ul>
    </div>
  );
}

/** "More options" / "Fewer options": the detailed view (definitions, filters, downloads, source details) is turned
 *  on where it is needed instead of from a switch in the header. The choice is remembered and kept in the address. */
export function DetailToggle({ compact }: { compact?: boolean }) {
  const { route } = useApp();
  const on = route.mode === 'analyst';
  const set = () => { const m = on ? 'simple' : 'analyst'; storage.set('mode', m); setParams({ mode: m === 'analyst' ? 'analyst' : null }); };
  return <button type="button" class={compact ? 'btn small' : 'linklike detailtoggle'} aria-pressed={on} onClick={set} title={t(on ? 'mode.simple.hint' : 'mode.analyst.hint')} data-testid="detail-toggle">{t(on ? 'mode.fewer' : 'mode.more')}</button>;
}

/** Annual series are often a year or two behind: say so next to the headline instead of leaving the reader to notice. */
export function AgeBadge({ period, ptype }: { period: string | null | undefined; ptype: string }) {
  if (!period || ptype !== 'Y') return null;
  const year = parseInt(period.slice(0, 4), 10);
  // Age is counted from the end of the year the figure covers, in months, so "2024" reads as what it is in late 2026.
  const now = new Date();
  const months = Math.max(0, (now.getUTCFullYear() - year - 1) * 12 + now.getUTCMonth() + 1);
  return <span class="badge age" title={t('age.explain')}>{t('age.badgeMonths', { year: String(year), n: months })}</span>;
}

/** Under a headline world total: what it is built from (measles: suspected, WHO total, laboratory-confirmed; polio:
 *  wild and vaccine-derived types), and the same total restricted to the countries that report consistently. */
export function Breakdown({ g, ptype }: { g: { breakdown?: { dataset_id: string; case_definition: string; period: string; value: number | null; n: number }[]; panel?: { n_panel: number; value_at_anchor: number | null } }; ptype: string }) {
  const parts = (g.breakdown ?? []).filter((b) => b.value !== null);
  const panel = g.panel && g.panel.n_panel > 0 && g.panel.value_at_anchor !== null ? g.panel : null;
  if (!parts.length && !panel) return null;
  return (
    <p class="small" data-testid="breakdown">
      {parts.length > 0 && <>{t('breakdown.title', { period: periodLabel(parts[0].period, ptype) })} {parts.map((b, i) => <span key={b.dataset_id + b.case_definition}>{i > 0 && ' · '}{t(`part.${b.dataset_id}.${b.case_definition}`)} <b>{num(b.value)}</b> <span class="muted">({t('breakdown.n', { n: b.n })})</span></span>)}. <span class="muted">{t('breakdown.note.' + parts[0].dataset_id.split('_')[1])}</span><br /></>}
      {panel && <span class="muted">{t('panel.card', { n: panel.n_panel, value: num(panel.value_at_anchor) })}</span>}
    </p>
  );
}

export function switchLocale(route: Route, loc: string): void {
  storage.set('locale', loc);
  const rest = route.parts.map(encodeURIComponent).join('/');
  const s = route.params.toString();
  navigate(`/${loc}/${rest}${s ? '?' + s : ''}`);
}

export function Layout({ children }: { children: any }) {
  const { route, core } = useApp();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [route.parts.join('/')]);
  const first = route.parts[0] ?? '';
  const isCurrent = (p: string) => (p === '' ? first === '' : first === p || (p === 'outbreaks' && ['outbreak', 'spread'].includes(first)) || (p === 'diseases' && first === 'disease') || (p === 'changes' && first === 'compare') || (p === 'about' && first === 'status') || (p === 'researchers' && ['explorer', 'workbench', 'cite', 'api'].includes(first)));
  const latest = core.manifest.snapshot_id;
  const pinned = route.snapshot && route.snapshot !== latest ? core.manifest.snapshots.find((s) => s.id === route.snapshot) : null;
  const unknownPin = route.snapshot && !core.manifest.snapshots.some((s) => s.id === route.snapshot);
  return (
    <>
      <a class="skip" href="#main">{t('a11y.skip')}</a>
      <header class="site">
        <div class="wrap bar">
          <a class="brand" href={href(route, '')} aria-label={SITE.name}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#0b6e75" /><path d="M5 22c4 0 4-12 8-12s4 8 7 8 3-4 7-4" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" /></svg>
            {SITE.name}
          </a>
          <button type="button" class="menubtn" aria-expanded={menu} aria-controls="main-nav" onClick={() => setMenu(!menu)} data-testid="menu-button">{t('nav.menu')}</button>
          <nav class={'main' + (menu ? ' open' : '')} id="main-nav" aria-label={t('a11y.mainNav')}>
            {NAV.map((n) => <a key={n.path} class={n.cls} href={href(route, n.path)} aria-current={isCurrent(n.path) ? 'page' : undefined}>{t(n.key)}</a>)}
            <MoreMenu current={isCurrent} />
          </nav>
          <div class="controls">
            {/* the home page has its own large search box, so the header does not repeat it there */}
            {first !== '' && <Search />}
            {(OFFERED.length > 1 || !OFFERED.includes(route.locale)) && (
            <label><span class="sr">{t('lang.label')}</span>
              <select aria-label={t('lang.label')} value={route.locale} onChange={(e) => switchLocale(route, (e.target as HTMLSelectElement).value)} data-testid="lang-switch">
                {SITE.locales.filter((l) => OFFERED.includes(l.code) || l.code === route.locale).map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}{OFFERED.includes(l.code) ? '' : ' (draft)'}</option>)}
              </select>
            </label>
            )}
          </div>
        </div>
      </header>
      {/* One standing caveat for the whole site, with the date of the data. Cards link to "How to read this" instead of repeating it. */}
      <aside class="persist" aria-label={t('persist.more')}><div class="wrap">
        {first !== 'learn' && <span>{t('persist.notice')} <a href={href(route, 'reporters-guide')}>{t('persist.more')}</a></span>}
        <span class="asof" data-testid="data-asof">{t('asof.chip', { date: date(core.manifest.generated_at) })}</span>
      </div></aside>
      <main id="main" tabIndex={-1}>
        <div class="wrap">
          {pinned && (
            <div class="notice pin" role="status" data-testid="pinned-banner">
              {t('pin.banner', { date: date(pinned.created_at, 'long'), id: snapLabel(pinned.id) })}{' '}
              <a href={href(route, route.parts.join('/'), { snapshot: null }, { keepAll: true })}>{t('pin.latest')}</a>
              <div class="small muted">{t('pin.vintage')}</div>
            </div>
          )}
          {!OFFERED.includes(route.locale) && <div class="notice warn" role="note" data-testid="draft-locale">{t('lang.draftNotice')} <a href={href(route, route.parts.join('/'), {}, { locale: SITE.defaultLocale, keepAll: true })} lang="en">Read this page in English</a></div>}
          {unknownPin && <div class="notice warn" role="alert">{t('pin.unknown', { id: route.snapshot! })}</div>}
          {first !== 'learn' && <div class="detailbar"><DetailToggle /></div>}
          {route.mode === 'analyst' && first !== 'learn' && <SnapshotPicker />}
          {children}
        </div>
      </main>
      <footer class="site">
        <div class="wrap">
          <p><b>{t('footer.positioning')}</b></p>
          <p><a class="ext" href="https://www.who.int/emergencies" target="_blank" rel="noopener noreferrer">{t('footer.official')}</a></p>
          <div class="cols">
            <ul>
              <li><a href={href(route, 'about')}>{t('nav.about')}</a></li>
              <li><a href={href(route, 'methodology')}>{t('nav.methodology')}</a></li>
              <li><a href={href(route, 'sources')}>{t('nav.sources')}</a></li>
              <li><a href={href(route, 'data-quality')}>{t('nav.quality')}</a></li>
              <li><a href={href(route, 'changelog')}>{t('nav.changelog')}</a></li>
            </ul>
            <ul>
              <li><a href={href(route, 'glossary')}>{t('nav.glossary')}</a></li>
              <li><a href={href(route, 'reporters-guide')}>{t('nav.reporters')}</a></li>
              <li><a href={href(route, 'researchers')}>{t('nav.researchers')}</a></li>
              <li><a href={href(route, 'cite')}>{t('nav.cite')}</a></li>
              <li><a href={href(route, 'watchlists')}>{t('nav.watchlists')}</a></li>
            </ul>
            <ul>
              <li>{t('footer.licenseCode')}</li>
              <li>{t('footer.licenseContent')}</li>
              <li>{t('footer.licenseData')}</li>
              <li>{t('footer.privacy')}</li>
              <li><a href={href(route, 'status')}>{t('status.title')}</a></li>
              <li><a href={href(route, 'about') + '#contact'}>{t('contact.report')}</a></li>
            </ul>
          </div>
          <p class="small" title={latest}>{t('footer.snapshot', { id: snapLabel(latest), date: date(core.manifest.generated_at) })} · {t('footer.attribution')}</p>
        </div>
      </footer>
    </>
  );
}

/** Analyst mode: pick a "data as of" snapshot. Pins the whole view (URL parameter), reproducibly. */
export function SnapshotPicker() {
  const { core, route } = useApp();
  const snaps = core.manifest.snapshots;
  // Until snapshots are at least two days apart there is nothing meaningful to step back to: say when tracking began.
  const spanDays = snaps.length > 1 ? (Date.parse(snaps[snaps.length - 1].created_at) - Date.parse(snaps[0].created_at)) / 86400000 : 0;
  if (spanDays < 2) return <div class="tools small muted" data-testid="snapshot-began">{t('revisions.began', { date: date(snaps[0]?.created_at, 'long') })}</div>;
  return (
    <div class="tools" data-testid="snapshot-picker">
      <label>{t('pin.pick')}{' '}
        <select value={route.snapshot ?? ''} onChange={(e) => setParams({ snapshot: (e.target as HTMLSelectElement).value || null })}>
          <option value="">{t('pin.latestOption', { date: date(snaps[snaps.length - 1]?.created_at) })}</option>
          {snaps.slice(0, -1).reverse().map((s) => <option key={s.id} value={s.id}>{snapLabel(s.id)}</option>)}
        </select>
      </label>
      <span class="small muted">{t('pin.count', { n: snaps.length })} {t('pin.vintage')}</span>
    </div>
  );
}

/** The explanations and caveats for one card, folded behind a single "How to read this" line. The site-wide caveat
 *  stays visible under the header; each card keeps its fine print one click away instead of printing it in grey. */
export function HowToRead({ children }: { children: any }) {
  return <details class="more howread" data-testid="how-to-read"><summary>{t('howread.title')}</summary><div class="howread-body">{children}</div></details>;
}

export function Loading({ what }: { what?: string }) {
  return <p class="muted" role="status" aria-live="polite">{what ?? t('state.loading')}</p>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return <div class="notice warn" role="alert">{t('state.error')} <code class="small">{String((error as any)?.message ?? error)}</code></div>;
}

/** Load data for a view; re-runs when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean } {
  const [st, setSt] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { if (live) setSt({ data, error: null, loading: false }); }).catch((error) => { if (live) setSt({ data: null, error, loading: false }); });
    return () => { live = false; };
  }, deps);
  return st;
}

export function DiseaseBadge({ d }: { d: Disease }) {
  return <span class={'badge ' + (d.badge === 'timeseries' ? 'ts' : 'ev')}>{t('badge.' + d.badge)}</span>;
}

export function diseaseName(core: Core, id: string): string {
  if (id === 'other') return t('disease.other');
  const k = 'disease.' + id;
  const tr = t(k);
  return tr === k ? core.diseaseById[id]?.name ?? id : tr;
}

/** Glossary term with an accessible tooltip (hover, focus, or tap). */
export function Term({ id, children }: { id: string; children?: any }) {
  const [open, setOpen] = useState(false);
  return <span class="term" tabIndex={0} role="button" aria-label={`${t('glossary.' + id + '.term')}: ${t('glossary.' + id + '.def')}`} data-def={t('glossary.' + id + '.def')} data-open={open} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>{children ?? t('glossary.' + id + '.term')}</span>;
}

/** One-time, dismissible notice ("before you compare", "before you simulate"). Dismissal is remembered if storage works. */
export function FirstUse({ id, title, children, kind }: { id: string; title: string; children: any; kind?: 'sim' | 'warn' }) {
  const [hidden, setHidden] = useState(() => storage.get('dismissed.' + id) === '1');
  if (hidden) return null;
  return (
    <div class={'notice ' + (kind ?? 'warn')} role="note" data-testid={'firstuse-' + id}>
      <b>{title}</b>
      <div>{children}</div>
      <button type="button" class="btn small" onClick={() => { storage.set('dismissed.' + id, '1'); setHidden(true); }}>{t('action.gotIt')}</button>
    </div>
  );
}

export function Ext({ url, children }: { url: string; children: any }) {
  return <a class="ext" href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
}

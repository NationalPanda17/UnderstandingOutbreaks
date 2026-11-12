/** Site chrome: header with language switcher and Simple / Analyst toggle, persistent data notice, footer disclaimers. */
import { useEffect, useState } from 'preact/hooks';
import { Search } from './Search';
import { OFFERED, SITE, href, navigate, setParams, storage, type Route } from '../lib/app';
import type { Core, Disease } from '../lib/data';
import { date, num, periodLabel, t } from '../lib/i18n';
import { useApp } from './SourceChip';

const NAV: { path: string; key: string; cls?: string }[] = [
  { path: '', key: 'nav.overview' },
  { path: 'outbreaks', key: 'nav.outbreaks' },
  { path: 'map', key: 'nav.map' },
  { path: 'diseases', key: 'nav.diseases' },
  { path: 'changes', key: 'nav.changes' },
  { path: 'learn', key: 'nav.learn', cls: 'learn' },
  { path: 'researchers', key: 'nav.researchers' },
  { path: 'about', key: 'nav.about' },
];

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
  const isCurrent = (p: string) => (p === '' ? first === '' : first === p || (p === 'outbreaks' && first === 'outbreak') || (p === 'diseases' && first === 'disease') || (p === 'researchers' && ['explorer', 'workbench', 'cite', 'api'].includes(first)));
  const setMode = (m: 'simple' | 'analyst') => { storage.set('mode', m); setParams({ mode: m === 'analyst' ? 'analyst' : null }); };
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
          </nav>
          <div class="controls">
            <Search />
            <span class="seg" role="group" aria-label={t('mode.label')}>
              <button type="button" aria-pressed={route.mode === 'simple'} onClick={() => setMode('simple')} title={t('mode.simple.hint')}>{t('mode.simple')}</button>
              <button type="button" aria-pressed={route.mode === 'analyst'} onClick={() => setMode('analyst')} title={t('mode.analyst.hint')}>{t('mode.analyst')}</button>
            </span>
            {(OFFERED.length > 1 || !OFFERED.includes(route.locale)) && (
            <label><span class="sr">{t('lang.label')}</span>
              <select aria-label={t('lang.label')} value={route.locale} onChange={(e) => switchLocale(route, (e.target as HTMLSelectElement).value)} data-testid="lang-switch">
                {SITE.locales.filter((l) => OFFERED.includes(l.code) || l.code === route.locale).map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}{OFFERED.includes(l.code) ? '' : ' (draft)'}</option>)}
              </select>
            </label>
            )}
          </div>
        </div>
        <div class="wrap strip">
          <span class="modehint">{t(route.mode === 'analyst' ? 'mode.hintAnalyst' : 'mode.hintSimple')}</span>
          <span class="asof" data-testid="data-asof">{t('asof.chip', { date: date(core.manifest.generated_at) })}</span>
        </div>
      </header>
      {first !== 'learn' && (
        <div class="persist" role="note"><div class="wrap">{t('persist.notice')} <a href={href(route, 'methodology')}>{t('persist.more')}</a></div></div>
      )}
      <main id="main" tabIndex={-1}>
        <div class="wrap">
          {pinned && (
            <div class="notice pin" role="status" data-testid="pinned-banner">
              {t('pin.banner', { date: date(pinned.created_at, 'long'), id: pinned.id })}{' '}
              <a href={href(route, route.parts.join('/'), { snapshot: null }, { keepAll: true })}>{t('pin.latest')}</a>
              <div class="small muted">{t('pin.vintage')}</div>
            </div>
          )}
          {!OFFERED.includes(route.locale) && <div class="notice warn" role="note" data-testid="draft-locale">{t('lang.draftNotice')} <a href={href(route, route.parts.join('/'), {}, { locale: SITE.defaultLocale, keepAll: true })} lang="en">Read this page in English</a></div>}
          {unknownPin && <div class="notice warn" role="alert">{t('pin.unknown', { id: route.snapshot! })}</div>}
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
          <p class="small">{t('footer.snapshot', { id: latest, date: date(core.manifest.generated_at) })} · {t('footer.attribution')}</p>
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
          {snaps.slice(0, -1).reverse().map((s) => <option key={s.id} value={s.id}>{date(s.created_at)} · {s.id}</option>)}
        </select>
      </label>
      <span class="small muted">{t('pin.count', { n: snaps.length })} {t('pin.vintage')}</span>
    </div>
  );
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

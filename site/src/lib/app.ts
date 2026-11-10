/** App state: the URL is the source of truth for locale, mode, snapshot and view parameters. */
import { useEffect, useState } from 'preact/hooks';
import site from '../../../config/site.json';

// In local development the tool runtimes and raw archive are served from site/public/r2, not from the hosted bucket.
export const SITE = import.meta.env.DEV ? { ...site, r2BaseUrl: '/r2', toolAssetsBaseUrl: '/r2/tools' } : site;
export const LOCALES = site.locales.map((l) => l.code);
export type Mode = 'simple' | 'analyst';

export interface Route {
  locale: string;
  /** Path segments after the locale, e.g. ['place', 'KEN']. */
  parts: string[];
  params: URLSearchParams;
  mode: Mode;
  snapshot: string | null;
  embed: boolean;
}

/** Browser storage is a convenience only: every access is wrapped, and the app works without it. */
export const storage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem('uo.' + key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { window.localStorage.setItem('uo.' + key, value); } catch { /* storage unavailable */ }
  },
  remove(key: string): void {
    try { window.localStorage.removeItem('uo.' + key); } catch { /* storage unavailable */ }
  },
};

export function parseRoute(loc: { pathname: string; search: string } = window.location): Route {
  let segs = loc.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const embed = segs[0] === 'embed';
  if (embed) segs = segs.slice(1);
  let locale = site.defaultLocale;
  if (segs.length && LOCALES.includes(segs[0])) { locale = segs[0]; segs = segs.slice(1); }
  const params = new URLSearchParams(loc.search);
  const mode: Mode = params.get('mode') === 'analyst' ? 'analyst' : 'simple';
  return { locale, parts: segs, params, mode, snapshot: params.get('snapshot'), embed };
}

/** Parameters that follow the viewer from page to page. */
const STICKY = ['mode', 'snapshot'];

export function href(route: Route, path: string, params: Record<string, string | null | undefined> = {}, opts: { locale?: string; keepAll?: boolean } = {}): string {
  const q = new URLSearchParams();
  for (const k of opts.keepAll ? Array.from(route.params.keys()) : STICKY) {
    const v = route.params.get(k);
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') q.delete(k); else q.set(k, v);
  }
  if (q.get('mode') === 'simple') q.delete('mode');
  const p = path.replace(/^\/+/, '');
  const s = q.toString();
  return `/${opts.locale ?? route.locale}/${p}${s ? '?' + s : ''}`.replace(/\/+$/, '/') ;
}

const listeners = new Set<() => void>();

export function navigate(url: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', url); else window.history.pushState(null, '', url);
  listeners.forEach((l) => l());
  if (!replace) window.scrollTo(0, 0);
}

/** Update query parameters of the current view without leaving the page (shareable state). */
export function setParams(params: Record<string, string | null | undefined>, replace = true): void {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') q.delete(k); else q.set(k, v);
  }
  if (q.get('mode') === 'simple') q.delete('mode');
  const s = q.toString();
  navigate(window.location.pathname + (s ? '?' + s : ''), replace);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    listeners.add(on);
    window.addEventListener('popstate', on);
    return () => { listeners.delete(on); window.removeEventListener('popstate', on); };
  }, []);
  return route;
}

/** Intercept same-origin link clicks so navigation stays client-side. */
export function installLinkHandler(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a) return;
    const h = a.getAttribute('href');
    if (!h || a.target || a.hasAttribute('download') || !h.startsWith('/') || h.startsWith('/data/') || h.startsWith('/r2/') || h.startsWith('/embed/')) return;
    e.preventDefault();
    navigate(h);
  });
}

/** First visit without explicit choices: apply the remembered locale and mode (if any). */
export function applyRemembered(): void {
  const segs = window.location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(window.location.search);
  let changed = false;
  let path = window.location.pathname;
  if (!segs.length || !LOCALES.includes(segs[0])) {
    const remembered = storage.get('locale');
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    const loc = remembered && LOCALES.includes(remembered) ? remembered : LOCALES.includes(nav) ? nav : site.defaultLocale;
    path = `/${loc}${window.location.pathname === '/' ? '/' : window.location.pathname}`;
    changed = true;
  }
  if (!q.has('mode') && storage.get('mode') === 'analyst') { q.set('mode', 'analyst'); changed = true; }
  if (changed) {
    const s = q.toString();
    window.history.replaceState(null, '', path + (s ? '?' + s : ''));
  }
}

export function absoluteUrl(pathAndQuery: string): string {
  return site.baseUrl.replace(/\/+$/, '') + pathAndQuery;
}

export function dataUrl(path: string): string {
  return `${site.dataPath}/${path}`;
}

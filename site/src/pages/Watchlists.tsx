/** Watchlists: saved combinations of diseases, places and filters. Shareable URL + local JSON file. No accounts, no server. */
import { useState } from 'preact/hooks';
import { absoluteUrl, dataUrl, href, navigate, storage } from '../lib/app';
import { getOptional } from '../lib/data';
import { copyText, download } from '../lib/exporters';
import { t } from '../lib/i18n';
import { placeName } from '../lib/series';
import { diseaseName, useAsync } from '../components/Layout';
import { useApp } from '../components/SourceChip';

export interface WatchItem { kind: 'place' | 'disease' | 'event'; iso3?: string; disease?: string; event?: string; mode?: string }
export const WATCH_VERSION = 1;

export function encodeWatch(items: WatchItem[]): string {
  return items.map((i) => (i.kind === 'place' ? `p:${i.iso3}${i.disease ? ':' + i.disease : ''}` : i.kind === 'disease' ? `d:${i.disease}` : `e:${i.event}`)).join(',');
}
export function decodeWatch(s: string | null): WatchItem[] {
  if (!s) return [];
  const out: WatchItem[] = [];
  for (const part of s.split(',')) {
    const [k, a, b] = part.split(':');
    if (k === 'p' && /^[A-Z]{3}$/.test(a ?? '')) out.push({ kind: 'place', iso3: a, disease: b && /^[a-z0-9_]+$/.test(b) ? b : undefined });
    else if (k === 'd' && /^[a-z0-9_]+$/.test(a ?? '')) out.push({ kind: 'disease', disease: a });
    else if (k === 'e' && /^[a-z0-9-]+$/.test(a ?? '')) out.push({ kind: 'event', event: a });
  }
  return out.slice(0, 100);
}
/** Validate an imported file. Anything unexpected is rejected rather than guessed. */
export function parseWatchFile(text: string): WatchItem[] {
  const doc = JSON.parse(text);
  if (!doc || doc.format !== 'understandingoutbreaks-watchlist' || !Array.isArray(doc.items)) throw new Error('not a watchlist file');
  return decodeWatch(encodeWatch(doc.items.filter((i: any) => i && typeof i === 'object' && ['place', 'disease', 'event'].includes(i.kind))));
}
export function loadWatch(): WatchItem[] { return decodeWatch(storage.get('watch')); }
function saveWatch(items: WatchItem[]): void { storage.set('watch', encodeWatch(items)); }
const same = (a: WatchItem, b: WatchItem) => encodeWatch([a]) === encodeWatch([b]);

export function WatchButton({ item }: { item: WatchItem }) {
  const [items, setItems] = useState(loadWatch);
  const on = items.some((i) => same(i, item));
  return (
    <button type="button" class="btn small" aria-pressed={on} onClick={() => { const next = on ? items.filter((i) => !same(i, item)) : [...items, item]; saveWatch(next); setItems(next); }}>
      {on ? t('watch.remove') : t('watch.add')}
    </button>
  );
}

export function Watchlists() {
  const { core, route } = useApp();
  const shared = route.params.get('w');
  const [items, setItems] = useState<WatchItem[]>(() => (shared ? decodeWatch(shared) : loadWatch()));
  const [msg, setMsg] = useState('');
  const update = (next: WatchItem[]) => { setItems(next); if (!shared) saveWatch(next); };
  const link = absoluteUrl(href(route, 'watchlists', { w: encodeWatch(items) }));
  const feeds = useAsync(() => getOptional<{ diseases: string[]; places: string[] }>('feeds/index.json'), []);
  // A feed exists for a disease or a country once at least one official notice names it.
  const feedOf = (i: WatchItem) => (i.kind === 'place' && feeds.data?.places.includes(i.iso3!) ? dataUrl(`feeds/place/${i.iso3}.xml`) : i.kind === 'disease' && feeds.data?.diseases.includes(i.disease!) ? dataUrl(`feeds/disease/${i.disease}.xml`) : null);
  const label = (i: WatchItem) => (i.kind === 'place' ? `${placeName(core, i.iso3!)}${i.disease ? ' · ' + diseaseName(core, i.disease) : ''}` : i.kind === 'disease' ? diseaseName(core, i.disease!) : i.event!);
  const to = (i: WatchItem) => (i.kind === 'place' ? href(route, 'place/' + i.iso3, { d: i.disease }) : i.kind === 'disease' ? href(route, 'disease/' + i.disease) : href(route, 'outbreak/' + i.event));
  return (
    <>
      <h1>{t('watch.title')}</h1>
      <p class="lead">{t('watch.lead')}</p>
      {shared && <div class="notice pin">{t('watch.shared')} <button type="button" class="btn small" onClick={() => { saveWatch(items); navigate(href(route, 'watchlists')); }}>{t('watch.saveLocal')}</button></div>}
      <section class="card">
        {!items.length && <p class="muted">{t('watch.empty')}</p>}
        {items.length > 0 && <p class="small muted">{t('watch.feedNote')} <a href={dataUrl('feeds/all.xml')}>{t('watch.feedAll')}</a></p>}
        <ul class="list">{items.map((i) => <li key={encodeWatch([i])} class="row"><a href={to(i)}>{label(i)}</a>{feedOf(i) && <a class="small" href={feedOf(i)!} data-testid="watch-feed">{t('watch.feed')}</a>}<button type="button" class="btn small" onClick={() => update(items.filter((x) => !same(x, i)))}>{t('watch.remove')}</button></li>)}</ul>
        <div class="btnrow" style={{ marginTop: '10px' }}>
          <button type="button" class="btn" disabled={!items.length} onClick={async () => { await copyText(link); setMsg(t('action.copied')); }}>{t('watch.copyLink')}</button>
          <button type="button" class="btn" disabled={!items.length} onClick={() => download('watchlist.json', JSON.stringify({ format: 'understandingoutbreaks-watchlist', version: WATCH_VERSION, items }, null, 2), 'application/json')}>{t('watch.export')}</button>
          <label class="btn">{t('watch.import')}<input type="file" accept="application/json,.json" class="sr" onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
            try { update(parseWatchFile(await f.text())); setMsg(t('watch.imported')); } catch { setMsg(t('watch.badFile')); }
          }} /></label>
          <span role="status" class="small muted">{msg}</span>
        </div>
        <p class="small muted">{t('watch.privacy')}</p>
      </section>
    </>
  );
}

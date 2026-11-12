/** Link to the Atom feed of official notices for a disease, a country, or everything. Shown only when the feed
 *  exists (a feed is written once at least one official notice names the disease or country). */
import { dataUrl } from '../lib/app';
import { getOptional } from '../lib/data';
import { t } from '../lib/i18n';
import { useAsync } from './Layout';

let index: Promise<{ diseases: string[]; places: string[] } | null> | null = null;
export function loadFeedIndex() { index ??= getOptional<{ diseases: string[]; places: string[] }>('feeds/index.json'); return index; }

export function feedUrl(kind: 'disease' | 'place' | 'all', id?: string): string {
  return dataUrl(kind === 'all' ? 'feeds/all.xml' : `feeds/${kind}/${id}.xml`);
}

export function FeedLink({ kind, id, name }: { kind: 'disease' | 'place' | 'all'; id?: string; name?: string }) {
  const idx = useAsync(loadFeedIndex, []);
  const exists = kind === 'all' ? !!idx.data : kind === 'disease' ? idx.data?.diseases.includes(id!) : idx.data?.places.includes(id!);
  if (!exists) return null;
  return (
    <p class="small feedlink" data-testid="feed-link">
      <a href={feedUrl(kind, id)} type="application/atom+xml"><span class="feedico" aria-hidden="true">◉</span> {kind === 'all' ? t('watch.feedAll') : t('feed.subscribe', { name: name ?? id })}</a>
      {' '}<span class="muted">{t('feed.what')}</span>
    </p>
  );
}

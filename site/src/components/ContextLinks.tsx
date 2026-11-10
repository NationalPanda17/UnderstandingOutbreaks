/** Outbound context links (Nextstrain, official travel and health notices). Clearly external; nothing is loaded until clicked. */
import links from '../../../config/context_links.json';
import { t } from '../lib/i18n';
import { Ext } from './Layout';

export function ContextLinks({ iso3, disease }: { iso3?: string; disease?: string | null }) {
  const d = disease ? ((links.disease as Record<string, { label: string; url: string }[]>)[disease] ?? []) : [];
  const items = [...d, ...(disease ? links.all_diseases : []), ...(iso3 ? links.place.map((l) => ({ label: l.label, url: l.url.replace('{iso3_lower}', iso3.toLowerCase()) })) : [])];
  if (!items.length) return null;
  return (
    <section class="card" style={{ marginTop: '16px' }} data-testid="context-links">
      <h2>{t('context.title')}</h2>
      <p class="sub">{t('context.note')}</p>
      <ul class="list small">{items.map((l) => <li key={l.url}><Ext url={l.url}>{l.label}</Ext> <span class="badge">{t('context.external')}</span></li>)}</ul>
    </section>
  );
}

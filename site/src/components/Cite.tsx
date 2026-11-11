/** "Cite this view": one click copies a plain caption with the as-of date, the attribution line, the standing caveat
 *  and a link pinned to the snapshot the view was drawn from. */
import { useState } from 'preact/hooks';
import { citeText, copyText } from '../lib/exporters';
import { t } from '../lib/i18n';
import type { Prov } from '../lib/prov';
import { useApp } from './SourceChip';

export function CiteButton({ prov, title, subtitle }: { prov: Prov; title: string; subtitle?: string }) {
  const { core } = useApp();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" class="btn small" data-testid="cite-view" title={t('action.citeHint')}
      onClick={async () => { await copyText(citeText(core, prov, title, subtitle)); setOk(true); setTimeout(() => setOk(false), 1800); }}>
      {ok ? t('action.copied') : t('action.cite')}
    </button>
  );
}

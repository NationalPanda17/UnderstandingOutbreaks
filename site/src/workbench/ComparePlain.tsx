/** "What changed between two dates": the snapshot comparison without the SQL tooling around it.
 *  Loaded on demand (it shares the workbench chunk). */
import { href } from '../lib/app';
import { t } from '../lib/i18n';
import { useApp } from '../components/SourceChip';
import { Diff } from './Compare';

export default function ComparePlain() {
  const { route } = useApp();
  return (
    <>
      <h1>{t('datecompare.title')}</h1>
      <p class="lead">{t('datecompare.lead')}</p>
      <div class="notice" role="note">{t('datecompare.how')}</div>
      <Diff />
      <p class="small"><a href={href(route, 'changes')}>{t('nav.changes')}</a> · <a href={href(route, 'glossary') + '#revision'}>{t('datecompare.whatIsRevision')}</a></p>
    </>
  );
}

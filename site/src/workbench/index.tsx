/** Analysis workbench shell. This whole section is a lazily loaded chunk; heavy runtimes inside it load only on request. */
import { href } from '../lib/app';
import { t } from '../lib/i18n';
import { FirstUse } from '../components/Layout';
import { useApp } from '../components/SourceChip';
import { Diff, Linked, MapSelect, Overlay } from './Compare';
import { Notebooks } from './Notebooks';
import { Sql } from './Sql';
import { ChartBuilder, Pivot } from './Tables';

const TOOLS = ['sql', 'notebooks', 'pivot', 'chart-builder', 'linked', 'diff', 'map-select', 'overlay'] as const;

export default function Workbench({ parts }: { parts: string[] }) {
  const { route } = useApp();
  const tool = parts[0] ?? '';
  return (
    <>
      <h1>{t('workbench.title')}</h1>
      <p class="lead">{t('workbench.lead')}</p>
      <nav class="tabs" aria-label={t('workbench.tools')}>
        <a href={href(route, 'workbench')} aria-current={tool === '' ? 'page' : undefined}>{t('workbench.home')}</a>
        {TOOLS.map((x) => <a key={x} href={href(route, 'workbench/' + x)} aria-current={tool === x ? 'page' : undefined}>{t('workbench.tool.' + x)}</a>)}
      </nav>
      {tool !== '' && <FirstUse id={'wb-' + tool} title={t('firstuse.compare.title')}>{t('firstuse.compare.body')}</FirstUse>}
      {tool === '' && (
        <div class="grid three">
          {TOOLS.map((x) => <section class="card" key={x}><h2 style={{ fontSize: '1.05rem' }}><a href={href(route, 'workbench/' + x)}>{t('workbench.tool.' + x)}</a></h2><p class="small muted">{t('workbench.desc.' + x)}</p></section>)}
          <section class="card"><h2 style={{ fontSize: '1.05rem' }}>{t('workbench.privacyTitle')}</h2><p class="small muted">{t('workbench.privacy')}</p></section>
        </div>
      )}
      {tool === 'sql' && <Sql />}
      {tool === 'notebooks' && <Notebooks />}
      {tool === 'pivot' && <Pivot />}
      {tool === 'chart-builder' && <ChartBuilder />}
      {tool === 'linked' && <Linked />}
      {tool === 'diff' && <Diff />}
      {tool === 'map-select' && <MapSelect />}
      {tool === 'overlay' && <Overlay />}
    </>
  );
}

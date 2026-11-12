/** "Cite this": opens a panel with a ready-to-quote sentence, the source and data date, how the number was made in
 *  plain steps, and one-click copies of the caption and of a link pinned to the snapshot the figure was drawn from.
 *  Used on charts and maps (cite the view) and beside single figures (cite the number, with `statement`). */
import { useState } from 'preact/hooks';
import { citeText, citeUrl, copyText } from '../lib/exporters';
import { date, snapLabel, t } from '../lib/i18n';
import { chainFor, sourceLinks, type Prov } from '../lib/prov';
import { Dialog, PlainSteps, TracePanel, useApp } from './SourceChip';

export interface CiteProps {
  prov: Prov; title: string; subtitle?: string;
  /** The figure as one sentence, for a single number. Quoted source phrases stay verbatim. */
  statement?: string;
  /** Site path of the page that shows this figure, when it is not the current page. */
  url?: string;
  /** Text-style button for use inside a line of text. */
  inline?: boolean;
}

/** A world total as one sentence, always with how many countries it rests on. */
export function globalStatement(disease: string, period: string, value: string, metric: string, n: number | null | undefined, N: number | null | undefined): string {
  return n !== null && n !== undefined && N ? t('citep.stmt.global', { disease, period, value, metric, n, N }) : t('citep.stmt.globalNoN', { disease, period, value, metric });
}

export function CiteButton(props: CiteProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class={props.inline ? 'linklike citelink' : 'btn small'} data-testid={props.statement ? 'cite-number' : 'cite-view'} aria-haspopup="dialog"
        title={t('action.citeHint')} aria-label={`${props.statement ? t('citep.titleNumber') : t('action.cite')}: ${props.title}`} onClick={() => setOpen(true)}>{props.statement ? t('citep.button') : t('action.cite')}</button>
      {open && <CitePanel {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function CitePanel({ prov, title, subtitle, statement, url, onClose }: CiteProps & { onClose: () => void }) {
  const { core } = useApp();
  const [copied, setCopied] = useState('');
  const [trace, setTrace] = useState(false);
  if (trace) return <TracePanel prov={prov} onClose={onClose} />;
  const text = citeText(core, prov, title, subtitle, statement, url);
  const link = citeUrl(prov.snapshotId, url);
  const copy = async (what: string, value: string) => { if (await copyText(value)) { setCopied(what); setTimeout(() => setCopied(''), 1800); } };
  const metas = (prov.series ?? []).map((it) => core.seriesByKey[it.skey]).filter(Boolean);
  const steps = Array.from(new Map(metas.map((m) => [m.chain_id, m])).values()).flatMap((m) => chainFor(core, m).map((c) => c.op));
  const links = sourceLinks(core, prov).filter((l) => l.external);
  const auto = prov.method?.name === 'group_by_disease_place_gap';
  return (
    <Dialog title={statement ? t('citep.titleNumber') : t('citep.title')} onClose={onClose} modal>
      <p class="small muted">{t('citep.lead')}</p>
      <pre class="citebox" data-testid="cite-text" tabIndex={0} aria-label={t('citep.textLabel')}>{text}</pre>
      <div class="btnrow">
        <button type="button" class="btn primary" data-testid="cite-copy" onClick={() => copy('text', text)}>{copied === 'text' ? t('action.copied') : t('citep.copyText')}</button>
        <button type="button" class="btn" onClick={() => copy('link', link)}>{copied === 'link' ? t('action.copied') : t('citep.copyLink')}</button>
        <span role="status" class="sr">{copied ? t('action.copied') : ''}</span>
      </div>
      <dl class="citefacts">
        <dt>{t('citep.source')}</dt>
        <dd>{links.length ? links.map((l, i) => <span key={l.url}>{i > 0 && ' · '}<a class="ext" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>) : prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s).join(', ')}</dd>
        <dt>{prov.asOfKind === 'published' ? t('citep.latestNotice') : t('trace.asOf')}</dt><dd>{prov.asOf ? date(prov.asOf, 'long') : t('trace.notApplicable')}</dd>
        <dt>{t('trace.version')}</dt><dd title={prov.snapshotId}>{snapLabel(prov.snapshotId)}</dd>
      </dl>
      <PlainSteps prov={prov} />
      {steps.length > 0 && (
        <details class="more"><summary>{t('citep.steps', { n: steps.length })}</summary>
          <ol class="chain">{steps.map((op, i) => <li key={op + i}>{t('chain.' + op)}</li>)}</ol>
        </details>
      )}
      {auto && <p class="small"><span class="badge auto">{t('event.autoCheck')}</span> {t('citep.autoNote')}</p>}
      <p class="small muted">{t('citep.check')}</p>
      <p><button type="button" class="btn small" onClick={() => setTrace(true)}>{t('citep.fullTrace')}</button></p>
    </Dialog>
  );
}

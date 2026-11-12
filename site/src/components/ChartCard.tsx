/** A chart with everything the spec requires around it: source chip, "what this means", incomplete-period note,
 *  comparability warning, transform panel, table alternative, and export / embed / cite / copy-as-code actions. */
import { useMemo, useRef, useState } from 'preact/hooks';
import { SITE, absoluteUrl, href, setParams } from '../lib/app';
import { codeFor, type ViewSpec } from '../lib/codegen';
import { altText, caption, copyText, exportBundle, exportChartPack, exportImage, imageMeta, seriesRows, serializeSvg } from '../lib/exporters';
import { CiteButton } from './Cite';
import { DetailToggle, HowToRead } from './Layout';
import { date, num, periodLabel, smart, t, snapLabel } from '../lib/i18n';
import { provBlock, suggestedCitation, type Prov } from '../lib/prov';
import { activeTransformKeys, applyTransforms, transformsFromParam, transformsToParam, yearOverYear, type SeriesData, type TransformState } from '../lib/transforms';
import { Chart, PALETTE } from './Chart';
import { Dialog, SourceChip, useApp } from './SourceChip';
import { startTour } from './Tour';

export interface ChartCardProps {
  id: string;
  title: string;
  series: SeriesData[];
  prov: Prov;
  means?: string;
  yLabel?: string;
  disease?: string;
  embed?: { kind: string; params: Record<string, string> };
  marks?: { x: string; label: string }[];
  tours?: string[];
  defaultTransforms?: string;
  onRestrictComparable?: () => void;
  onBrush?: (from: string, to: string) => void;
  learnLink?: boolean;
  heading?: 'h2' | 'h3';
}

type View = 'line' | 'bars' | 'yoy' | 'heat' | 'table';

export function comparabilityIssues(series: SeriesData[], seriesByKey: Record<string, any>): { defs: string[]; sources: string[]; incomplete: boolean } {
  const metas = series.map((s) => (s.skey ? seriesByKey[s.skey] : null)).filter(Boolean);
  const defs = Array.from(new Set(metas.map((m: any) => m.case_definition)));
  const sources = Array.from(new Set(metas.map((m: any) => m.source_id)));
  const incomplete = series.some((s) => s.incompleteFrom && s.p.some((p) => p >= s.incompleteFrom!));
  return { defs, sources, incomplete };
}

export function ChartCard(props: ChartCardProps) {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const pkey = 'tf_' + props.id;
  const tr = useMemo<TransformState>(() => transformsFromParam(route.params.get(pkey) ?? props.defaultTransforms ?? ''), [route.params.get(pkey), props.defaultTransforms]);
  const setTr = (patch: Partial<TransformState>) => setParams({ [pkey]: transformsToParam({ ...tr, ...patch }) || (props.defaultTransforms ? 'none' : null) });
  const [view, setView] = useState<View>('line');
  const [dialog, setDialog] = useState<null | 'embed' | 'code' | 'api'>(null);
  const [lang, setLang] = useState<'python' | 'r' | 'sql'>('python');
  const [copied, setCopied] = useState('');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const H = props.heading ?? 'h2';

  const shown = useMemo(() => props.series.map((s) => applyTransforms(s, tr)), [props.series, tr]);
  const keys = activeTransformKeys(tr);
  const prov: Prov = useMemo(() => ({ ...props.prov, transforms: keys.filter((k) => k !== 'log'), origin: keys.some((k) => k !== 'log' && k !== 'excludeIncomplete') && props.prov.origin === 'source-reported' ? 'site-derived' : props.prov.origin }), [props.prov, keys.join()]);
  const subtitle = keys.length ? keys.map((k) => t('transform.' + k, { n: tr.rolling })).join(' · ') : t('transform.none');
  const issues = comparabilityIssues(props.series, core.seriesByKey);
  const mixedDefs = issues.defs.length > 1;
  const mixedSources = issues.sources.length > 1 && props.series.length > 1;
  const ptype = props.series[0]?.ptype ?? 'W';
  const canPerCapita = props.series.some((s) => s.population);
  const first = shown[0];
  // Annual series can be a year or two behind. People read titles, and screenshots drop captions, so the year goes in the title.
  const lastP = ptype === 'Y' ? props.series.flatMap((x) => x.p).sort().pop() : undefined;
  const title = lastP ? t('age.titleLatest', { title: props.title, year: lastP.slice(0, 4) }) : props.title;

  const spec = (): ViewSpec | null => {
    if (!props.disease) return null;
    const items = props.series.filter((s) => s.skey && s.iso3).map((s) => ({ seriesId: `${s.skey}.${s.iso3}`, label: s.label, population: s.population ?? null, incompleteFrom: s.incompleteFrom }));
    if (!items.length) return null;
    return { disease: props.disease, ptype, snapshot: prov.snapshotId, base: absoluteUrl(SITE.dataPath), items, transforms: tr, viewUrl: absoluteUrl(window.location.pathname + window.location.search), sources: prov.sourceIds.map((s) => core.sources[s]?.short_name ?? s) };
  };
  const embedUrl = () => {
    if (!props.embed) return '';
    const q = new URLSearchParams({ ...props.embed.params });
    if (transformsToParam(tr)) q.set('tf', transformsToParam(tr));
    if (analyst) q.set('mode', 'analyst');
    q.set('snapshot', prov.snapshotId);
    return absoluteUrl(`/embed/${route.locale}/${props.embed.kind}?${q.toString()}`);
  };
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1800); };
  const doImage = async (kind: 'svg' | 'png') => {
    if (!svgRef.current) { setView('line'); return; }
    const inner = serializeSvg(svgRef.current);
    const cap = caption(core, prov, title, subtitle);
    await exportImage(kind, inner, imageMeta(core, prov, title, subtitle), title, provBlock(core, prov), cap, altText(shown, title));
  };

  const doPack = async () => {
    if (!svgRef.current) { setView('line'); return; }
    const esc = (x: string) => (/[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x);
    const rows = ['series,period,value,likely_incomplete,sources,data_as_of,snapshot_id'];
    for (const s of shown) s.p.forEach((p, i) => rows.push([esc(s.label), p, s.v[i] === null ? '' : String(s.v[i]), s.incompleteFrom && p >= s.incompleteFrom ? 'yes' : 'no', esc(prov.sourceIds.join(';')), prov.asOf ?? '', prov.snapshotId].join(',')));
    await exportChartPack(serializeSvg(svgRef.current), imageMeta(core, prov, title, subtitle), title, provBlock(core, prov), caption(core, prov, title, subtitle), altText(shown, title), rows.join('\n') + '\n');
  };

  return (
    <section class="card" id={props.id} data-chart-card>
      <header>
        <div>
          <H>{title}</H>
          <p class="sub" data-testid="chart-subtitle">{subtitle}</p>
        </div>
        <SourceChip prov={prov} />
      </header>

      {(mixedDefs || mixedSources) && (
        <div class="notice warn" role="note" data-testid="comparability-warning">
          {mixedDefs && <div>{t('warn.mixedDefinitions', { defs: issues.defs.map((d) => t('def.' + d)).join(', ') })}</div>}
          {mixedSources && <div>{t('warn.mixedSources', { sources: issues.sources.map((s) => core.sources[s]?.short_name ?? s).join(', ') })}</div>}
          {props.onRestrictComparable && <button type="button" class="btn small" onClick={props.onRestrictComparable}>{t('warn.restrict')}</button>}
        </div>
      )}

      <div class="tools" role="group" aria-label={t('chart.viewOptions')}>
        <span class="seg" role="group" aria-label={t('chart.view')}>
          {(['line', 'bars', ...(ptype !== 'Y' ? ['yoy', 'heat'] : []), 'table'] as View[]).filter((v) => analyst || v === 'line' || v === 'table' || v === 'yoy').map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{t('view.' + v)}</button>
          ))}
        </span>
        {canPerCapita && <label><input type="checkbox" checked={tr.perCapita} onChange={(e) => setTr({ perCapita: (e.target as HTMLInputElement).checked })} /> {t('transform.perCapita')}</label>}
        <label><input type="checkbox" checked={tr.cumulative} onChange={(e) => setTr({ cumulative: (e.target as HTMLInputElement).checked })} /> {t('transform.cumulative')}</label>
        {analyst && (
          <>
            <label>{t('transform.rollingLabel')} <select value={String(tr.rolling)} onChange={(e) => setTr({ rolling: parseInt((e.target as HTMLSelectElement).value, 10) })}>
              {[0, 3, 4, 7, 12].map((n) => <option key={n} value={String(n)}>{n ? t('transform.rollingN', { n }) : t('transform.off')}</option>)}
            </select></label>
            <label><input type="checkbox" checked={tr.log} onChange={(e) => setTr({ log: (e.target as HTMLInputElement).checked })} /> {t('transform.log')}</label>
            <label><input type="checkbox" checked={tr.rebase} onChange={(e) => setTr({ rebase: (e.target as HTMLInputElement).checked })} /> {t('transform.rebase')}</label>
            <label><input type="checkbox" checked={tr.align} onChange={(e) => setTr({ align: (e.target as HTMLInputElement).checked })} /> {t('transform.align')}</label>
          </>
        )}
        {issues.incomplete && <label><input type="checkbox" checked={tr.excludeIncomplete} onChange={(e) => setTr({ excludeIncomplete: (e.target as HTMLInputElement).checked })} /> {t('transform.excludeIncomplete')}</label>}
      </div>

      {(view === 'line' || view === 'bars') && (
        <Chart series={shown} xMode={tr.align ? 'index' : 'time'} log={tr.log} yLabel={props.yLabel} xLabel={tr.align ? t('chart.sinceFirst') : undefined}
          ariaLabel={altText(shown, title)} svgRef={svgRef} marks={tr.align ? undefined : props.marks} onBrush={tr.align ? undefined : props.onBrush} bars={view === 'bars'} />
      )}
      {view === 'yoy' && first && <YearOverYear s={first} title={title} />}
      {view === 'heat' && first && <CalendarHeat s={first} title={title} />}
      {view === 'table' && <SeriesTable series={shown} />}

      {issues.incomplete && !tr.excludeIncomplete && (
        <p class="small muted" data-testid="incomplete-note"><span class="badge inc">{t('chart.incompleteShort')}</span> {t('chart.incompleteNote')}{' '}
          {props.learnLink !== false && <a href={href(route, 'learn/lesson/reporting-lag')}>{t('chart.whyLow')}</a>}</p>
      )}
      {props.means && <HowToRead><p>{props.means}</p></HowToRead>}

      <div class="btnrow" role="group" aria-label={t('chart.actions')}>
        <button type="button" class="btn small" onClick={() => setView(view === 'table' ? 'line' : 'table')}>{view === 'table' ? t('action.viewChart') : t('action.viewData')}</button>
        <button type="button" class="btn small" onClick={() => doImage('png')}>{t('action.png')}</button>
        <button type="button" class="btn small" onClick={() => doImage('svg')}>{t('action.svg')}</button>
        <CiteButton prov={prov} title={title} subtitle={subtitle} />
        <button type="button" class="btn small" onClick={doPack} data-testid="chart-pack">{t('action.chartPack')}</button>
        {props.embed && <button type="button" class="btn small" onClick={() => setDialog('embed')}>{t('action.embed')}</button>}
        {!analyst && !window.location.pathname.startsWith('/embed/') && <DetailToggle compact />}
        {analyst && (
          <>
            <button type="button" class="btn small" onClick={() => exportBundle(core, prov, seriesRows(core, shown.filter((s) => !s.userSupplied), prov), 'csv', title)}>{t('action.downloadCsv')}</button>
            <button type="button" class="btn small" onClick={() => exportBundle(core, prov, seriesRows(core, shown.filter((s) => !s.userSupplied), prov), 'json', title)}>{t('action.downloadJson')}</button>
            <button type="button" class="btn small" onClick={async () => { await copyText(suggestedCitation(core, prov)); flash('cite'); }}>{copied === 'cite' ? t('action.copied') : t('action.copyCitation')}</button>
            <button type="button" class="btn small" onClick={() => setDialog('api')}>{t('action.apiLink')}</button>
            {spec() && <button type="button" class="btn small" onClick={() => setDialog('code')}>{t('action.copyCode')}</button>}
            {props.disease && <a class="btn small" href={href(route, 'explorer', { d: props.disease, c: props.series.map((s) => s.iso3).filter(Boolean).join(',') })}>{t('action.openExplorer')}</a>}
          </>
        )}
        {(props.tours ?? []).map((id) => <button key={id} type="button" class="btn small" onClick={() => startTour(id, props.id)}>{t('tour.' + id + '.title')}</button>)}
      </div>

      {dialog === 'embed' && (
        <Dialog title={t('embed.title')} onClose={() => setDialog(null)} modal>
          <p>{t('embed.intro')}</p>
          <pre data-testid="embed-snippet">{`<iframe src="${embedUrl()}" title="${title.replace(/"/g, '&quot;')}" width="100%" height="520" style="border:1px solid #d9e1e3;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`}</pre>
          <button type="button" class="btn" onClick={async () => { await copyText(`<iframe src="${embedUrl()}" title="${title.replace(/"/g, '&quot;')}" width="100%" height="520" style="border:1px solid #d9e1e3;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`); flash('embed'); }}>{copied === 'embed' ? t('action.copied') : t('action.copy')}</button>
          <p class="small muted">{t('embed.pinned', { snapshot: snapLabel(prov.snapshotId) })}</p>
          <p class="small muted">{t('embed.privacy')}</p>
        </Dialog>
      )}
      {dialog === 'api' && (
        <Dialog title={t('action.apiLink')} onClose={() => setDialog(null)} modal>
          <p>{t('api.intro')}</p>
          <ul class="list small">
            {props.series.filter((s) => s.skey && s.iso3 && props.disease).map((s) => (
              <li key={s.id}>{s.label}: <a href={`${SITE.dataPath}/ts/${props.disease}/${s.iso3}.json`}><code>{SITE.dataPath}/ts/{props.disease}/{s.iso3}.json</code></a> · <a href={`${SITE.dataPath}/lineage/${props.disease}/${s.iso3}.json`}>{t('trace.lineageFile')}</a><br /><code>{s.skey}</code></li>
            ))}
            <li><a href={`${SITE.dataPath}/sources.json`}><code>{SITE.dataPath}/sources.json</code></a></li>
            <li><a href={`${SITE.dataPath}/snapshots/${prov.snapshotId}.json`}><code>{SITE.dataPath}/snapshots/{prov.snapshotId}.json</code></a></li>
          </ul>
        </Dialog>
      )}
      {dialog === 'code' && spec() && (
        <Dialog title={t('action.copyCode')} onClose={() => setDialog(null)} modal>
          <p>{t('code.intro', { snapshot: prov.snapshotId })}</p>
          <div class="tabs" role="tablist">
            {(['python', 'r', 'sql'] as const).map((l) => <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>{l === 'python' ? 'Python (pandas)' : l === 'r' ? 'R (tidyverse)' : 'SQL (DuckDB)'}</button>)}
          </div>
          <pre data-testid="code-snippet">{codeFor(lang, spec()!)}</pre>
          <div class="btnrow">
            <button type="button" class="btn" onClick={async () => { await copyText(codeFor(lang, spec()!)); flash('code'); }}>{copied === 'code' ? t('action.copied') : t('action.copy')}</button>
            {lang === 'sql' && <a class="btn" href={href(route, 'workbench/sql', { q: codeFor('sql', spec()!) })}>{t('code.openSql')}</a>}
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function SeriesTable({ series, maxRows = 400 }: { series: SeriesData[]; maxRows?: number }) {
  const periods = Array.from(new Set(series.flatMap((s) => s.p))).sort().reverse();
  const look = series.map((s) => new Map(s.p.map((p, i) => [p, s.v[i]])));
  const ptype = series[0]?.ptype ?? 'W';
  return (
    <div class="tablewrap" tabIndex={0} role="region" aria-label={t('table.label')}>
      <table class="data">
        <thead><tr><th scope="col">{t('table.period')}</th>{series.map((s) => <th scope="col" class="n" key={s.id}>{s.label}</th>)}</tr></thead>
        <tbody>
          {periods.slice(0, maxRows).map((p) => {
            const inc = series.some((s) => s.incompleteFrom && p >= s.incompleteFrom);
            return (
              <tr key={p} class={inc ? 'inc' : undefined}>
                <th scope="row">{/^\d{4}-\d{2}-\d{2}$/.test(p) ? periodLabel(p, ptype) : p}{inc && <> <span class="badge inc">{t('chart.incompleteShort')}</span></>}</th>
                {look.map((m, i) => <td class="n" key={i}>{m.has(p) && m.get(p) !== null ? smart(m.get(p) as number) : <span class="muted">{t('chart.noData')}</span>}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {periods.length > maxRows && <p class="small muted">{t('table.truncated', { n: maxRows, total: periods.length })}</p>}
    </div>
  );
}

function YearOverYear({ s, title }: { s: SeriesData; title: string }) {
  const years = yearOverYear(s.p, s.v, s.ptype).slice(-6);
  const series: SeriesData[] = years.map((y, i) => ({ id: String(y.year), label: String(y.year), p: y.x.map(String), v: y.v, ptype: s.ptype, color: i === years.length - 1 ? '#17272b' : PALETTE[i % PALETTE.length] }));
  return <Chart series={series} xMode="index" xLabel={s.ptype === 'M' ? t('chart.monthOfYear') : t('chart.weekOfYear')} ariaLabel={`${title}: ${t('view.yoy')}`} />;
}

const RAMP = ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'];
function CalendarHeat({ s, title }: { s: SeriesData; title: string }) {
  const years = yearOverYear(s.p, s.v, s.ptype).slice(-8);
  const max = Math.max(1, ...years.flatMap((y) => y.v.filter((x): x is number => x !== null)));
  const cols = s.ptype === 'M' ? 12 : 53;
  const cw = s.ptype === 'M' ? 44 : 12; const ch = 18; const L = 44;
  const W = L + cols * cw + 8; const H = years.length * ch + 26;
  return (
    <div class="chart" style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${t('view.heat')}`} style={{ minWidth: '560px' }} font-family="system-ui, sans-serif">
        <defs><pattern id="uo-miss" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f4f4f4" /><line x1="0" y1="0" x2="0" y2="5" stroke="#d2d2d2" stroke-width="1.5" /></pattern></defs>
        <rect width={W} height={H} fill="#fff" />
        {years.map((y, r) => (
          <g key={y.year}>
            <text x={L - 6} y={r * ch + 13} text-anchor="end" font-size="11" fill="#4a5b5f">{y.year}</text>
            {Array.from({ length: cols }, (_, c) => {
              const i = y.x.indexOf(c + 1); const v = i >= 0 ? y.v[i] : null;
              const fill = v === null ? 'url(#uo-miss)' : RAMP[Math.min(RAMP.length - 1, Math.floor((Math.sqrt(v) / Math.sqrt(max)) * (RAMP.length - 0.001)))];
              return <rect key={c} x={L + c * cw} y={r * ch} width={cw - 1} height={ch - 1} fill={fill}><title>{`${y.year} · ${c + 1}: ${v === null ? t('chart.noData') : num(v)}`}</title></rect>;
            })}
          </g>
        ))}
        <text x={L} y={H - 6} font-size="11" fill="#4a5b5f">{s.ptype === 'M' ? t('chart.monthOfYear') : t('chart.weekOfYear')} → · {t('chart.heatScale', { max: num(max) })}</text>
      </svg>
    </div>
  );
}

export function AsOfLine({ prov }: { prov: Prov }) {
  return <span class="small muted">{t('chip.asOf', { date: date(prov.asOf) })}</span>;
}

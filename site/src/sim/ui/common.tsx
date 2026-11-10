/** Shared sandbox UI: the persistent "illustrative simulation" banner, simulated chart card with watermark and exports,
 *  the worker hook (progress + cancel), lazy KaTeX, and simulation provenance. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE, absoluteUrl, href } from '../../lib/app';
import { altText, caption, copyText, download, exportImage, imageMeta, serializeSvg, slugify, toCSV, zip } from '../../lib/exporters';
import { num, t } from '../../lib/i18n';
import { provBlock, type Prov, type ProvCitation } from '../../lib/prov';
import type { SeriesData } from '../../lib/transforms';
import { Chart, SIM_PALETTE, type ChartProps } from '../../components/Chart';
import { SeriesTable } from '../../components/ChartCard';
import { Dialog, SourceChip, useApp } from '../../components/SourceChip';
import { pythonSim, rSim } from '../engine/docgen';
import { ENGINE_VERSION, SPEC_VERSION, specToParam, type ModelSpec } from '../engine/model';
import { METHOD_REFERENCES } from '../engine/presets';
import type { Job } from '../worker';

export const SIM_DISCLAIMER_KEYS = ['sim.banner', 'sim.notFitted'];

/** Persistent banner on every simulation view. */
export function SimBanner() {
  const { route } = useApp();
  return (
    <div class="notice sim" role="note" data-testid="sim-banner">
      {t('sim.banner')} <span style={{ fontWeight: 400 }}>{t('sim.bannerMore')}</span>{' '}
      <a href={href(route, 'learn/not-predictions')}>{t('learn.notPredictions')}</a>
    </div>
  );
}

export function simProv(title: string, spec: ModelSpec | null, extra: { solver?: string; seed?: number | null; citations?: ProvCitation[]; method?: string } = {}): Prov {
  return {
    title, origin: 'simulated', sourceIds: ['literature'], asOf: null, snapshotId: `engine-${ENGINE_VERSION}`,
    sim: { engineVersion: ENGINE_VERSION, specVersion: SPEC_VERSION, seed: extra.seed ?? spec?.seed ?? null, solver: extra.solver ?? spec?.solver.method ?? 'analytical', specUrl: spec ? absoluteUrl(`/en/learn/sim/basic?spec=${specToParam(spec)}`) : undefined },
    method: extra.method ? { name: extra.method, version: ENGINE_VERSION } : undefined,
    citations: extra.citations ?? METHOD_REFERENCES.slice(2, 6).map((c) => ({ text: c.text, doi: c.doi, verified: c.verified })),
    notes: [t('sim.banner'), t('sim.notFitted')],
  };
}

/** Run jobs in a Web Worker with progress and cancel. Cancelling terminates the worker and starts a fresh one. */
export function useSimWorker() {
  const ref = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (f: number) => void }>());
  const seq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const ensure = () => {
    if (!ref.current) {
      const w = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const p = pending.current.get(e.data.id); if (!p) return;
        if (e.data.progress !== undefined) { p.onProgress?.(e.data.progress); setProgress(e.data.progress); return; }
        pending.current.delete(e.data.id); if (!pending.current.size) setBusy(false);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
      };
      w.onerror = (e) => { pending.current.forEach((p) => p.reject(new Error(/memory/i.test(e.message) ? 'out-of-memory' : e.message || 'worker error'))); pending.current.clear(); setBusy(false); ref.current?.terminate(); ref.current = null; };
      ref.current = w;
    }
    return ref.current;
  };
  const call = <T,>(job: Job, opts: { timeoutMs?: number; onProgress?: (f: number) => void } = {}): Promise<T> => new Promise<T>((resolve, reject) => {
    const id = ++seq.current; setBusy(true); setProgress(0);
    const timer = setTimeout(() => { if (pending.current.has(id)) { cancel(); reject(new Error('timeout')); } }, opts.timeoutMs ?? 60000);
    pending.current.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); }, onProgress: opts.onProgress });
    ensure().postMessage({ id, job });
  });
  const cancel = () => { ref.current?.terminate(); ref.current = null; pending.current.forEach((p) => p.reject(new Error('cancelled'))); pending.current.clear(); setBusy(false); setProgress(0); };
  useEffect(() => () => { ref.current?.terminate(); }, []);
  return { call, cancel, busy, progress };
}

export function RunStatus({ busy, progress, onCancel, error }: { busy: boolean; progress: number; onCancel: () => void; error?: string }) {
  return (
    <div aria-live="polite">
      {busy && <div class="btnrow"><div class="progress" style={{ flex: 1 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div><button type="button" class="btn small" onClick={onCancel}>{t('sim.cancel')}</button></div>}
      {error && error !== 'cancelled' && <div class="notice warn" role="alert">{error === 'timeout' ? t('sim.err.timeout') : error === 'out-of-memory' ? t('sim.err.memory') : t('sim.err.generic', { msg: error })}</div>}
    </div>
  );
}

let katexPromise: Promise<any> | null = null;
/** Equations rendered with self-hosted KaTeX (loaded only when equations are shown). */
export function Tex({ tex, block }: { tex: string; block?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default ?? k);
    katexPromise.then((k) => { if (live) setHtml(k.renderToString(tex, { displayMode: !!block, throwOnError: false, output: 'htmlAndMathml' })); }).catch(() => live && setHtml(null));
    return () => { live = false; };
  }, [tex]);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{tex}</code>;
}

export interface SimCardProps extends Omit<ChartProps, 'ariaLabel' | 'series' | 'svgRef'> {
  id: string;
  title: string;
  series: SeriesData[];
  spec?: ModelSpec | null;
  prov: Prov;
  means?: string;
  subtitle?: string;
  result?: unknown;
  embed?: boolean;
  heading?: 'h2' | 'h3';
  extraRows?: Record<string, string | number | null>[];
}

/** A simulated chart: dashed lines, distinct palette, SIMULATED labels, watermark in the chart and in every export. */
export function SimChartCard(p: SimCardProps) {
  const { core, route } = useApp();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [table, setTable] = useState(false);
  const [dialog, setDialog] = useState<null | 'code' | 'embed'>(null);
  const [lang, setLang] = useState<'python' | 'r'>('python');
  const [copied, setCopied] = useState('');
  const H = p.heading ?? 'h3';
  const series = useMemo(() => p.series.map((s, i) => ({ ...s, simulated: s.userSupplied ? false : s.simulated !== false, color: s.color ?? SIM_PALETTE[i % SIM_PALETTE.length] })), [p.series]);
  const sub = p.subtitle ?? (p.spec ? t('sim.subtitle', { solver: t('solver.' + p.spec.solver.method), seed: p.spec.seed === null ? '–' : String(p.spec.seed), engine: ENGINE_VERSION }) : t('sim.subtitleEngine', { engine: ENGINE_VERSION }));
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1600); };
  const params = p.spec ? Object.entries(p.spec.parameters).map(([k, v]) => `${k}=${Number(v.value.toPrecision(4))}`).join(', ') : '';
  const cap = () => `${caption(core, p.prov, p.title, sub)}${params ? ' Parameters: ' + params + '.' : ''}`;
  const image = async (kind: 'png' | 'svg') => {
    if (!svgRef.current) return;
    const meta = imageMeta(core, p.prov, p.title, sub + (params ? ` · ${params}` : ''));
    await exportImage(kind, serializeSvg(svgRef.current), meta, p.title, { ...provBlock(core, p.prov), model_spec: p.spec ?? undefined }, cap(), `${t('sim.banner')} ${altText(series, p.title)}`);
  };
  const exportRun = () => {
    const rows = series.flatMap((s) => s.p.map((x, i) => ({ series: s.label, t: x, value: s.v[i], origin_type: 'simulated', engine_version: ENGINE_VERSION, seed: p.spec?.seed ?? '', solver: p.spec?.solver.method ?? '' })));
    const base = slugify(p.title);
    download(`${base}.zip`, zip([
      { name: `${base}.csv`, data: toCSV([...rows, ...(p.extraRows ?? [])]) },
      { name: `${base}.json`, data: JSON.stringify({ disclaimer: t('sim.banner'), origin_type: 'simulated', engine_version: ENGINE_VERSION, spec_version: SPEC_VERSION, seed: p.spec?.seed ?? null, solver: p.spec?.solver ?? null, spec: p.spec ?? null, results: p.result ?? rows }, null, 1) },
      { name: `${base}.provenance.json`, data: JSON.stringify({ ...provBlock(core, p.prov), model_spec: p.spec ?? undefined }, null, 2) },
    ]), 'application/zip');
  };
  const embedUrl = p.spec ? absoluteUrl(`/embed/${route.locale}/sim?spec=${specToParam(p.spec)}`) : '';
  return (
    <section class="card simwrap" id={p.id} data-sim-card>
      <header><div><H>{p.title} <span class="badge sim">{t('sim.simulated')}</span></H><p class="sub" data-testid="sim-subtitle">{sub}</p></div><SourceChip prov={p.prov} /></header>
      {!table && <Chart {...p} series={series} xMode={p.xMode ?? 'index'} xLabel={p.xLabel ?? t('sim.dayAxis')} ariaLabel={`${t('sim.banner')} ${altText(series, p.title)}`} svgRef={svgRef} simulated />}
      {table && <SeriesTable series={series} />}
      {p.means && <p class="means">{p.means}</p>}
      <div class="btnrow">
        <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewChart') : t('action.viewData')}</button>
        <button type="button" class="btn small" onClick={() => image('png')}>{t('action.png')}</button>
        <button type="button" class="btn small" onClick={() => image('svg')}>{t('action.svg')}</button>
        <button type="button" class="btn small" onClick={exportRun}>{t('sim.exportRun')}</button>
        <button type="button" class="btn small" onClick={async () => { await copyText(cap()); flash('cap'); }}>{copied === 'cap' ? t('action.copied') : t('action.copyCaption')}</button>
        {p.spec && <button type="button" class="btn small" onClick={() => setDialog('code')}>{t('action.copyCode')}</button>}
        {p.spec && <button type="button" class="btn small" onClick={async () => { await copyText(absoluteUrl(href(route, 'learn/sim/basic', { spec: specToParam(p.spec!) }))); flash('share'); }}>{copied === 'share' ? t('action.copied') : t('sim.share')}</button>}
        {p.spec && p.embed !== false && <button type="button" class="btn small" onClick={() => setDialog('embed')}>{t('action.embed')}</button>}
      </div>
      {dialog === 'code' && p.spec && (
        <Dialog title={t('action.copyCode')} onClose={() => setDialog(null)} modal>
          <p>{t('sim.codeIntro')}</p>
          <div class="tabs" role="tablist">{(['python', 'r'] as const).map((l) => <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>{l === 'python' ? 'Python (scipy)' : 'R (deSolve)'}</button>)}</div>
          <pre data-testid="sim-code">{lang === 'python' ? pythonSim(p.spec) : rSim(p.spec)}</pre>
          <button type="button" class="btn" onClick={async () => { await copyText(lang === 'python' ? pythonSim(p.spec!) : rSim(p.spec!)); flash('code'); }}>{copied === 'code' ? t('action.copied') : t('action.copy')}</button>
        </Dialog>
      )}
      {dialog === 'embed' && (
        <Dialog title={t('embed.title')} onClose={() => setDialog(null)} modal>
          <p>{t('sim.embedIntro')}</p>
          <pre data-testid="embed-snippet">{`<iframe src="${embedUrl}" title="${p.title} (illustrative simulation)" width="100%" height="560" style="border:1px dashed #6a3d9a;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></iframe>`}</pre>
          <p class="small muted">{t('embed.privacy')}</p>
        </Dialog>
      )}
    </section>
  );
}

export function Slider({ label, value, min, max, step, onChange, unit, id }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; id: string }) {
  return (
    <label for={id}>{label}: <output for={id}>{num(value, { maximumFractionDigits: 3 })}{unit ? ' ' + unit : ''}</output>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </label>
  );
}

export function toSim(label: string, t: number[], v: (number | null)[], extra: Partial<SeriesData> = {}): SeriesData {
  return { id: label, label, p: t.map(String), v, ptype: 'W', simulated: true, ...extra };
}
export const SITE_NAME = SITE.name;

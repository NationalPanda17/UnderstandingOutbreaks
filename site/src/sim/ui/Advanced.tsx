/** Tier S3 tools. Each explores a model; none estimates reality. Heavy tools state their limits and recommend a larger screen. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { num, smart, t } from '../../lib/i18n';
import { copyText } from '../../lib/exporters';
import { LazyMap } from '../../components/LazyMap';
import { FirstUse } from '../../components/Layout';
import { SourceChip, useApp } from '../../components/SourceChip';
import { herdImmunityThreshold } from '../engine/analysis';
import { equationsTex, flowDiagramSvg, pythonNetwork } from '../engine/docgen';
import { METAPOP_LIMIT, NETWORK_LIMIT, couplingMatrix, histogram, linspace, metapopSpec, type Coupling, type EnsembleResult, type GraphKind, type Patch } from '../engine/extras';
import { LIMITS, SPEC_VERSION, compile, validateSpec, type ModelSpec } from '../engine/model';
import { DEFAULTS, buildModel, type Options } from '../engine/templates';
import { RunStatus, SimBanner, SimChartCard, Slider, Tex, simProv, toSim, useSimWorker } from './common';
import { ModelDocs, useRun, type RunOut } from './Sandbox';

const isSmall = () => typeof window !== 'undefined' && window.innerWidth < 720;
function Heavy({ id }: { id: string }) {
  return <>{isSmall() && <div class="notice warn" role="note" data-testid="small-screen">{t('sim.smallScreen')}</div>}<FirstUse id={'sim-' + id} kind="sim" title={t('firstuse.sim.title')}>{t('firstuse.sim.body')}</FirstUse></>;
}
function Bars({ data, label, xLabel }: { data: { x: string; y: number }[]; label: string; xLabel?: string }) {
  const W = 520; const H = 180; const max = Math.max(1e-9, ...data.map((d) => d.y)); const bw = (W - 50) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto' }} font-family="system-ui, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      {data.map((d, i) => <rect key={i} x={40 + i * bw} y={H - 28 - (d.y / max) * (H - 44)} width={Math.max(1, bw - 1)} height={(d.y / max) * (H - 44)} fill="#6a3d9a" opacity="0.75" stroke="#6a3d9a" stroke-dasharray="3 2"><title>{`${d.x}: ${smart(d.y)}`}</title></rect>)}
      <line x1="40" x2={W - 8} y1={H - 28} y2={H - 28} stroke="#9aa8ab" />
      <text x="40" y={H - 12} font-size="10" fill="#4a5b5f">{data[0]?.x}</text><text x={W - 8} y={H - 12} font-size="10" fill="#4a5b5f" text-anchor="end">{data[data.length - 1]?.x}</text>
      {xLabel && <text x={W / 2} y={H - 2} font-size="10" fill="#4a5b5f" text-anchor="middle">{xLabel}</text>}
      <text x={W - 8} y="12" font-size="10" font-weight="700" fill="#6a3d9a" text-anchor="end">{t('sim.watermarkShort')}</text>
    </svg>
  );
}
const table = (rows: (string | number)[][], head: string[], cap: string) => (
  <details class="more"><summary>{t('action.viewData')}</summary><div class="tablewrap"><table class="data"><caption class="sr">{cap}</caption><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0, 300).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} class={typeof c === 'number' ? 'n' : undefined}>{typeof c === 'number' ? smart(c) : c}</td>)}</tr>)}</tbody></table></div></details>
);

// ---------------------------------------------------------------- ensembles

export function Ensemble() {
  const cap = isSmall() ? 100 : 500;
  const [o, setO] = useState<Options>({ ...DEFAULTS, N: 2000, I0: 2, R0: 1.6, solver: 'tau-leap', seed: 1, days: 200 });
  const [runs, setRuns] = useState(100);
  const [ens, setEns] = useState<EnsembleResult | null>(null);
  const [err, setErr] = useState('');
  const w = useSimWorker();
  const spec = useMemo(() => buildModel(o), [o]);
  const go = () => { setErr(''); w.call<EnsembleResult>({ kind: 'ensemble', spec, runs: Math.min(runs, cap) }, { timeoutMs: 120000 }).then(setEns).catch((e) => setErr(e.message)); };
  const prov = simProv(t('ens.title'), spec, { method: 'stochastic_ensemble' });
  return (
    <>
      <Heavy id="ensemble" />
      <section class="card simwrap">
        <div class="sliders">
          <Slider id="e-r0" label={t('param.R0')} value={o.R0} min={0.5} max={6} step={0.05} onChange={(v) => setO({ ...o, R0: v })} />
          <Slider id="e-n" label={t('param.N')} value={o.N} min={100} max={isSmall() ? 20000 : 200000} step={100} onChange={(v) => setO({ ...o, N: v })} />
          <Slider id="e-i0" label={t('param.I0')} value={o.I0} min={1} max={50} step={1} onChange={(v) => setO({ ...o, I0: v })} />
          <Slider id="e-runs" label={t('ens.runs')} value={Math.min(runs, cap)} min={10} max={cap} step={10} onChange={setRuns} />
          <label>{t('sim.solver')} <select value={o.solver} onChange={(e) => setO({ ...o, solver: (e.target as HTMLSelectElement).value as any })}>{(['tau-leap', 'chain-binomial', 'gillespie'] as const).map((s) => <option key={s} value={s}>{t('solver.' + s)}</option>)}</select></label>
          <label>{t('sim.seed')} <input type="number" min={0} value={o.seed ?? 1} style={{ width: '7em' }} onInput={(e) => setO({ ...o, seed: Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)) })} /></label>
        </div>
        <p class="small muted">{t('ens.limits', { runs: cap, pop: num(LIMITS.stochasticPopulation) })}</p>
        <button type="button" class="btn primary" onClick={go} disabled={w.busy}>{t('ens.run')}</button>
        <RunStatus busy={w.busy} progress={w.progress} onCancel={w.cancel} error={err} />
      </section>
      {ens && (
        <>
          <div class="readouts"><div>{t('ens.extinction')}<b>{num(ens.extinctionProbability, { style: 'percent', maximumFractionDigits: 0 })}</b><span>{t('ens.extinctNote', { n: num(ens.extinctThreshold, { maximumFractionDigits: 0 }) })}</span></div><div>{t('ens.medianFinal')}<b>{num(ens.convergence[ens.convergence.length - 1], { maximumFractionDigits: 0 })}</b></div><div>{t('ens.se')}<b>{num(ens.standardError, { maximumFractionDigits: 1 })}</b></div><div>{t('ens.runsDone')}<b>{ens.runs}</b></div></div>
          <SimChartCard id="ens-chart" title={t('ens.chartTitle', { n: ens.runs })} spec={spec} prov={prov} embed={false} result={ens} heading="h2"
            series={[toSim(t('ens.median'), ens.t, ens.median)]} ribbons={[{ id: t('ens.median'), lo: ens.lo, hi: ens.hi }, { id: t('ens.median'), lo: ens.lo50, hi: ens.hi50 }]} means={t('ens.means')} />
          <div class="grid two" style={{ marginTop: '16px' }}>
            <section class="card simwrap"><h3>{t('ens.sizeDist')}</h3><Bars label={t('ens.sizeDist')} xLabel={t('ens.sizeAxis')} data={histogram(ens.finalSizes, 24).map((b) => ({ x: num(b.x0, { maximumFractionDigits: 0 }), y: b.n }))} /></section>
            <section class="card simwrap"><h3>{t('ens.timeDist')}</h3><Bars label={t('ens.timeDist')} xLabel={t('ens.timeAxis')} data={histogram(ens.peakDays, 24).map((b) => ({ x: num(b.x0, { maximumFractionDigits: 0 }), y: b.n }))} /></section>
          </div>
          <SimChartCard id="ens-conv" title={t('ens.convTitle')} spec={spec} prov={prov} embed={false} compact xLabel={t('ens.convAxis')} series={[toSim(t('ens.medianFinal'), ens.convergence.map((_, i) => i + 1), ens.convergence)]} means={t('ens.convMeans')} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- branching / superspreading

export function Branching() {
  const [R, setR] = useState(1.5); const [k, setK] = useState(0.2); const [poisson, setPoisson] = useState(false); const [seed, setSeed] = useState(1);
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  const w = useSimWorker();
  useEffect(() => { const h = setTimeout(() => { setErr(''); w.call({ kind: 'branching', R, k: poisson ? null : k, runs: isSmall() ? 2000 : 5000, seed }).then(setRes).catch((e) => e.message !== 'cancelled' && setErr(e.message)); }, 150); return () => clearTimeout(h); }, [R, k, poisson, seed]);
  const prov = simProv(t('branch.title'), null, { solver: 'branching-process', seed, method: 'branching_process' });
  return (
    <>
      <Heavy id="branching" />
      <section class="card simwrap">
        <div class="sliders">
          <Slider id="b-r" label={t('branch.R')} value={R} min={0.2} max={6} step={0.05} onChange={setR} />
          <Slider id="b-k" label={t('branch.k')} value={k} min={0.02} max={10} step={0.02} onChange={setK} />
          <label><input type="checkbox" checked={poisson} onChange={(e) => setPoisson((e.target as HTMLInputElement).checked)} /> {t('branch.poisson')}</label>
          <label>{t('sim.seed')} <input type="number" min={0} value={seed} style={{ width: '7em' }} onInput={(e) => setSeed(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)))} /></label>
        </div>
        <RunStatus busy={w.busy} progress={w.progress} onCancel={w.cancel} error={err} />
        <SourceChip prov={prov} />
      </section>
      {res && (
        <>
          <div class="readouts"><div>{t('branch.q')}<b>{num(res.q, { style: 'percent', maximumFractionDigits: 1 })}</b><span>{t('branch.qSim', { v: num(res.extinct, { style: 'percent', maximumFractionDigits: 1 }) })}</span></div><div>{t('branch.top20')}<b>{num(res.top20, { style: 'percent', maximumFractionDigits: 0 })}</b></div><div>{t('branch.zero')}<b>{num(res.pmf[0], { style: 'percent', maximumFractionDigits: 0 })}</b></div></div>
          <div class="grid two">
            <section class="card simwrap"><h3>{t('branch.offspring')} <span class="badge sim">{t('sim.simulated')}</span></h3><Bars label={t('branch.offspring')} xLabel={t('branch.offspringAxis')} data={(res.pmf as number[]).slice(0, 21).map((y, i) => ({ x: String(i), y }))} /></section>
            <section class="card simwrap"><h3>{t('branch.sizes')} <span class="badge sim">{t('sim.simulated')}</span></h3><Bars label={t('branch.sizes')} xLabel={t('branch.sizesAxis')} data={histogram((res.sizes as number[]).map((s) => Math.log10(s)), 20).map((b) => ({ x: num(10 ** b.x0, { maximumFractionDigits: 0 }), y: b.n }))} /></section>
          </div>
          <p class="means">{t('branch.means')}</p>
          {table((res.pmf as number[]).slice(0, 21).map((y, i) => [i, y]), [t('branch.offspringAxis'), t('branch.prob')], t('branch.offspring'))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- sweeps and sensitivity

const SWEEPABLE: (keyof Options)[] = ['R0', 'infectiousDays', 'incubationDays', 'vaxCoverage', 'vaxEfficacy', 'reduce', 'reduceStart', 'I0'];
const RANGE: Record<string, [number, number]> = { R0: [0.8, 6], infectiousDays: [2, 12], incubationDays: [1, 10], vaxCoverage: [0, 0.95], vaxEfficacy: [0.3, 1], reduce: [0, 0.8], reduceStart: [0, 80], I0: [1, 100] };
const RAMP = ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#4a1486'];

export function Sweeps() {
  const [template, setTemplate] = useState<'SIR' | 'SEIR'>('SEIR');
  const [px, setPx] = useState<keyof Options>('R0'); const [py, setPy] = useState<keyof Options>('vaxCoverage');
  const [outcome, setOutcome] = useState<'attack' | 'peak' | 'peakDay'>('attack');
  const [two, setTwo] = useState<any>(null); const [one, setOne] = useState<any>(null); const [sens, setSens] = useState<any>(null); const [err, setErr] = useState('');
  const w = useSimWorker();
  const base: Options = { ...DEFAULTS, template, days: 400, reduceEnd: 400 };
  const n = isSmall() ? 12 : 22;
  const go = async () => {
    setErr('');
    try {
      const xs = linspace(RANGE[px][0], RANGE[px][1], n); const ys = linspace(RANGE[py][0], RANGE[py][1], n);
      setOne(await w.call({ kind: 'sweep1', args: [base, px, linspace(RANGE[px][0], RANGE[px][1], 40), outcome] }));
      setTwo(await w.call({ kind: 'sweep2', args: [base, px, xs, py, ys, outcome] }, { timeoutMs: 120000 }));
      setSens(await w.call({ kind: 'sensitivity', args: [base, SWEEPABLE.filter((k) => k !== 'I0').map((k) => ({ param: k, min: RANGE[k][0], max: RANGE[k][1] })), isSmall() ? 80 : 200, outcome, 1] }, { timeoutMs: 120000 }));
    } catch (e: any) { if (e.message !== 'cancelled') setErr(e.message); }
  };
  const prov = simProv(t('sweep.title'), buildModel(base), { method: 'parameter_sweep' });
  const zmax = two ? Math.max(...two.z.flat()) : 1;
  return (
    <>
      <Heavy id="sweeps" />
      <section class="card simwrap">
        <p class="small">{t('sweep.frame')}</p>
        <div class="tools">
          <label>{t('sim.model')} <select value={template} onChange={(e) => setTemplate((e.target as HTMLSelectElement).value as any)}><option value="SIR">{t('template.SIR')}</option><option value="SEIR">{t('template.SEIR')}</option></select></label>
          <label>{t('sweep.x')} <select value={px} onChange={(e) => setPx((e.target as HTMLSelectElement).value as any)}>{SWEEPABLE.map((k) => <option key={k} value={k}>{t('param.' + k)}</option>)}</select></label>
          <label>{t('sweep.y')} <select value={py} onChange={(e) => setPy((e.target as HTMLSelectElement).value as any)}>{SWEEPABLE.filter((k) => k !== px).map((k) => <option key={k} value={k}>{t('param.' + k)}</option>)}</select></label>
          <label>{t('sweep.outcome')} <select value={outcome} onChange={(e) => setOutcome((e.target as HTMLSelectElement).value as any)}>{['attack', 'peak', 'peakDay'].map((k) => <option key={k} value={k}>{t('outcome.' + k)}</option>)}</select></label>
          <button type="button" class="btn primary" onClick={go} disabled={w.busy}>{t('sweep.run')}</button>
        </div>
        <RunStatus busy={w.busy} progress={w.progress} onCancel={w.cancel} error={err} />
      </section>
      {one && <SimChartCard id="sweep-one" title={t('sweep.oneTitle', { outcome: t('outcome.' + outcome), x: t('param.' + px) })} prov={prov} embed={false} xLabel={t('param.' + px)} series={[toSim(t('outcome.' + outcome), one.x, one.y)]} means={t('sweep.oneMeans')} result={one} />}
      {two && (
        <section class="card simwrap" style={{ marginTop: '16px' }}>
          <header><h3>{t('sweep.twoTitle', { outcome: t('outcome.' + outcome), x: t('param.' + px), y: t('param.' + py) })} <span class="badge sim">{t('sim.simulated')}</span></h3><SourceChip prov={prov} /></header>
          <svg viewBox="0 0 560 380" role="img" aria-label={t('sweep.twoTitle', { outcome: t('outcome.' + outcome), x: t('param.' + px), y: t('param.' + py) })} style={{ width: '100%', maxWidth: '640px', height: 'auto' }} font-family="system-ui, sans-serif">
            <rect width="560" height="380" fill="#fff" />
            {two.z.map((row: number[], j: number) => row.map((v, i) => <rect key={`${i}-${j}`} x={60 + (i * 480) / two.xs.length} y={330 - ((j + 1) * 300) / two.ys.length} width={480 / two.xs.length + 0.5} height={300 / two.ys.length + 0.5} fill={RAMP[Math.min(RAMP.length - 1, Math.floor((v / (zmax || 1)) * (RAMP.length - 0.001)))]}><title>{`${t('param.' + px)} ${smart(two.xs[i])}, ${t('param.' + py)} ${smart(two.ys[j])}: ${smart(v)}`}</title></rect>))}
            <text x="300" y="368" text-anchor="middle" font-size="11" fill="#4a5b5f">{t('param.' + px)} ({smart(two.xs[0])} – {smart(two.xs[two.xs.length - 1])})</text>
            <text x="16" y="180" text-anchor="middle" font-size="11" fill="#4a5b5f" transform="rotate(-90 16 180)">{t('param.' + py)} ({smart(two.ys[0])} – {smart(two.ys[two.ys.length - 1])})</text>
            <text x="540" y="18" text-anchor="end" font-size="10" font-weight="700" fill="#6a3d9a">{t('sim.watermarkShort')}</text>
          </svg>
          <p class="small muted">{t('sweep.scale', { max: smart(zmax) })}</p>
          {table(two.ys.flatMap((y: number, j: number) => two.xs.map((x: number, i: number) => [x, y, two.z[j][i]])), [t('param.' + px), t('param.' + py), t('outcome.' + outcome)], t('sweep.title'))}
        </section>
      )}
      {sens && (
        <div class="grid two" style={{ marginTop: '16px' }}>
          <section class="card simwrap"><h3>{t('sens.prcc')} <span class="badge sim">{t('sim.simulated')}</span></h3>
            <table class="data"><thead><tr><th>{t('doc.param')}</th><th class="n">PRCC</th><th>{t('sens.direction')}</th></tr></thead><tbody>{Object.entries(sens.prcc as Record<string, number>).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => <tr key={k}><th scope="row">{t('param.' + k)}</th><td class="n">{v.toFixed(2)}</td><td><span style={{ display: 'inline-block', height: '10px', width: `${Math.abs(v) * 120}px`, background: v >= 0 ? '#6a3d9a' : '#b15928' }} /> {v >= 0 ? t('sens.raises') : t('sens.lowers')}</td></tr>)}</tbody></table>
            <p class="small muted">{t('sens.note', { n: sens.n, seed: sens.seed })}</p></section>
          <section class="card simwrap"><h3>{t('sens.tornado')} <span class="badge sim">{t('sim.simulated')}</span></h3>
            <table class="data"><thead><tr><th>{t('doc.param')}</th><th class="n">{t('sens.low')}</th><th class="n">{t('sens.high')}</th><th>{t('sens.span')}</th></tr></thead><tbody>{(sens.tornado as any[]).map((r) => <tr key={r.param}><th scope="row">{t('param.' + r.param)}</th><td class="n">{smart(r.low)}</td><td class="n">{smart(r.high)}</td><td><span style={{ display: 'inline-block', height: '10px', width: `${(Math.abs(r.high - r.low) / (Math.abs(sens.tornado[0].high - sens.tornado[0].low) || 1)) * 140}px`, background: '#6a3d9a' }} /></td></tr>)}</tbody></table>
            <p class="small muted">{t('sens.baseline', { v: smart(sens.baseline) })}</p></section>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- phase plane and bifurcation

export function Phase() {
  const [o, setO] = useState<Options>({ ...DEFAULTS, template: 'SIRS', R0: 3, waningDays: 200, days: 1500, dt: 2, lifeYears: 0 });
  const spec = useMemo(() => buildModel(o), [o]);
  const { out, error, busy, progress, cancel, call } = useRun(spec);
  const [bif, setBif] = useState<any>(null);
  useEffect(() => { const h = setTimeout(() => { call({ kind: 'bifurcation', args: [o, linspace(0.4, 5, isSmall() ? 20 : 47)] }, { timeoutMs: 120000 }).then(setBif).catch(() => undefined); }, 300); return () => clearTimeout(h); }, [o.template, o.waningDays, o.lifeYears, o.infectiousDays]);
  const N = o.N; const prov = simProv(t('phase.title'), spec, { method: 'phase_plane' });
  const endemicS = 1 / o.R0; const stableDfe = o.R0 <= 1;
  return (
    <>
      <Heavy id="phase" />
      <section class="card simwrap">
        <div class="sliders">
          <label>{t('sim.model')} <select value={o.template + (o.lifeYears ? '+d' : '')} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setO({ ...o, template: v.replace('+d', '') as any, lifeYears: v.endsWith('+d') ? 20 : 0, days: v.endsWith('+d') ? 3650 : 1500, dt: v.endsWith('+d') ? 5 : 2 }); }}><option value="SIS">{t('template.SIS')}</option><option value="SIRS">{t('template.SIRS')}</option><option value="SIR+d">{t('phase.sirDemog')}</option></select></label>
          <Slider id="p-r0" label={t('param.R0')} value={o.R0} min={0.4} max={8} step={0.05} onChange={(v) => setO({ ...o, R0: v })} />
          {o.template === 'SIRS' && <Slider id="p-w" label={t('param.waningDays')} value={o.waningDays} min={20} max={1000} step={10} onChange={(v) => setO({ ...o, waningDays: v })} />}
          {o.lifeYears > 0 && <Slider id="p-l" label={t('param.lifeYears')} value={o.lifeYears} min={2} max={80} step={1} onChange={(v) => setO({ ...o, lifeYears: v })} />}
        </div>
        <RunStatus busy={busy} progress={progress} onCancel={cancel} error={error} />
      </section>
      {out && (
        <div class="grid two" style={{ marginTop: '16px' }}>
          <SimChartCard id="phase-plane" title={t('phase.planeTitle')} spec={spec} prov={prov} embed={false} xLabel={t('phase.sAxis')} yLabel={t('phase.iAxis')}
            series={[{ ...toSim(t('phase.trajectory'), [], []), p: out.res.y.S.map((s) => String(s / N)), v: out.infectious.map((i) => i / N) }]}
            marks={o.template !== 'SIS' && o.R0 > 1 ? [{ x: endemicS, label: t('phase.endemicS') }] : undefined}
            means={t('phase.means', { state: stableDfe ? t('phase.dfeStable') : t('phase.dfeUnstable'), s: num(endemicS, { maximumFractionDigits: 3 }) })} />
          {bif && <SimChartCard id="phase-bif" title={t('phase.bifTitle')} spec={spec} prov={prov} embed={false} xLabel={t('param.R0')} yLabel={t('phase.endemicAxis')} series={[toSim(t('phase.endemic'), bif.R0, bif.endemic)]} marks={[{ x: 1, label: 'R0 = 1' }]} means={t('phase.bifMeans')} result={bif} />}
        </div>
      )}
      {out && <div class="readouts"><div>{t('phase.dfe')}<b>{stableDfe ? t('phase.stable') : t('phase.unstable')}</b></div><div>{t('phase.endemicEq')}<b>{o.R0 > 1 ? t('phase.exists') : t('phase.none')}</b><span>{o.R0 > 1 && o.template !== 'SIS' ? `S*/N = ${num(endemicS, { maximumFractionDigits: 3 })}` : o.R0 > 1 ? `I*/N = ${num(1 - 1 / o.R0, { maximumFractionDigits: 3 })}` : ''}</span></div><div>{t('read.hit')}<b>{num(herdImmunityThreshold(o.R0), { style: 'percent', maximumFractionDigits: 0 })}</b></div></div>}
    </>
  );
}

// ---------------------------------------------------------------- network epidemics

export function Network() {
  const cap = isSmall() ? 1000 : NETWORK_LIMIT;
  const [kind, setKind] = useState<GraphKind>('scale-free'); const [n, setN] = useState(1000); const [deg, setDeg] = useState(6); const [p, setP] = useState(0.06); const [days, setDays] = useState(120); const [seed, setSeed] = useState(1);
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const w = useSimWorker();
  const infectiousDays = 5; const R0h = p * deg * infectiousDays;
  const odeSpec = useMemo(() => buildModel({ ...DEFAULTS, N: Math.min(n, cap), I0: 5, R0: R0h, infectiousDays, days }), [n, R0h, days]);
  const ode = useRun(odeSpec);
  const go = () => { setErr(''); w.call({ kind: 'network', graph: { kind, n: Math.min(n, cap), meanDegree: deg, seed, extra: 0.1 }, p, infectiousDays, seeds: 5, days, runs: 20 }, { timeoutMs: 120000 }).then(setRes).catch((e) => setErr(e.message)); };
  const mean = res ? (res.runs[0].t as number[]).map((_: number, i: number) => res.runs.reduce((a: number, r: any) => a + (r.I[i] ?? 0), 0) / res.runs.length) : [];
  const prov = simProv(t('net.title'), null, { solver: 'network-chain-binomial', seed, method: 'network_sir' });
  return (
    <>
      <Heavy id="network" />
      <section class="card simwrap">
        <div class="sliders">
          <label>{t('net.kind')} <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as GraphKind)}>{(['random', 'small-world', 'scale-free', 'community'] as const).map((k) => <option key={k} value={k}>{t('net.kind.' + k)}</option>)}</select></label>
          <Slider id="n-n" label={t('net.nodes')} value={Math.min(n, cap)} min={100} max={cap} step={100} onChange={setN} />
          <Slider id="n-k" label={t('net.degree')} value={deg} min={2} max={20} step={1} onChange={setDeg} />
          <Slider id="n-p" label={t('net.p')} value={p} min={0.005} max={0.5} step={0.005} onChange={setP} />
          <Slider id="n-d" label={t('param.days')} value={days} min={30} max={365} step={5} onChange={setDays} />
          <label>{t('sim.seed')} <input type="number" min={0} value={seed} style={{ width: '7em' }} onInput={(e) => setSeed(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)))} /></label>
        </div>
        <p class="small muted">{t('net.limits', { n: num(cap) })}</p>
        <div class="btnrow"><button type="button" class="btn primary" onClick={go} disabled={w.busy}>{t('net.run')}</button><button type="button" class="btn small" onClick={async () => setCopied(await copyText(pythonNetwork(kind, Math.min(n, cap), deg, p, infectiousDays, 5, days, seed)))}>{copied ? t('action.copied') : t('net.code')}</button></div>
        <RunStatus busy={w.busy} progress={w.progress} onCancel={w.cancel} error={err} />
      </section>
      {res && (
        <>
          <div class="readouts"><div>{t('net.meanDegree')}<b>{num(res.runs[0].meanDegree, { maximumFractionDigits: 2 })}</b></div><div>{t('net.excess')}<b>{num(res.runs[0].meanExcessDegree, { maximumFractionDigits: 2 })}</b></div><div>{t('net.final')}<b>{num(res.runs.reduce((a: number, r: any) => a + r.finalSize, 0) / res.runs.length, { style: 'percent', maximumFractionDigits: 0 })}</b></div><div>{t('net.finalMix')}<b>{ode.out ? num(ode.out.summary.attack, { style: 'percent', maximumFractionDigits: 0 }) : '–'}</b></div></div>
          <SimChartCard id="net-chart" title={t('net.chartTitle', { kind: t('net.kind.' + kind) })} prov={prov} embed={false} heading="h2" result={res}
            series={[toSim(t('net.mean', { n: res.runs.length }), res.runs[0].t, mean), ...(ode.out ? [toSim(t('net.mixing'), ode.out.res.t, ode.out.infectious, { color: '#b15928' })] : [])]} means={t('net.means')} />
          <section class="card simwrap" style={{ marginTop: '16px' }}><h3>{t('net.degDist')} <span class="badge sim">{t('sim.simulated')}</span></h3><Bars label={t('net.degDist')} xLabel={t('net.degAxis')} data={(res.degrees as any[]).slice(0, 60).map((d) => ({ x: String(d.degree), y: d.count }))} />{table((res.degrees as any[]).map((d) => [d.degree, d.count]), [t('net.degAxis'), t('net.count')], t('net.degDist'))}</section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- metapopulation map (illustrative patches, synthetic coupling)

export function Metapop() {
  const { route } = useApp();
  const [patches, setPatches] = useState<Patch[]>([{ id: 'a', name: 'Patch A', lon: 10, lat: 5, population: 200000, seedInfected: 10 }, { id: 'b', name: 'Patch B', lon: 13, lat: 6.5, population: 80000, seedInfected: 0 }, { id: 'c', name: 'Patch C', lon: 17, lat: 3, population: 120000, seedInfected: 0 }, { id: 'd', name: 'Patch D', lon: 22, lat: 8, population: 50000, seedInfected: 0 }, { id: 'e', name: 'Patch E', lon: 8, lat: 10, population: 30000, seedInfected: 0 }]);
  const [c, setC] = useState<Coupling>({ model: 'gravity', leaveFraction: 0.03, popExponent: 1, distExponent: 2, decayKm: 300 });
  const [R0, setR0] = useState(2.2); const [day, setDay] = useState(0); const [playing, setPlaying] = useState(false);
  const spec = useMemo(() => (patches.length ? metapopSpec(patches, c, R0, 5, 3, 300) : null), [patches, c, R0]);
  const { out, error, busy, progress, cancel } = useRun(spec);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { if (!playing || !out) return; const id = setInterval(() => setDay((d) => { if (d >= out.res.t.length - 1) { setPlaying(false); return d; } return d + (reduce ? 10 : 2); }), reduce ? 1200 : 120); return () => clearInterval(id); }, [playing, out]);
  const M = useMemo(() => couplingMatrix(patches, c), [patches, c]);
  const prev = (i: number, d: number) => (out ? (out.res.y['I' + (i + 1)]?.[Math.min(d, out.res.t.length - 1)] ?? 0) / patches[i].population : 0);
  const color = (x: number) => RAMP[Math.min(RAMP.length - 1, Math.floor((Math.min(x, 0.08) / 0.08) * (RAMP.length - 0.001)))];
  const points = patches.map((p, i) => ({ id: p.id, lon: p.lon, lat: p.lat, label: `${p.name} (${t('meta.illustrative')})`, sources: ['user'], radius: 6 + Math.sqrt(p.population) / 60, color: out ? color(prev(i, day)) : '#bcbddc', sub: out ? t('meta.prev', { v: num(prev(i, day), { style: 'percent', maximumFractionDigits: 1 }), day: out.res.t[Math.min(day, out.res.t.length - 1)] }) : '' }));
  const lines = patches.flatMap((a, i) => patches.map((b, j) => ({ from: [a.lon, a.lat] as [number, number], to: [b.lon, b.lat] as [number, number], w: i < j ? Math.min(6, (M[i][j] + M[j][i]) * 80) : 0 })).filter((l) => l.w > 0.2));
  const prov = simProv(t('meta.title'), spec, { method: 'metapopulation_gravity' });
  const add = (lon: number, lat: number) => { if (patches.length >= METAPOP_LIMIT) return; const k = patches.length; setPatches([...patches, { id: 'p' + Date.now(), name: `Patch ${String.fromCharCode(65 + (k % 26))}${k >= 26 ? k : ''}`, lon: +lon.toFixed(2), lat: +lat.toFixed(2), population: 50000, seedInfected: 0 }]); };
  return (
    <>
      <Heavy id="metapop" />
      <div class="notice sim" role="note">{t('meta.notice')}</div>
      <div class="grid side">
        <section class="card simwrap">
          <header><h2>{t('meta.mapTitle')} <span class="badge sim">{t('sim.simulated')}</span></h2><SourceChip prov={prov} /></header>
          <LazyMap points={points} pointMode="markers" lines={lines} onMapClick={add} names={{ 'src:user': t('meta.illustrative') }} view={{ lng: 14, lat: 6, z: 3.6 }} ariaLabel={t('meta.mapAria')} />
          <p class="small muted">{t('meta.mapHint', { max: METAPOP_LIMIT })}</p>
          {out && (
            <div class="tools"><button type="button" class="btn small" onClick={() => { if (day >= out.res.t.length - 1) setDay(0); setPlaying(!playing); }}>{playing ? t('mappage.pause') : t('mappage.play')}</button>
              <label style={{ flex: 1 }}><span class="sr">{t('sim.dayAxis')}</span><input type="range" min={0} max={out.res.t.length - 1} value={Math.min(day, out.res.t.length - 1)} style={{ width: '100%', accentColor: 'var(--sim)' }} onInput={(e) => setDay(parseInt((e.target as HTMLInputElement).value, 10))} aria-valuetext={t('meta.dayN', { n: day })} /></label><b>{t('meta.dayN', { n: Math.min(day, out.res.t.length - 1) })}</b></div>
          )}
          <RunStatus busy={busy} progress={progress} onCancel={cancel} error={error} />
        </section>
        <section class="card simwrap">
          <h3>{t('meta.coupling')}</h3>
          <div class="sliders" style={{ gridTemplateColumns: '1fr' }}>
            <label>{t('meta.model')} <select value={c.model} onChange={(e) => setC({ ...c, model: (e.target as HTMLSelectElement).value as any })}><option value="gravity">{t('meta.gravity')}</option><option value="distance-decay">{t('meta.decay')}</option></select></label>
            <Slider id="m-l" label={t('meta.leave')} value={c.leaveFraction} min={0} max={0.3} step={0.005} onChange={(v) => setC({ ...c, leaveFraction: v })} />
            <Slider id="m-a" label={t('meta.popExp')} value={c.popExponent} min={0} max={2} step={0.05} onChange={(v) => setC({ ...c, popExponent: v })} />
            {c.model === 'gravity' ? <Slider id="m-g" label={t('meta.distExp')} value={c.distExponent} min={0} max={4} step={0.1} onChange={(v) => setC({ ...c, distExponent: v })} /> : <Slider id="m-dk" label={t('meta.decayKm')} value={c.decayKm} min={20} max={2000} step={10} onChange={(v) => setC({ ...c, decayKm: v })} />}
            <Slider id="m-r0" label={t('param.R0')} value={R0} min={0.8} max={6} step={0.05} onChange={setR0} />
          </div>
          <h3>{t('meta.patches')}</h3>
          <div class="tablewrap"><table class="data"><caption class="sr">{t('meta.patches')}</caption><thead><tr><th>{t('meta.name')}</th><th class="n">{t('param.N')}</th><th class="n">{t('param.I0')}</th><th class="n">{t('meta.now')}</th><th /></tr></thead>
            <tbody>{patches.map((p, i) => <tr key={p.id}><th scope="row">{p.name}</th><td class="n"><input type="number" min={100} max={5e6} step={1000} value={p.population} style={{ width: '7em' }} aria-label={`${p.name}: ${t('param.N')}`} onInput={(e) => setPatches(patches.map((x) => (x.id === p.id ? { ...x, population: Math.max(100, Math.min(5e6, Number((e.target as HTMLInputElement).value) || 100)) } : x)))} /></td><td class="n"><input type="number" min={0} max={1000} value={p.seedInfected} style={{ width: '5em' }} aria-label={`${p.name}: ${t('param.I0')}`} onInput={(e) => setPatches(patches.map((x) => (x.id === p.id ? { ...x, seedInfected: Math.max(0, Math.min(1000, Number((e.target as HTMLInputElement).value) || 0)) } : x)))} /></td><td class="n">{num(prev(i, day), { style: 'percent', maximumFractionDigits: 1 })}</td><td><button type="button" class="btn small" onClick={() => setPatches(patches.filter((x) => x.id !== p.id))} aria-label={t('meta.remove', { name: p.name })}>×</button></td></tr>)}</tbody></table></div>
        </section>
      </div>
      {out && spec && <div style={{ marginTop: '16px' }}><SimChartCard id="meta-chart" title={t('meta.chartTitle')} spec={spec} prov={prov} embed={false} result={out.res} series={patches.map((p, i) => toSim(p.name, out.res.t, out.res.y['I' + (i + 1)] ?? []))} marks={[{ x: out.res.t[Math.min(day, out.res.t.length - 1)], label: t('meta.dayN', { n: day }) }]} means={t('meta.means')} /></div>}
      <p class="small"><a href={`/${route.locale}/learn/not-predictions`}>{t('learn.notPredictions')}</a></p>
    </>
  );
}

// ---------------------------------------------------------------- custom model builder

const BLANK: ModelSpec = { specVersion: SPEC_VERSION, id: 'custom-model', name: 'Custom teaching model', template: 'custom', compartments: [{ id: 'S', label: 'Susceptible', initial: 9990 }, { id: 'I', label: 'Infectious', initial: 10, infected: true }, { id: 'R', label: 'Recovered', initial: 0 }], parameters: { beta: { value: 0.4, min: 0, max: 5, unit: '1/day' }, gamma: { value: 0.2, min: 0, max: 5, unit: '1/day' } }, flows: [{ id: 'infection', from: 'S', to: 'I', rate: 'beta*S*I/N', infection: true }, { id: 'recovery', from: 'I', to: 'R', rate: 'gamma*I' }], interventions: [], time: { days: 160, dt: 1 }, solver: { method: 'rk45' }, seed: null, teachingScenario: null, notes: 'Illustrative teaching model. Not fitted to data. Not a forecast.' };

export function Builder() {
  const [spec, setSpec] = useState<ModelSpec>(BLANK);
  const problems = useMemo(() => validateSpec(spec), [spec]);
  const compiled = useMemo(() => { if (problems.length) return null; try { return compile(spec); } catch { return null; } }, [spec, problems]);
  const { out, error, busy, progress, cancel } = useRun(problems.length ? null : spec);
  const up = (patch: Partial<ModelSpec>) => setSpec({ ...spec, ...patch });
  const ids = spec.compartments.map((c) => c.id);
  const svg = useMemo(() => (problems.length ? '' : flowDiagramSvg(spec, { simulated: t('sim.simulated'), inflow: t('doc.inflow'), outflow: t('doc.outflow') })), [spec, problems]);
  const importFile = async (f: File | undefined) => { if (!f) return; try { const s = JSON.parse(await f.text()); setSpec(s); } catch { /* shown through validation */ } };
  return (
    <>
      <Heavy id="builder" />
      <section class="card simwrap">
        <p class="small">{t('build.intro')}</p>
        <h3>{t('build.compartments')}</h3>
        {spec.compartments.map((c, i) => (
          <div class="tools" key={i}>
            <label>{t('build.id')} <input type="text" value={c.id} maxLength={24} style={{ width: '6em' }} onInput={(e) => up({ compartments: spec.compartments.map((x, j) => (j === i ? { ...x, id: (e.target as HTMLInputElement).value } : x)) })} /></label>
            <label>{t('build.initial')} <input type="number" min={0} value={c.initial} style={{ width: '8em' }} onInput={(e) => up({ compartments: spec.compartments.map((x, j) => (j === i ? { ...x, initial: Number((e.target as HTMLInputElement).value) } : x)) })} /></label>
            <label><input type="checkbox" checked={!!c.infected} onChange={(e) => up({ compartments: spec.compartments.map((x, j) => (j === i ? { ...x, infected: (e.target as HTMLInputElement).checked } : x)) })} /> {t('build.infected')}</label>
            <button type="button" class="btn small" onClick={() => up({ compartments: spec.compartments.filter((_, j) => j !== i) })} aria-label={t('build.remove')}>×</button>
          </div>
        ))}
        <button type="button" class="btn small" onClick={() => up({ compartments: [...spec.compartments, { id: 'X' + spec.compartments.length, initial: 0 }] })}>{t('build.addComp')}</button>
        <h3>{t('build.params')}</h3>
        {Object.entries(spec.parameters).map(([k, v]) => (
          <div class="tools" key={k}>
            <code>{k}</code>
            <label>{t('table.value')} <input type="number" step="any" value={v.value} style={{ width: '8em' }} onInput={(e) => { const x = Number((e.target as HTMLInputElement).value); up({ parameters: { ...spec.parameters, [k]: { ...v, value: x, min: Math.min(v.min, x), max: Math.max(v.max, x) } } }); }} /></label>
            <label>{t('doc.unit')} <input type="text" value={v.unit} style={{ width: '6em' }} onInput={(e) => up({ parameters: { ...spec.parameters, [k]: { ...v, unit: (e.target as HTMLInputElement).value } } })} /></label>
            <button type="button" class="btn small" onClick={() => { const p = { ...spec.parameters }; delete p[k]; up({ parameters: p }); }} aria-label={t('build.remove')}>×</button>
          </div>
        ))}
        <button type="button" class="btn small" onClick={() => { let n = 1; while (('k' + n) in spec.parameters) n++; up({ parameters: { ...spec.parameters, ['k' + n]: { value: 0.1, min: 0, max: 10, unit: '1/day' } } }); }}>{t('build.addParam')}</button>
        <h3>{t('build.flows')}</h3>
        {spec.flows.map((f, i) => (
          <div class="tools" key={i}>
            <label>{t('build.from')} <select value={f.from ?? ''} onChange={(e) => up({ flows: spec.flows.map((x, j) => (j === i ? { ...x, from: (e.target as HTMLSelectElement).value || null } : x)) })}><option value="">{t('build.outside')}</option>{ids.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>{t('build.to')} <select value={f.to ?? ''} onChange={(e) => up({ flows: spec.flows.map((x, j) => (j === i ? { ...x, to: (e.target as HTMLSelectElement).value || null } : x)) })}><option value="">{t('build.outside')}</option>{ids.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>{t('build.rate')} <input type="text" value={f.rate} style={{ width: '16em', fontFamily: 'var(--mono)' }} spellcheck={false} onInput={(e) => up({ flows: spec.flows.map((x, j) => (j === i ? { ...x, rate: (e.target as HTMLInputElement).value } : x)) })} /></label>
            <label><input type="checkbox" checked={!!f.infection} onChange={(e) => up({ flows: spec.flows.map((x, j) => (j === i ? { ...x, infection: (e.target as HTMLInputElement).checked } : x)) })} /> {t('build.newInfection')}</label>
            <button type="button" class="btn small" onClick={() => up({ flows: spec.flows.filter((_, j) => j !== i) })} aria-label={t('build.remove')}>×</button>
          </div>
        ))}
        <button type="button" class="btn small" onClick={() => up({ flows: [...spec.flows, { id: 'flow' + (spec.flows.length + 1), from: ids[0] ?? null, to: ids[1] ?? null, rate: '0' }] })}>{t('build.addFlow')}</button>
        <p class="small muted">{t('build.allowed')}</p>
        <div class="btnrow"><label class="btn small">{t('build.import')}<input type="file" accept="application/json,.json" class="sr" onChange={(e) => importFile((e.target as HTMLInputElement).files?.[0])} /></label><button type="button" class="btn small" onClick={() => setSpec(BLANK)}>{t('build.reset')}</button></div>
        <div aria-live="polite" data-testid="builder-validation">
          {problems.length > 0 && <div class="notice warn" role="alert"><b>{t('build.invalid')}</b><ul>{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul></div>}
          {compiled && <div class="notice sim" style={{ fontWeight: 400 }}>{compiled.closed ? t('build.conserved') : t('build.open')} {compiled.warnings.length ? compiled.warnings.join(' ') : t('build.wellPosed')}</div>}
        </div>
        <RunStatus busy={busy} progress={progress} onCancel={cancel} error={error} />
      </section>
      {compiled && <section class="card simwrap" style={{ marginTop: '16px' }}><h3>{t('doc.equations')}</h3>{equationsTex(spec).map((e, i) => <div key={i}><Tex tex={e} block /></div>)}<div style={{ overflowX: 'auto' }} role="img" aria-label={t('doc.diagram')} dangerouslySetInnerHTML={{ __html: svg }} /></section>}
      {out && !problems.length && <div style={{ marginTop: '16px' }}><SimChartCard id="builder-chart" title={spec.name} spec={spec} prov={simProv(spec.name, spec)} result={out.res} heading="h2" series={spec.compartments.slice(0, 8).map((c) => toSim(c.id, out.res.t, out.res.y[c.id]))} means={t('sim.means.ode')} /><ModelDocs spec={spec} ngm={out.ngm} /></div>}
    </>
  );
}

export function NgmTool() {
  const [o, setO] = useState<Options>({ ...DEFAULTS, template: 'asymp' });
  const spec = useMemo(() => buildModel(o), [o]);
  const { out } = useRun(spec) as { out: RunOut | null };
  return (
    <>
      <Heavy id="ngm" />
      <section class="card simwrap">
        <p class="small">{t('ngm.toolIntro')}</p>
        <div class="sliders">
          <label>{t('sim.model')} <select value={o.template} onChange={(e) => setO({ ...o, template: (e.target as HTMLSelectElement).value as any })}>{(['SEIR', 'asymp', 'vector', 'water', 'age', 'SEIRD'] as const).map((x) => <option key={x} value={x}>{t('template.' + x)}</option>)}</select></label>
          <Slider id="g-r0" label={t('param.R0')} value={o.R0} min={0.5} max={10} step={0.05} onChange={(v) => setO({ ...o, R0: v })} />
          <Slider id="g-cov" label={t('param.vaxCoverage')} value={o.vaxCoverage} min={0} max={0.95} step={0.01} onChange={(v) => setO({ ...o, vaxCoverage: v })} />
          <Slider id="g-ke" label={t('param.stagesE')} value={o.stagesE} min={1} max={4} step={1} onChange={(v) => setO({ ...o, stagesE: v })} />
        </div>
      </section>
      {out && <div class="grid two" style={{ marginTop: '16px' }}><ModelDocsOpen spec={spec} ngm={out.ngm} /></div>}
    </>
  );
}
function ModelDocsOpen({ spec, ngm }: { spec: ModelSpec; ngm: any }) {
  useEffect(() => { document.querySelector<HTMLDetailsElement>('#model-docs')?.setAttribute('open', ''); }, [spec]);
  return <div style={{ gridColumn: '1 / -1' }}><ModelDocs spec={spec} ngm={ngm} /></div>;
}

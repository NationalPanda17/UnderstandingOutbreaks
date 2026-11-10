/** The teaching sandbox (Tier S1 and S2): templates, sliders, live readouts, interventions, predict-then-reveal,
 *  run comparison, auto-generated model documentation, the observation layer, and optional shape comparison.
 *  Nothing here reads reported data to set up or tune a model. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { href, setParams } from '../../lib/app';
import { loadTs } from '../../lib/data';
import { num, periodLabel, smart, t } from '../../lib/i18n';
import { placeName } from '../../lib/series';
import type { SeriesData } from '../../lib/transforms';
import { Chart } from '../../components/Chart';
import { FirstUse, diseaseName, useAsync } from '../../components/Layout';
import { SourceChip, useApp } from '../../components/SourceChip';
import { OBS_DEFAULTS, finalSize, herdImmunityThreshold, observe, type Ngm, type ObservationSettings, type Summary } from '../engine/analysis';
import { equationsTex, flowDiagramSvg } from '../engine/docgen';
import { LIMITS, specFromParam, type ModelSpec, type RunResult, type SolverMethod } from '../engine/model';
import { PRESETS } from '../engine/presets';
import { BASIC_TEMPLATES, DEFAULTS, ROUTE_TEMPLATES, assumptions, buildModel, type Options, type TemplateId } from '../engine/templates';
import { RunStatus, SimBanner, SimChartCard, Slider, Tex, simProv, toSim, useSimWorker } from './common';

export interface RunOut { res: RunResult; summary: Summary; ngm: Ngm; re: { t: number[]; R: number[] }; infectious: number[]; incidence: number[]; closed: boolean; warnings: string[] }
const SETTINGS: { id: string; N: number }[] = [{ id: 'town', N: 10000 }, { id: 'school', N: 800 }, { id: 'city', N: 250000 }];

export function useRun(spec: ModelSpec | null) {
  const w = useSimWorker();
  const [out, setOut] = useState<RunOut | null>(null);
  const [error, setError] = useState('');
  const key = spec ? JSON.stringify(spec) : '';
  useEffect(() => {
    if (!spec) return;
    const h = setTimeout(() => { setError(''); w.call<RunOut>({ kind: 'run', spec }, { timeoutMs: 30000 }).then(setOut).catch((e) => { if (e.message !== 'cancelled') setError(e.message); }); }, 120);
    return () => clearTimeout(h);
  }, [key]);
  return { out, error, ...w };
}

export function Sandbox({ initial, lesson, capacity }: { initial?: Partial<Options>; lesson?: boolean; capacity?: number }) {
  const { core, route } = useApp();
  const analyst = route.mode === 'analyst';
  const shared = route.params.get('spec');
  const sharedSpec = useMemo(() => { if (!shared) return null; try { return specFromParam(shared); } catch { return 'bad' as const; } }, [shared]);
  const [o, setO] = useState<Options>({ ...DEFAULTS, ...initial });
  const set = (patch: Partial<Options>) => setO((prev) => ({ ...prev, ...patch }));
  const [pinned, setPinned] = useState<{ o: Options; out: RunOut } | null>(null);
  const [guess, setGuess] = useState<{ shape: string; day: number } | null>(null);
  const [revealed, setRevealed] = useState(!lesson);
  const [exercise, setExercise] = useState(false);
  const spec = useMemo(() => (sharedSpec && sharedSpec !== 'bad' ? sharedSpec : buildModel(o)), [o, sharedSpec]);
  const { out, error, busy, progress, cancel } = useRun(spec);
  const preset = PRESETS.find((p) => p.id === route.params.get('preset'));
  useEffect(() => { if (preset) setO((prev) => ({ ...prev, ...preset.options })); }, [preset?.id]);

  const stochastic = !['rk45', 'rk4'].includes(o.solver);
  const hasE = o.template === 'SEIR' || o.template === 'SEIRD';
  const basic = BASIC_TEMPLATES.includes(o.template);
  const N = spec.compartments.reduce((a, c) => a + c.initial, 0);
  const title = t('sim.runTitle', { model: t('template.' + (spec.template ?? 'custom')) });
  const prov = simProv(title, spec, { citations: preset?.citations.map((c) => ({ text: c.text, doi: c.doi, verified: c.verified })) });
  const series: SeriesData[] = out ? spec.compartments.filter((c) => !/^n\d/.test(c.id)).slice(0, 8).map((c) => toSim(`${c.id}${c.label ? ' · ' + t('comp.' + compKey(c.id), { label: c.label }) : ''}`, out.res.t, out.res.y[c.id])) : [];
  const bands = (spec.interventions ?? []).map((iv) => ({ x0: iv.start, x1: iv.end, label: t('iv.' + iv.id) }));
  const R0start = out?.ngm.R ?? NaN;

  return (
    <>
      <SimBanner />
      <FirstUse id="sim-basic" kind="sim" title={t('firstuse.sim.title')}>{t('firstuse.sim.body')}</FirstUse>
      {sharedSpec === 'bad' && <div class="notice warn" role="alert">{t('sim.badSpec')}</div>}
      {sharedSpec && sharedSpec !== 'bad' && <div class="notice sim" role="note">{t('sim.sharedSpec', { name: sharedSpec.name })} <button type="button" class="btn small" onClick={() => setParams({ spec: null })}>{t('sim.backToSliders')}</button></div>}

      {!sharedSpec && (
        <section class="card simwrap" aria-label={t('sim.controls')}>
          <div class="tools">
            <label>{t('sim.setting')} <select value={SETTINGS.find((s) => s.N === o.N)?.id ?? 'custom'} onChange={(e) => { const s = SETTINGS.find((x) => x.id === (e.target as HTMLSelectElement).value); if (s) set({ N: s.N, I0: Math.max(1, Math.round(s.N / 2000)) }); }}>
              {SETTINGS.map((s) => <option key={s.id} value={s.id}>{t('setting.' + s.id)}</option>)}<option value="custom">{t('setting.custom')}</option></select></label>
            <label>{t('sim.model')} <select value={o.template} onChange={(e) => set({ template: (e.target as HTMLSelectElement).value as TemplateId })} data-testid="template-select">
              <optgroup label={t('sim.tier.s1')}>{BASIC_TEMPLATES.map((x) => <option key={x} value={x}>{t('template.' + x)}</option>)}</optgroup>
              <optgroup label={t('sim.tier.s2')}>{ROUTE_TEMPLATES.map((x) => <option key={x} value={x}>{t('template.' + x)}</option>)}</optgroup></select></label>
            <label>{t('sim.preset')} <select value={preset?.id ?? ''} onChange={(e) => setParams({ preset: (e.target as HTMLSelectElement).value || null })}><option value="">{t('sim.noPreset')}</option>{PRESETS.map((p) => <option key={p.id} value={p.id}>{t('preset.' + p.id)}</option>)}</select></label>
          </div>
          {ROUTE_TEMPLATES.includes(o.template) && <p class="small"><span class="badge sim">{t('sim.teachingTemplate')}</span> {t('template.' + o.template + '.note')}</p>}
          {preset && (
            <div class="notice sim" role="note" style={{ fontWeight: 400 }} data-testid="preset-note">
              <b>{t('preset.' + preset.id)}</b> — {t('preset.illustrative')} {preset.r0Range ? t('preset.range', { lo: preset.r0Range[0], hi: preset.r0Range[1] }) : t('preset.noRange')}
              <ul class="small">{preset.citations.map((c) => <li key={c.text}>{c.text} {c.doi && <a class="ext" href={'https://doi.org/' + c.doi} target="_blank" rel="noopener noreferrer">doi:{c.doi}</a>} <span class="badge">{c.verified ? t('trace.verifiedOn', { date: c.verified }) : t('trace.unverified')}</span></li>)}</ul>
              {preset.unverified.length > 0 && <div class="small">{t('preset.unverifiedParams', { list: preset.unverified.map((k) => t('param.' + k)).join(', ') })}</div>}
            </div>
          )}
          <div class="sliders">
            <Slider id="s-r0" label={t('param.R0')} value={o.R0} min={0.5} max={20} step={0.05} onChange={(v) => set({ R0: v })} />
            <Slider id="s-inf" label={t('param.infectiousDays')} value={o.infectiousDays} min={1} max={30} step={0.5} unit={t('unit.days')} onChange={(v) => set({ infectiousDays: v })} />
            {(hasE || o.template === 'asymp') && <Slider id="s-inc" label={t('param.incubationDays')} value={o.incubationDays} min={0.5} max={21} step={0.5} unit={t('unit.days')} onChange={(v) => set({ incubationDays: v })} />}
            {o.template === 'SIRS' && <Slider id="s-wan" label={t('param.waningDays')} value={o.waningDays} min={10} max={1500} step={10} unit={t('unit.days')} onChange={(v) => set({ waningDays: v })} />}
            {o.template === 'SEIRD' && <Slider id="s-cfr" label={t('param.cfr')} value={o.cfr} min={0} max={0.5} step={0.005} onChange={(v) => set({ cfr: v })} />}
            <Slider id="s-n" label={t('param.N')} value={o.N} min={100} max={stochastic ? LIMITS.stochasticPopulation : 5e6} step={100} onChange={(v) => set({ N: v, I0: Math.min(o.I0, v / 2) })} />
            <Slider id="s-i0" label={t('param.I0')} value={o.I0} min={1} max={Math.max(10, Math.round(o.N / 20))} step={1} onChange={(v) => set({ I0: v })} />
            <Slider id="s-days" label={t('param.days')} value={o.days} min={30} max={analyst ? 3650 : 730} step={10} unit={t('unit.days')} onChange={(v) => set({ days: v, dt: v > 1500 ? 5 : 1 })} />
          </div>
          {basic && (
            <details class="more" open={o.vaxCoverage > 0 || o.reduce > 0}><summary>{t('sim.interventions')}</summary>
              <div class="sliders">
                <Slider id="s-cov" label={t('param.vaxCoverage')} value={o.vaxCoverage} min={0} max={0.99} step={0.01} onChange={(v) => set({ vaxCoverage: v })} />
                <Slider id="s-eff" label={t('param.vaxEfficacy')} value={o.vaxEfficacy} min={0} max={1} step={0.01} onChange={(v) => set({ vaxEfficacy: v })} />
                <label>{t('param.vaxMode')} <select value={o.vaxMode} onChange={(e) => set({ vaxMode: (e.target as HTMLSelectElement).value as any })}><option value="aon">{t('vax.aon')}</option><option value="leaky">{t('vax.leaky')}</option></select></label>
                <Slider id="s-vday" label={t('param.vaxDay')} value={o.vaxDay} min={0} max={o.days} step={1} onChange={(v) => set({ vaxDay: v })} />
                <Slider id="s-red" label={t('param.reduce')} value={o.reduce} min={0} max={0.95} step={0.01} onChange={(v) => set({ reduce: v })} />
                <Slider id="s-rs" label={t('param.reduceStart')} value={o.reduceStart} min={0} max={o.days} step={1} onChange={(v) => set({ reduceStart: v, reduceEnd: Math.max(v + 1, o.reduceEnd) })} />
                <Slider id="s-re" label={t('param.reduceEnd')} value={o.reduceEnd} min={1} max={o.days} step={1} onChange={(v) => set({ reduceEnd: Math.max(v, o.reduceStart + 1) })} />
              </div>
            </details>
          )}
          <details class="more" open={analyst}><summary>{t('sim.moreOptions')}</summary>
            <div class="sliders">
              {basic && <Slider id="s-life" label={t('param.lifeYears')} value={o.lifeYears} min={0} max={90} step={1} unit={t('unit.years')} onChange={(v) => set({ lifeYears: v })} />}
              {(basic || o.template === 'asymp') && <Slider id="s-amp" label={t('param.seasonalAmp')} value={o.seasonalAmp} min={0} max={0.9} step={0.01} onChange={(v) => set({ seasonalAmp: v })} />}
              {basic && hasE && <Slider id="s-ke" label={t('param.stagesE')} value={o.stagesE} min={1} max={8} step={1} onChange={(v) => set({ stagesE: v })} />}
              {basic && <Slider id="s-ki" label={t('param.stagesI')} value={o.stagesI} min={1} max={8} step={1} onChange={(v) => set({ stagesI: v })} />}
              {basic && o.vaxCoverage > 0 && <Slider id="s-vw" label={t('param.vaxWaningDays')} value={o.vaxWaningDays} min={0} max={1500} step={10} unit={t('unit.days')} onChange={(v) => set({ vaxWaningDays: v })} />}
              {basic && o.vaxCoverage > 0 && o.vaxDay > 0 && <Slider id="s-vc" label={t('param.vaxCampaignDays')} value={o.vaxCampaignDays} min={1} max={120} step={1} unit={t('unit.days')} onChange={(v) => set({ vaxCampaignDays: v })} />}
              {(basic || o.template === 'asymp') && <Slider id="s-iso" label={t('param.isolationRate')} value={o.isolationRate} min={0} max={1} step={0.01} unit={t('unit.perDay')} onChange={(v) => set({ isolationRate: v })} />}
              {basic && hasE && <Slider id="s-tr" label={t('param.tracingRate')} value={o.tracingRate} min={0} max={1} step={0.01} unit={t('unit.perDay')} onChange={(v) => set({ tracingRate: v })} />}
              {o.template === 'vector' && <><Slider id="s-m" label={t('param.vectorsPerHost')} value={o.vectorsPerHost} min={0.2} max={10} step={0.1} onChange={(v) => set({ vectorsPerHost: v })} /><Slider id="s-vl" label={t('param.vectorLifeDays')} value={o.vectorLifeDays} min={3} max={40} step={1} unit={t('unit.days')} onChange={(v) => set({ vectorLifeDays: v })} /><Slider id="s-vcn" label={t('param.vectorControl')} value={o.vectorControl} min={0} max={0.95} step={0.01} onChange={(v) => set({ vectorControl: v })} /></>}
              {o.template === 'water' && <><Slider id="s-ws" label={t('param.waterShare')} value={o.waterShare} min={0} max={1} step={0.01} onChange={(v) => set({ waterShare: v })} /><Slider id="s-wd" label={t('param.waterDecayDays')} value={o.waterDecayDays} min={1} max={120} step={1} unit={t('unit.days')} onChange={(v) => set({ waterDecayDays: v })} /><Slider id="s-wash" label={t('param.wash')} value={o.wash} min={0} max={0.95} step={0.01} onChange={(v) => set({ wash: v })} /></>}
              {(o.template === 'vector' || o.template === 'water' || o.template === 'age') && <><Slider id="s-rs2" label={t('param.reduceStart')} value={o.reduceStart} min={0} max={o.days} step={1} onChange={(v) => set({ reduceStart: v, reduceEnd: Math.max(v + 1, o.reduceEnd) })} /><Slider id="s-re2" label={t('param.reduceEnd')} value={o.reduceEnd} min={1} max={o.days} step={1} onChange={(v) => set({ reduceEnd: Math.max(v, o.reduceStart + 1) })} /></>}
              {o.template === 'age' && <Slider id="s-red2" label={t('param.reduce')} value={o.reduce} min={0} max={0.95} step={0.01} onChange={(v) => set({ reduce: v })} />}
              {o.template === 'asymp' && <><Slider id="s-pa" label={t('param.asymFraction')} value={o.asymFraction} min={0} max={0.95} step={0.01} onChange={(v) => set({ asymFraction: v })} /><Slider id="s-ra" label={t('param.asymRelInf')} value={o.asymRelInf} min={0} max={1} step={0.01} onChange={(v) => set({ asymRelInf: v })} /><Slider id="s-pd" label={t('param.presymDays')} value={o.presymDays} min={0.5} max={7} step={0.5} unit={t('unit.days')} onChange={(v) => set({ presymDays: v })} /></>}
              <label>{t('sim.solver')} <select value={o.solver} onChange={(e) => { const s = (e.target as HTMLSelectElement).value as SolverMethod; set({ solver: s, seed: ['rk45', 'rk4'].includes(s) ? null : o.seed ?? 1, N: ['rk45', 'rk4'].includes(s) ? o.N : Math.min(o.N, LIMITS.stochasticPopulation) }); }}>
                {(['rk45', 'rk4', 'chain-binomial', 'gillespie', 'tau-leap'] as const).map((s) => <option key={s} value={s}>{t('solver.' + s)}</option>)}</select></label>
              {stochastic && <label>{t('sim.seed')} <input type="number" min={0} max={4294967295} value={o.seed ?? 1} onInput={(e) => set({ seed: Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)) })} style={{ width: '8em' }} /></label>}
            </div>
            {o.template === 'age' && <ContactMatrix o={o} set={set} />}
            <p class="small muted">{t('sim.limits', { pop: num(stochastic ? LIMITS.stochasticPopulation : 5e6), days: LIMITS.days })}</p>
          </details>
        </section>
      )}

      {lesson && !revealed && (
        <section class="card simwrap" data-testid="predict">
          <h3>{t('predict.title')}</h3><p>{t('predict.ask')}</p>
          <div class="tools">{['one-peak', 'two-peaks', 'plateau', 'fizzle'].map((s) => <label key={s}><input type="radio" name="guess" checked={guess?.shape === s} onChange={() => setGuess({ shape: s, day: guess?.day ?? 40 })} /> {t('predict.' + s)}</label>)}</div>
          <div class="sliders"><Slider id="g-day" label={t('predict.peakDay')} value={guess?.day ?? 40} min={0} max={o.days} step={1} onChange={(v) => setGuess({ shape: guess?.shape ?? 'one-peak', day: v })} /></div>
          <button type="button" class="btn primary" disabled={!guess} onClick={() => setRevealed(true)}>{t('predict.reveal')}</button>
        </section>
      )}
      <RunStatus busy={busy} progress={progress} onCancel={cancel} error={error} />

      {out && revealed && (
        <>
          <div class="readouts" aria-label={t('sim.readouts')} data-testid="readouts">
            <div>{t('read.r0')}<b>{num(R0start)}</b></div>
            <div>{t('read.hit')}<b>{num(herdImmunityThreshold(o.R0), { style: 'percent', maximumFractionDigits: 0 })}</b></div>
            <div>{t('read.final')}<b>{num(out.summary.attack, { style: 'percent', maximumFractionDigits: 1 })}</b>{o.template === 'SIR' && !o.reduce && !o.lifeYears && <span>{t('read.finalFormula', { v: num(finalSize(R0start, 1), { style: 'percent', maximumFractionDigits: 1 }) })}</span>}</div>
            <div>{t('read.peak')}<b>{num(out.summary.peak, { maximumFractionDigits: 0 })}</b><span>{t('read.peakDay', { day: num(out.summary.peakDay) })}</span></div>
            <div>{t('read.doubling')}<b>{out.summary.doublingDays ? num(out.summary.doublingDays, { maximumFractionDigits: 1 }) + ' ' + t('unit.days') : '–'}</b></div>
            <div>{t('read.conservation')}<b>{out.closed ? t('read.closed') : t('read.open')}</b></div>
          </div>
          {guess && <div class="notice sim" role="status" style={{ fontWeight: 400 }} data-testid="predict-result"><b>{t('predict.compare')}</b> {t('predict.result', { guess: guess.day, actual: num(out.summary.peakDay), diff: num(Math.abs(guess.day - out.summary.peakDay)) })} {t('predict.shapeNote')}</div>}
          {out.warnings.map((wn) => <div class="notice warn" key={wn}>{wn}</div>)}
          <SimChartCard id="sim-main" title={title} series={series} spec={spec} prov={prov} bands={bands} result={out.res} heading="h2" hline={capacity ? { y: capacity, label: t('challenge.capacity') } : undefined}
            means={t('sim.means.' + (stochastic ? 'stochastic' : 'ode'))} />
          <div class="grid two" style={{ marginTop: '16px' }}>
            <SimChartCard id="sim-re" title={t('sim.reTitle')} series={[toSim(t('read.re'), out.re.t, out.re.R)]} spec={spec} prov={simProv(t('sim.reTitle'), spec, { method: 'next_generation_matrix' })} hline={{ y: 1, label: 'R = 1' }} means={t('sim.means.re')} embed={false} compact />
            <section class="card simwrap">
              <h3>{t('compare.title')}</h3>
              {!pinned && <p class="small muted">{t('compare.hint')}</p>}
              <button type="button" class="btn small" onClick={() => setPinned({ o, out })}>{pinned ? t('compare.repin') : t('compare.pin')}</button>
              {pinned && (
                <>
                  <Chart simulated xMode="index" compact xLabel={t('sim.dayAxis')} ariaLabel={t('compare.title')} series={[toSim(t('compare.a'), pinned.out.res.t, pinned.out.infectious, { color: '#b15928' }), toSim(t('compare.b'), out.res.t, out.infectious)]} />
                  <ul class="list small" data-testid="what-changed">
                    {(Object.keys(o) as (keyof Options)[]).filter((k) => typeof o[k] !== 'object' && o[k] !== pinned.o[k]).map((k) => <li key={k}>{t('param.' + k)}: {String(pinned.o[k])} → <b>{String(o[k])}</b></li>)}
                    <li>{t('read.peak')}: {num(pinned.out.summary.peak, { maximumFractionDigits: 0 })} → <b>{num(out.summary.peak, { maximumFractionDigits: 0 })}</b>; {t('read.final')}: {num(pinned.out.summary.attack, { style: 'percent', maximumFractionDigits: 1 })} → <b>{num(out.summary.attack, { style: 'percent', maximumFractionDigits: 1 })}</b></li>
                  </ul>
                </>
              )}
            </section>
          </div>
          <ObservationPanel incidence={out.incidence} dt={spec.time.dt} spec={spec} />
          <ModelDocs spec={spec} ngm={out.ngm} />
          <ShapeComparison infectious={out.incidence} t={out.res.t} />
          {!lesson && <p class="small"><button type="button" class="btn small" onClick={() => { setExercise(!exercise); }}>{t('predict.tryExercise')}</button> {exercise && <a href={href(route, 'learn/lesson/flattening')}>{t('predict.exerciseLink')}</a>}</p>}
        </>
      )}
    </>
  );
}

const compKey = (id: string) => (/^S/.test(id) ? 'S' : /^E/.test(id) ? 'E' : /^I/.test(id) ? 'I' : /^R/.test(id) ? 'R' : id === 'D' ? 'D' : id === 'V' ? 'V' : id === 'Q' ? 'Q' : id === 'W' ? 'W' : id === 'P' ? 'P' : id === 'A' ? 'A' : 'other');

function ContactMatrix({ o, set }: { o: Options; set: (p: Partial<Options>) => void }) {
  return (
    <div data-testid="contact-matrix">
      <p class="small"><span class="badge sim">{t('age.synthetic')}</span> {t('age.note')}</p>
      <table class="data" style={{ maxWidth: '480px' }}><caption class="sr">{t('age.caption')}</caption>
        <thead><tr><th>{t('age.contactsOf')}</th>{o.ageGroups.map((g) => <th key={g.label} class="n">{t('age.' + g.label)}</th>)}</tr></thead>
        <tbody>{o.contact.map((row, i) => <tr key={i}><th scope="row">{t('age.' + o.ageGroups[i].label)}</th>{row.map((c, j) => <td key={j} class="n"><input type="number" min={0} max={50} step={0.5} value={c} aria-label={`${o.ageGroups[i].label} × ${o.ageGroups[j].label}`} style={{ width: '5em' }} onInput={(e) => { const v = Math.max(0, Math.min(50, Number((e.target as HTMLInputElement).value) || 0)); set({ contact: o.contact.map((r, a) => r.map((x, b) => (a === i && b === j ? v : x))) }); }} /></td>)}</tr>)}</tbody></table>
    </div>
  );
}

/** Observation layer: the link between simulated "truth" and what a data page would show. */
export function ObservationPanel({ incidence, dt, spec, open }: { incidence: number[]; dt: number; spec: ModelSpec | null; open?: boolean }) {
  const { route } = useApp();
  const [s, setS] = useState<ObservationSettings>({ ...OBS_DEFAULTS });
  const set = (p: Partial<ObservationSettings>) => setS((prev) => ({ ...prev, ...p }));
  // the observation layer works in whole days
  const daily = useMemo(() => { if (dt === 1) return incidence.slice(1); const out: number[] = []; const per = Math.max(1, Math.round(dt)); incidence.slice(1).forEach((v) => { for (let k = 0; k < per; k++) out.push(v / per); }); return out; }, [incidence, dt]);
  const obs = useMemo(() => observe(daily, s), [daily, s]);
  const days = obs.day;
  const peakDay = daily.indexOf(Math.max(...daily));
  const view = s.viewDay ?? null;
  const series: SeriesData[] = [
    toSim(t('obs.truth'), days, obs.truth, { color: '#6a3d9a' }),
    toSim(view === null ? t('obs.reportedFinal') : t('obs.reportedSoFar', { day: view }), days, view === null ? obs.reportedFinal : obs.reportedSoFar, { color: '#1b7c8c' }),
  ];
  const prov = simProv(t('obs.title'), spec, { method: 'observation_layer', seed: s.stochastic ? s.seed : null });
  return (
    <details class="more" open={open ?? true} style={{ marginTop: '16px' }} id="observation">
      <summary><b>{t('obs.title')}</b> — {t('obs.summary')}</summary>
      <div class="sliders">
        <Slider id="o-f" label={t('obs.fraction')} value={s.reportFraction} min={0.01} max={1} step={0.01} onChange={(v) => set({ reportFraction: v })} />
        <Slider id="o-d" label={t('obs.delay')} value={s.delayMean} min={0.5} max={30} step={0.5} unit={t('unit.days')} onChange={(v) => set({ delayMean: v, delaySd: Math.min(s.delaySd, v) })} />
        <Slider id="o-sd" label={t('obs.delaySd')} value={s.delaySd} min={0.5} max={15} step={0.5} unit={t('unit.days')} onChange={(v) => set({ delaySd: v })} />
        <Slider id="o-view" label={t('obs.viewDay')} value={view ?? days.length - 1} min={5} max={days.length - 1} step={1} onChange={(v) => set({ viewDay: v >= days.length - 1 ? null : v })} />
        <label><input type="checkbox" checked={s.weeklyBatch} onChange={(e) => set({ weeklyBatch: (e.target as HTMLInputElement).checked })} /> {t('obs.weekly')}</label>
        <label><input type="checkbox" checked={s.definitionChangeDay !== null} onChange={(e) => set({ definitionChangeDay: (e.target as HTMLInputElement).checked ? Math.max(5, peakDay - 10) : null })} /> {t('obs.definition')}</label>
        <label><input type="checkbox" checked={s.testingChangeDay !== null} onChange={(e) => set({ testingChangeDay: (e.target as HTMLInputElement).checked ? Math.max(5, peakDay - 20) : null })} /> {t('obs.testing')}</label>
        <label><input type="checkbox" checked={s.stochastic} onChange={(e) => set({ stochastic: (e.target as HTMLInputElement).checked })} /> {t('obs.noise')}</label>
      </div>
      <button type="button" class="btn small" onClick={() => set({ viewDay: Math.max(6, peakDay) })}>{t('obs.atPeak')}</button>
      <SimChartCard id="sim-obs" title={t('obs.chartTitle')} series={series} spec={spec} prov={prov} embed={false} xLabel={t('obs.dayAxis')}
        bands={[...(obs.incompleteFromDay !== null && view !== null ? [{ x0: obs.incompleteFromDay, x1: view, label: t('chart.incomplete') }] : []), ...(s.definitionChangeDay !== null ? [{ x0: s.definitionChangeDay, x1: s.definitionChangeDay + 0.6, label: t('obs.definitionMark') }] : [])]}
        means={view === null ? t('obs.means.final', { pct: num(s.reportFraction, { style: 'percent', maximumFractionDigits: 0 }) }) : t('obs.means.view', { lag: obs.lagDays })} />
      <p class="small">{t('obs.link')} <a href={href(route, 'place/KEN', { d: 'measles' })}>{t('obs.linkReal')}</a> · <a href={href(route, 'learn/lesson/reporting-lag')}>{t('lesson.reporting-lag.title')}</a></p>
    </details>
  );
}

export function ModelDocs({ spec, ngm }: { spec: ModelSpec; ngm: Ngm | null }) {
  const { route } = useApp();
  const analyst = route.mode === 'analyst';
  const svg = useMemo(() => flowDiagramSvg(spec, { simulated: t('sim.simulated'), inflow: t('doc.inflow'), outflow: t('doc.outflow') }), [spec]);
  return (
    <details class="more" style={{ marginTop: '16px' }} id="model-docs">
      <summary><b>{t('doc.title')}</b> — {t('doc.summary')}</summary>
      <div class="grid two">
        <section class="card simwrap"><h3>{t('doc.diagram')}</h3><div style={{ overflowX: 'auto' }} role="img" aria-label={t('doc.diagramAlt', { comps: spec.compartments.map((c) => c.id).join(', '), n: spec.flows.length })} dangerouslySetInnerHTML={{ __html: svg }} />
          <p class="small">{t('doc.plain', { n: spec.compartments.length, flows: spec.flows.length, comps: spec.compartments.map((c) => `${c.id} (${c.label ?? c.id})`).join(', ') })}</p></section>
        <section class="card simwrap"><h3>{t('doc.equations')}</h3><div style={{ overflowX: 'auto' }}>{equationsTex(spec).slice(0, 24).map((e, i) => <div key={i} style={{ margin: '6px 0' }}><Tex tex={e} block /></div>)}</div>
          <table class="data"><caption class="sr">{t('doc.params')}</caption><thead><tr><th>{t('doc.param')}</th><th class="n">{t('table.value')}</th><th>{t('doc.unit')}</th><th>{t('doc.range')}</th></tr></thead>
            <tbody>{Object.entries(spec.parameters).slice(0, 30).map(([k, v]) => <tr key={k}><th scope="row"><code>{k}</code> <span class="muted small">{v.label}</span></th><td class="n">{smart(v.value)}</td><td>{v.unit}</td><td class="small">{smart(v.min)} – {smart(v.max)}</td></tr>)}</tbody></table></section>
        <section class="card simwrap" data-testid="assumptions"><h3>{t('doc.assumptions')}</h3>
          <ul class="list small">{assumptions(spec).map((a) => <li key={a.key}>{t('assume.' + a.key)} {a.fails && <span class="badge">{t('assume.fails')}</span>}<div class="muted">{a.fails ? t('assume.' + a.key + '.why') : ''}</div></li>)}</ul></section>
        {ngm && ngm.infected.length > 0 && (
          <section class="card simwrap" data-testid="ngm"><h3>{t('ngm.title')}</h3><p class="small">{t('ngm.intro')}</p>
            <p><Tex tex={`R = \\rho(F V^{-1}) = ${Number.isFinite(ngm.R) ? ngm.R.toFixed(4) : '?'}`} block /></p>
            {(analyst || ngm.infected.length <= 3) && ngm.infected.length <= 6 && <><Mat name="F" m={ngm.F} labels={ngm.infected} /><Mat name="V" m={ngm.V} labels={ngm.infected} />{ngm.K.length > 0 && <Mat name="F V⁻¹" m={ngm.K} labels={ngm.infected} />}</>}
            {ngm.note && <p class="small muted">{ngm.note}</p>}</section>
        )}
      </div>
      {analyst && <details class="more"><summary>{t('doc.spec')}</summary><pre style={{ maxHeight: '320px' }}>{JSON.stringify(spec, null, 1)}</pre></details>}
    </details>
  );
}
function Mat({ name, m, labels }: { name: string; m: number[][]; labels: string[] }) {
  return <table class="data" style={{ width: 'auto', margin: '6px 0' }}><caption style={{ textAlign: 'start' }} class="small muted">{name}</caption><thead><tr><th />{labels.map((l) => <th key={l} class="n">{l}</th>)}</tr></thead><tbody>{m.map((r, i) => <tr key={i}><th scope="row">{labels[i]}</th>{r.map((x, j) => <td key={j} class="n">{Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(4))}</td>)}</tr>)}</tbody></table>;
}

/** Optional, off by default: look at a completed historical reported series next to the simulation, on its own axis.
 *  Qualitative only. There is no fitting, no error metric, and no extrapolation. */
function ShapeComparison({ infectious, t: times }: { infectious: number[]; t: number[] }) {
  const { core, route } = useApp();
  const [on, setOn] = useState(false);
  const [disease, setDisease] = useState('measles');
  const [iso3, setIso3] = useState('KEN');
  const [year, setYear] = useState(2023);
  const ts = useAsync(() => (on ? loadTs(core, disease, iso3, null) : Promise.resolve(null)), [on, disease, iso3]);
  const d = core.diseaseById[disease]; const key = d?.default_skey;
  const meta = key ? core.seriesByKey[key] : null;
  const raw = key && ts.data?.series[key];
  // only complete, past periods: nothing from the current or previous calendar year, nothing marked likely incomplete
  const maxYear = Math.min(new Date().getUTCFullYear() - 2, meta ? parseInt(meta.lag.incomplete_from.slice(0, 4), 10) - 1 : 0);
  const pts = raw ? raw.p.map((p, i) => ({ p, v: raw.v[i] })).filter((x) => x.p.slice(0, 4) === String(Math.min(year, maxYear))) : [];
  const reported: SeriesData | null = pts.length ? { id: 'rep', label: `${placeName(core, iso3)} · ${diseaseName(core, disease)} · ${Math.min(year, maxYear)} (${t('shape.reported')})`, p: pts.map((_, i) => String(i)), v: pts.map((x) => x.v), ptype: 'W' } : null;
  return (
    <details class="more" style={{ marginTop: '16px' }} onToggle={(e) => setOn((e.target as HTMLDetailsElement).open)} data-testid="shape-comparison">
      <summary>{t('shape.title')}</summary>
      <div class="notice warn" role="note">{t('shape.notice')}</div>
      <div class="tools">
        <label>{t('filter.disease')} <select value={disease} onChange={(e) => setDisease((e.target as HTMLSelectElement).value)}>{core.diseases.filter((x) => x.has_timeseries && x.cadence !== 'yearly').map((x) => <option key={x.id} value={x.id}>{diseaseName(core, x.id)}</option>)}</select></label>
        <label>{t('filter.place')} <select value={iso3} onChange={(e) => setIso3((e.target as HTMLSelectElement).value)}>{Object.values(core.places).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.iso3} value={p.iso3}>{placeName(core, p.iso3)}</option>)}</select></label>
        <label>{t('shape.year')} <input type="number" min={2012} max={maxYear} value={Math.min(year, maxYear)} onInput={(e) => setYear(Math.min(maxYear, Number((e.target as HTMLInputElement).value) || maxYear))} style={{ width: '6em' }} /></label>
      </div>
      {on && (
        <div class="grid two">
          <section class="card simwrap"><h3>{t('shape.simAxis')} <span class="badge sim">{t('sim.simulated')}</span></h3><Chart simulated compact xMode="index" xLabel={t('sim.dayAxis')} ariaLabel={t('shape.simAxis')} series={[toSim(t('obs.truth'), times, infectious)]} /></section>
          <section class="card"><h3>{t('shape.repAxis')}</h3>{reported ? <Chart compact xMode="index" xLabel={t('shape.relPeriods')} ariaLabel={reported.label} series={[reported]} /> : <p class="muted">{t('chart.noData')}</p>}
            {reported && meta && <SourceChip prov={{ title: reported.label, origin: 'source-reported', sourceIds: [meta.source_id], asOf: meta.retrieved_at?.slice(0, 10) ?? null, snapshotId: core.manifest.snapshot_id, series: [{ skey: key!, iso3 }], caseDefinitions: [meta.case_definition] }} />}
            {pts.length > 0 && <p class="small muted">{periodLabel(pts[0].p, meta!.period_type)} – {periodLabel(pts[pts.length - 1].p, meta!.period_type)}</p>}</section>
        </div>
      )}
      <p class="small"><a href={href(route, 'learn/not-predictions')}>{t('learn.notPredictions')}</a></p>
    </details>
  );
}

/** "Learn and simulate": a clearly separate, educational section. Lazily loaded; solvers run in a worker.
 *  Lessons, challenges and scenario packs are static, translated content (no runtime AI). */
import { useMemo, useState } from 'preact/hooks';
import { absoluteUrl, href } from '../../lib/app';
import { copyText, download } from '../../lib/exporters';
import { hasKey, num, t } from '../../lib/i18n';
import { Ext, FirstUse } from '../../components/Layout';
import { useApp } from '../../components/SourceChip';
import { specToParam } from '../engine/model';
import { METHOD_REFERENCES, PRESETS } from '../engine/presets';
import { DEFAULTS, buildModel, type Options } from '../engine/templates';
import { Branching, Builder, Ensemble, Metapop, Network, NgmTool, Phase, Sweeps } from './Advanced';
import { SimBanner, SimChartCard, Slider, simProv, toSim } from './common';
import { Sandbox, useRun } from './Sandbox';
import packs from './scenario-packs.json';

export const LESSONS: { id: string; tool?: 'ensemble' | 'branching' | 'observation'; options?: Partial<Options> }[] = [
  { id: 'exponential-growth', options: { template: 'SIR', R0: 2, N: 1000000, I0: 1, days: 80 } },
  { id: 'r0', options: { template: 'SIR', R0: 3, days: 150 } },
  { id: 'herd-immunity', options: { template: 'SIR', R0: 4, vaxCoverage: 0.6, vaxEfficacy: 0.9, days: 300 } },
  { id: 'flattening', options: { template: 'SIR', R0: 2.5, reduce: 0.45, reduceStart: 20, reduceEnd: 80, days: 300 } },
  { id: 'epidemics-end', options: { template: 'SIR', R0: 1.8, days: 300 } },
  { id: 'fade-out', tool: 'ensemble' },
  { id: 'superspreading', tool: 'branching' },
  { id: 'seasonality', options: { template: 'SIRS', R0: 1.6, seasonalAmp: 0.25, waningDays: 400, days: 1460, dt: 2 } },
  { id: 'vaccine-waning', options: { template: 'SIR', R0: 3, vaxCoverage: 0.8, vaxEfficacy: 0.95, vaxWaningDays: 300, lifeYears: 0, days: 1460, dt: 2 } },
  { id: 'reporting-lag', tool: 'observation', options: { template: 'SEIR', R0: 2.2, days: 160 } },
  { id: 'limits', options: { template: 'SEIR', R0: 2.5 } },
];
const PATHS: Record<string, string[]> = { basics: ['exponential-growth', 'r0', 'epidemics-end', 'herd-immunity'], control: ['flattening', 'vaccine-waning', 'seasonality'], chance: ['fade-out', 'superspreading'], data: ['reporting-lag', 'limits'] };
const TOOLS: { id: string; tier: 's1' | 's2' | 's3' }[] = [{ id: 'basic', tier: 's1' }, { id: 'ensemble', tier: 's3' }, { id: 'branching', tier: 's3' }, { id: 'ngm', tier: 's3' }, { id: 'sweeps', tier: 's3' }, { id: 'phase', tier: 's3' }, { id: 'network', tier: 's3' }, { id: 'metapop', tier: 's3' }, { id: 'builder', tier: 's3' }];
const MISCONCEPTIONS = ['r0-fixed', 'herd-formula', 'everyone-infected', 'flatten-reduces-total', 'model-is-forecast', 'reported-is-true', 'recent-drop', 'superspreaders-rare'];

function Paras({ base }: { base: string }) {
  const out: string[] = []; for (let i = 1; hasKey(`${base}.p${i}`); i++) out.push(t(`${base}.p${i}`));
  return <>{out.map((p, i) => <p key={i}>{p}</p>)}</>;
}
function Links() {
  const { route } = useApp();
  return <p class="small"><a href={href(route, 'learn/not-predictions')}>{t('learn.notPredictions')}</a> · <a href={href(route, 'learn/misconceptions')}>{t('learn.misconceptions')}</a> · <a href={href(route, 'learn/references')}>{t('learn.references')}</a> · <a href={href(route, 'learn')}>{t('learn.home')}</a></p>;
}

export default function Learn({ parts }: { parts: string[] }) {
  const { route } = useApp();
  const analyst = route.mode === 'analyst';
  const [a, b] = parts;
  const nav = (
    <nav class="tabs" aria-label={t('learn.nav')}>
      <a href={href(route, 'learn')} aria-current={!a ? 'page' : undefined}>{t('learn.home')}</a>
      <a href={href(route, 'learn/sim/basic')} aria-current={a === 'sim' && b === 'basic' ? 'page' : undefined}>{t('learn.sandbox')}</a>
      <a href={href(route, 'learn/paths')} aria-current={a === 'paths' || a === 'lesson' ? 'page' : undefined}>{t('learn.lessons')}</a>
      <a href={href(route, 'learn/challenges')} aria-current={a === 'challenges' ? 'page' : undefined}>{t('learn.challenges')}</a>
      <a href={href(route, 'learn/advanced')} aria-current={a === 'advanced' || (a === 'sim' && b !== 'basic') ? 'page' : undefined}>{t('learn.advanced')}</a>
      <a href={href(route, 'learn/teach')} aria-current={a === 'teach' ? 'page' : undefined}>{t('learn.teach')}</a>
    </nav>
  );
  let body: any;
  if (!a) body = <Home />;
  else if (a === 'sim') {
    const tool = b ?? 'basic';
    body = (
      <>
        <h2>{t('tool.' + tool)}</h2>
        <p class="muted">{t('tool.' + tool + '.desc')}</p>
        {tool !== 'basic' && <SimBanner />}
        {tool === 'basic' && <Sandbox />}
        {tool === 'ensemble' && <Ensemble />}{tool === 'branching' && <Branching />}{tool === 'ngm' && <NgmTool />}{tool === 'sweeps' && <Sweeps />}{tool === 'phase' && <Phase />}{tool === 'network' && <Network />}{tool === 'metapop' && <Metapop />}{tool === 'builder' && <Builder />}
      </>
    );
  } else if (a === 'advanced') body = (
    <>
      <h2>{t('learn.advanced')}</h2><p class="muted">{t('learn.advancedLead')}</p>
      {!analyst && <div class="notice" role="note">{t('learn.advancedAnalyst')}</div>}
      <div class="grid three">{TOOLS.filter((x) => x.tier === 's3').map((x) => <section class="card simwrap" key={x.id}><h3><a href={href(route, 'learn/sim/' + x.id)}>{t('tool.' + x.id)}</a></h3><p class="small muted">{t('tool.' + x.id + '.desc')}</p></section>)}</div>
    </>
  );
  else if (a === 'paths') body = (
    <>
      <h2>{t('learn.lessons')}</h2><p class="muted">{t('learn.pathsLead')}</p>
      {Object.entries(PATHS).map(([p, ids], pi) => <section class="card" key={p} style={{ marginBottom: '12px' }}><h3>{pi + 1}. {t('path.' + p)}</h3><ol>{ids.map((id) => <li key={id}><a href={href(route, 'learn/lesson/' + id)}>{t(`lesson.${id}.title`)}</a> <span class="small muted">— {t(`lesson.${id}.sum`)}</span></li>)}</ol></section>)}
    </>
  );
  else if (a === 'lesson') body = <Lesson id={b} />;
  else if (a === 'challenges') body = <Challenges id={b} />;
  else if (a === 'misconceptions') body = (
    <div class="prose"><h2>{t('learn.misconceptions')}</h2><p class="muted">{t('mis.lead')}</p>
      {MISCONCEPTIONS.map((m) => <section class="card" key={m} style={{ marginBottom: '12px' }}><h3>“{t(`mis.${m}.claim`)}”</h3><p>{t(`mis.${m}.fix`)}</p>{hasKey(`mis.${m}.lesson`) && <p class="small"><a href={href(route, 'learn/lesson/' + t(`mis.${m}.lesson`))}>{t('mis.tryIt')}</a></p>}</section>)}</div>
  );
  else if (a === 'not-predictions') body = (
    <div class="prose"><h2>{t('learn.notPredictions')}</h2><SimBanner /><Paras base="notpred" />
      <ul>{[1, 2, 3, 4, 5, 6].map((i) => <li key={i}>{t('notpred.li' + i)}</li>)}</ul><Paras base="notpred.end" /></div>
  );
  else if (a === 'references') body = <References />;
  else if (a === 'teach') body = <Teach worksheet={b === 'worksheet' ? parts[2] : undefined} />;
  else body = <div class="notice warn" role="alert">{t('state.notFound')}</div>;
  return (
    <div data-section="learn">
      <h1>{t('nav.learn')}</h1>
      <p class="lead">{t('learn.lead')}</p>
      {nav}
      {body}
      <Links />
    </div>
  );
}

function Home() {
  const { route } = useApp();
  return (
    <>
      <SimBanner />
      <div class="grid three">
        <section class="card simwrap"><h2>{t('learn.sandbox')}</h2><p>{t('learn.sandboxDesc')}</p><a class="btn primary" href={href(route, 'learn/sim/basic')}>{t('learn.openSandbox')}</a></section>
        <section class="card"><h2>{t('learn.lessons')}</h2><p>{t('learn.lessonsDesc')}</p><a class="btn" href={href(route, 'learn/paths')}>{t('learn.startPath')}</a></section>
        <section class="card"><h2>{t('lesson.reporting-lag.title')}</h2><p>{t('learn.obsDesc')}</p><a class="btn" href={href(route, 'learn/lesson/reporting-lag')}>{t('learn.openLesson')}</a></section>
        <section class="card"><h2>{t('learn.challenges')}</h2><p>{t('learn.challengesDesc')}</p><a class="btn" href={href(route, 'learn/challenges')}>{t('learn.challenges')}</a></section>
        <section class="card simwrap"><h2>{t('learn.advanced')}</h2><p>{t('learn.advancedLead')}</p><a class="btn" href={href(route, 'learn/advanced')}>{t('learn.advanced')}</a></section>
        <section class="card"><h2>{t('learn.teach')}</h2><p>{t('learn.teachDesc')}</p><a class="btn" href={href(route, 'learn/teach')}>{t('learn.teach')}</a></section>
      </div>
      <h2>{t('learn.separate')}</h2><p class="muted">{t('learn.separateBody')}</p>
    </>
  );
}

function Lesson({ id }: { id: string }) {
  const { route } = useApp();
  const ix = LESSONS.findIndex((l) => l.id === id); const l = LESSONS[ix];
  if (!l) return <div class="notice warn" role="alert">{t('state.notFound')}</div>;
  return (
    <article>
      <h2>{t(`lesson.${id}.title`)}</h2>
      <div class="prose"><Paras base={`lesson.${id}`} /></div>
      <div class="notice sim" role="note" style={{ fontWeight: 400 }}><b>{t('lesson.try')}</b> {t(`lesson.${id}.try`)}</div>
      {l.tool === 'ensemble' && <><SimBanner /><Ensemble /></>}
      {l.tool === 'branching' && <><SimBanner /><Branching /></>}
      {(!l.tool || l.tool === 'observation') && <Sandbox key={id} initial={l.options} lesson={!l.tool} />}
      <p class="means"><b>{t('lesson.takeaway')}</b> {t(`lesson.${id}.take`)}</p>
      <div class="btnrow">{ix > 0 && <a class="btn" href={href(route, 'learn/lesson/' + LESSONS[ix - 1].id)}>← {t(`lesson.${LESSONS[ix - 1].id}.title`)}</a>}{ix < LESSONS.length - 1 && <a class="btn primary" href={href(route, 'learn/lesson/' + LESSONS[ix + 1].id)}>{t(`lesson.${LESSONS[ix + 1].id}.title`)} →</a>}</div>
    </article>
  );
}

const CHALLENGES: { id: string; base: Partial<Options>; controls: (keyof Options)[]; ranges: Record<string, [number, number, number]>; capacity?: number; win: (s: { peak: number; attack: number }, o: Options) => boolean }[] = [
  { id: 'capacity', base: { template: 'SIR', R0: 2.5, N: 10000, I0: 5, days: 365, reduceStart: 20, reduce: 0.2, reduceEnd: 60 }, controls: ['reduce', 'reduceEnd'], ranges: { reduce: [0, 0.6, 0.01], reduceEnd: [21, 365, 1] }, capacity: 600, win: (s) => s.peak < 600 },
  { id: 'coverage', base: { template: 'SIR', R0: 4, N: 10000, I0: 5, days: 365, vaxEfficacy: 0.9, vaxCoverage: 0.5 }, controls: ['vaxCoverage'], ranges: { vaxCoverage: [0, 0.99, 0.01] }, win: (s, o) => s.attack < 0.02 && o.vaxCoverage <= 0.86 },
  { id: 'overshoot', base: { template: 'SIR', R0: 2.5, N: 10000, I0: 5, days: 500, reduce: 0.5, reduceStart: 10, reduceEnd: 40 }, controls: ['reduceStart'], ranges: { reduceStart: [0, 150, 1] }, win: (s) => s.attack < 0.8 },
];

function Challenges({ id }: { id?: string }) {
  const { route } = useApp();
  const ch = CHALLENGES.find((c) => c.id === id);
  if (!ch) return (
    <>
      <h2>{t('learn.challenges')}</h2><p class="muted">{t('challenge.lead')}</p>
      <div class="grid three">{CHALLENGES.map((c) => <section class="card simwrap" key={c.id}><h3><a href={href(route, 'learn/challenges/' + c.id)}>{t(`challenge.${c.id}.title`)}</a></h3><p class="small">{t(`challenge.${c.id}.goal`)}</p></section>)}</div>
    </>
  );
  return <Challenge key={ch.id} ch={ch} />;
}
function Challenge({ ch }: { ch: (typeof CHALLENGES)[number] }) {
  const [o, setO] = useState<Options>({ ...DEFAULTS, ...ch.base });
  const fixed = ch.id === 'overshoot' ? { ...o, reduceEnd: o.reduceStart + 30 } : o;
  const spec = useMemo(() => buildModel(fixed), [fixed.reduce, fixed.reduceStart, fixed.reduceEnd, fixed.vaxCoverage]);
  const { out } = useRun(spec);
  const won = out ? ch.win(out.summary, fixed) : false;
  return (
    <>
      <h2>{t(`challenge.${ch.id}.title`)}</h2>
      <SimBanner />
      <p>{t(`challenge.${ch.id}.goal`)}</p><p class="small muted">{t('challenge.puzzle')}</p>
      <section class="card simwrap"><div class="sliders">{ch.controls.map((k) => <Slider key={k} id={'c-' + k} label={t('param.' + k)} value={o[k] as number} min={ch.ranges[k][0]} max={ch.ranges[k][1]} step={ch.ranges[k][2]} onChange={(v) => setO({ ...o, [k]: v })} />)}</div></section>
      {out && (
        <>
          <div class={'notice ' + (won ? 'sim' : 'warn')} role="status" aria-live="polite" data-testid="challenge-feedback"><b>{won ? t('challenge.solved') : t('challenge.notYet')}</b> {t(`challenge.${ch.id}.feedback`, { peak: num(out.summary.peak, { maximumFractionDigits: 0 }), attack: num(out.summary.attack, { style: 'percent', maximumFractionDigits: 1 }) })} {won && t(`challenge.${ch.id}.why`)}</div>
          <SimChartCard id="challenge-chart" title={t(`challenge.${ch.id}.title`)} spec={spec} prov={simProv(t(`challenge.${ch.id}.title`), spec)} embed={false} heading="h3" series={[toSim(t('sim.infectious'), out.res.t, out.infectious)]} hline={ch.capacity ? { y: ch.capacity, label: t('challenge.capacity') } : undefined} bands={(spec.interventions ?? []).map((iv) => ({ x0: iv.start, x1: iv.end, label: t('iv.' + iv.id) }))} />
        </>
      )}
    </>
  );
}

function References() {
  return (
    <div class="prose"><h2>{t('learn.references')}</h2><p class="muted">{t('refs.lead')}</p>
      <h3>{t('refs.presets')}</h3>
      {PRESETS.map((p) => <section class="card" key={p.id} style={{ marginBottom: '10px' }} data-preset={p.id}><b>{t('preset.' + p.id)}</b> <span class="badge sim">{t('preset.illustrativeShort')}</span> {p.r0Range ? <span class="small">{t('preset.range', { lo: p.r0Range[0], hi: p.r0Range[1] })}</span> : <span class="small">{t('preset.noRange')}</span>}
        <ul class="small">{p.citations.map((c) => <li key={c.text}>{c.text} {c.doi && <Ext url={'https://doi.org/' + c.doi}>doi:{c.doi}</Ext>} <span class="badge">{c.verified ? t('trace.verifiedOn', { date: c.verified }) : t('trace.unverified')}</span></li>)}</ul>
        {p.unverified.length > 0 && <p class="small muted">{t('preset.unverifiedParams', { list: p.unverified.map((k) => t('param.' + k)).join(', ') })}</p>}</section>)}
      <h3>{t('refs.methods')}</h3>
      <ul>{METHOD_REFERENCES.map((c) => <li key={c.text}>{c.text} {c.doi && <Ext url={'https://doi.org/' + c.doi}>doi:{c.doi}</Ext>} <span class="badge">{c.verified ? t('trace.verifiedOn', { date: c.verified }) : t('trace.unverified')}</span><div class="small muted">{c.verifiedHow}</div></li>)}</ul>
      <h3>{t('refs.matrices')}</h3><p>{t('refs.matricesBody')}</p>
    </div>
  );
}

function Teach({ worksheet }: { worksheet?: string }) {
  const { route } = useApp();
  const [copied, setCopied] = useState('');
  const list = packs.packs as { id: string; scenarios: { id: string; options: Partial<Options> }[] }[];
  const url = (o: Partial<Options>) => absoluteUrl(href(route, 'learn/sim/basic', { spec: specToParam(buildModel({ ...DEFAULTS, ...o })) }));
  if (worksheet) {
    const sc = list.flatMap((p) => p.scenarios).find((s) => s.id === worksheet);
    if (!sc) return <div class="notice warn" role="alert">{t('state.notFound')}</div>;
    return (
      <article class="prose" data-testid="worksheet">
        <h2>{t('teach.worksheet')}: {t(`scenario.${sc.id}.title`)}</h2>
        <p class="notice sim">{t('sim.banner')}</p>
        <p>{t(`scenario.${sc.id}.setup`)}</p>
        <ol>{[1, 2, 3, 4].map((i) => <li key={i} style={{ marginBottom: '2.4rem' }}>{t(`scenario.${sc.id}.q${i}`)}</li>)}</ol>
        <table class="data"><thead><tr><th>{t('teach.run')}</th><th>{t('teach.changed')}</th><th>{t('read.peak')}</th><th>{t('read.final')}</th></tr></thead><tbody>{[1, 2, 3, 4].map((i) => <tr key={i}><td style={{ height: '2.2rem' }}>{i}</td><td /><td /><td /></tr>)}</tbody></table>
        <p class="small">{t('teach.link')}: {url(sc.options)}</p>
        <div class="btnrow"><button type="button" class="btn primary" onClick={() => window.print()}>{t('teach.print')}</button></div>
      </article>
    );
  }
  return (
    <>
      <h2>{t('learn.teach')}</h2><p class="muted">{t('teach.lead')}</p>
      <FirstUse id="sim-teach" kind="sim" title={t('firstuse.sim.title')}>{t('firstuse.sim.body')}</FirstUse>
      {list.map((p) => (
        <section class="card" key={p.id} style={{ marginBottom: '12px' }}>
          <h3>{t(`pack.${p.id}`)}</h3>
          <ul class="list">{p.scenarios.map((s) => <li key={s.id}><b>{t(`scenario.${s.id}.title`)}</b><div class="small muted">{t(`scenario.${s.id}.setup`)}</div>
            <div class="btnrow"><a class="btn small" href={href(route, 'learn/sim/basic', { spec: specToParam(buildModel({ ...DEFAULTS, ...s.options })) })}>{t('teach.open')}</a><button type="button" class="btn small" onClick={async () => { await copyText(url(s.options)); setCopied(s.id); }}>{copied === s.id ? t('action.copied') : t('teach.copyUrl')}</button><a class="btn small" href={href(route, 'learn/teach/worksheet/' + s.id)}>{t('teach.worksheet')}</a></div></li>)}</ul>
        </section>
      ))}
      <button type="button" class="btn" onClick={() => download('scenario-packs.json', JSON.stringify(packs, null, 2), 'application/json')}>{t('teach.download')}</button>
      <p class="small muted">{t('teach.noAccounts')}</p>
    </>
  );
}

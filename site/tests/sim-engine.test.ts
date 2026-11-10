/** Simulation engine tests: conservation, analytical results, solver agreement, reproducibility, safety of expressions. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveR, finalSize, herdImmunityThreshold, newInfections, nextGeneration, observe, OBS_DEFAULTS, summarize, delayPmf } from '../src/sim/engine/analysis';
import { pythonSim, rSim, equationsTex, flowDiagramSvg } from '../src/sim/engine/docgen';
import { parseExpr, compileAst, ExprError } from '../src/sim/engine/expr';
import { couplingMatrix, extinctionProbability, latinHypercube, makeGraph, metapopSpec, networkSir, prcc, runEnsemble, simulateBranching, degreeDistribution } from '../src/sim/engine/extras';
import { compile, run, runOde, runStochastic, specFromParam, specToParam, validateSpec, type ModelSpec } from '../src/sim/engine/model';
import { BASIC_TEMPLATES, DEFAULTS, ROUTE_TEMPLATES, buildModel, type Options } from '../src/sim/engine/templates';

const opt = (o: Partial<Options> = {}): Options => ({ ...DEFAULTS, ...o });
const total = (res: any, i: number, ids: string[]) => ids.reduce((s, c) => s + res.y[c][i], 0);
const VENV_PY = join(__dirname, '..', '..', '.venv', 'bin', 'python');
const PY = process.env.UO_PYTHON ?? (existsSync(VENV_PY) ? VENV_PY : 'python3'); // CI has no .venv: it uses the runner's Python

describe('population conservation', () => {
  for (const template of [...BASIC_TEMPLATES, 'asymp', 'age'] as const) {
    it(`${template} keeps the population constant (closed model)`, () => {
      const spec = buildModel(opt({ template, vaxCoverage: 0.3, vaxDay: 10, reduce: 0.4, isolationRate: template === 'SIS' ? 0 : 0.1 }));
      const m = compile(spec); const res = runOde(m);
      expect(m.closed).toBe(true);
      const N0 = total(res, 0, m.comp);
      for (const i of [10, 50, res.t.length - 1]) expect(Math.abs(total(res, i, m.comp) - N0) / N0).toBeLessThan(1e-7);
    });
  }
  it('stochastic solvers conserve whole people exactly', () => {
    for (const solver of ['gillespie', 'tau-leap', 'chain-binomial'] as const) {
      const m = compile(buildModel(opt({ template: 'SEIR', N: 2000, solver, seed: 7 }))); const res = runStochastic(m);
      for (let i = 0; i < res.t.length; i += 17) { const s = total(res, i, m.comp); expect(s).toBe(2000); expect(m.comp.every((c) => res.y[c][i] >= 0 && Number.isInteger(res.y[c][i]))).toBe(true); }
    }
  });
  it('births and deaths balance in the demographic SIR', () => {
    const m = compile(buildModel(opt({ lifeYears: 70, days: 2000, dt: 10 }))); const res = runOde(m);
    expect(m.closed).toBe(false);
    expect(Math.abs(total(res, res.t.length - 1, m.comp) - 10000) / 10000).toBeLessThan(1e-6);
  });
});

describe('agreement with analytical results', () => {
  it('SIR final size matches the final-size relation', () => {
    for (const R0 of [1.5, 2.5, 4]) {
      const m = compile(buildModel(opt({ R0, I0: 0.01, N: 1e6, days: 1500 }))); const res = runOde(m);
      const z = res.y.R[res.t.length - 1] / 1e6;
      expect(z).toBeCloseTo(finalSize(R0), 3);
    }
  });
  it('threshold behaviour at R0 = 1', () => {
    const below = summarize(compile(buildModel(opt({ R0: 0.9, days: 400 }))), run(buildModel(opt({ R0: 0.9, days: 400 }))));
    const above = summarize(compile(buildModel(opt({ R0: 1.3, days: 800 }))), run(buildModel(opt({ R0: 1.3, days: 800 }))));
    expect(below.peak).toBeLessThanOrEqual(5 + 1e-9); // never grows beyond the initial infected
    expect(above.peak).toBeGreaterThan(50);
    expect(finalSize(1)).toBe(0); expect(finalSize(0.8)).toBe(0);
  });
  it('endemic equilibrium of the SIR model with births and deaths: S*/N = 1/R0', () => {
    const o = opt({ R0: 4, lifeYears: 50, days: 3650 * 1, dt: 10, I0: 50 });
    // run long enough to settle by chaining runs
    let spec = buildModel(o); let res = run(spec);
    for (let k = 0; k < 40; k++) { spec = { ...spec, compartments: spec.compartments.map((c) => ({ ...c, initial: res.y[c.id][res.t.length - 1] })) }; res = run(spec); }
    const N = 10000; const mu = spec.parameters.mu.value; const g = spec.parameters.gamma.value; const beta = spec.parameters.beta.value;
    const R0d = beta / (g + mu);
    expect(res.y.S[res.t.length - 1] / N).toBeCloseTo(1 / R0d, 3);
    expect(res.y.I[res.t.length - 1] / N).toBeCloseTo((mu / beta) * (R0d - 1), 5);
  });
  it('herd immunity threshold: vaccinating above 1 - 1/R0 prevents growth, below does not', () => {
    const R0 = 3; const hit = herdImmunityThreshold(R0);
    expect(hit).toBeCloseTo(2 / 3, 10);
    const peakAt = (cov: number) => summarize(compile(buildModel(opt({ R0, vaxCoverage: cov, vaxEfficacy: 1, days: 600 }))), run(buildModel(opt({ R0, vaxCoverage: cov, vaxEfficacy: 1, days: 600 })))).peak;
    expect(peakAt(hit + 0.03)).toBeLessThanOrEqual(5 + 1e-6);
    expect(peakAt(hit - 0.1)).toBeGreaterThan(20);
  });
  it('next-generation-matrix R0 matches known formulas', () => {
    expect(nextGeneration(compile(buildModel(opt({ template: 'SIR', R0: 2.5, I0: 0 })))).R).toBeCloseTo(2.5, 6);
    expect(nextGeneration(compile(buildModel(opt({ template: 'SEIR', R0: 3.2, I0: 0 })))).R).toBeCloseTo(3.2, 6);
    expect(nextGeneration(compile(buildModel(opt({ template: 'SEIR', R0: 3.2, I0: 0, stagesE: 3, stagesI: 4 })))).R).toBeCloseTo(3.2, 6);
    expect(nextGeneration(compile(buildModel(opt({ template: 'vector', R0: 2, I0: 0 })))).R).toBeCloseTo(2, 5);
    expect(nextGeneration(compile(buildModel(opt({ template: 'water', R0: 1.8, I0: 0 })))).R).toBeCloseTo(1.8, 5);
    expect(nextGeneration(compile(buildModel(opt({ template: 'asymp', R0: 2.2, I0: 0 })))).R).toBeCloseTo(2.2, 5);
    expect(nextGeneration(compile(buildModel(opt({ template: 'age', R0: 2.7, I0: 0 })))).R).toBeCloseTo(2.7, 5);
    // SIR with demography: beta / (gamma + mu)
    const m = compile(buildModel(opt({ R0: 2, lifeYears: 1, I0: 0 }))); const p = m.spec.parameters;
    expect(nextGeneration(m).R).toBeCloseTo(p.beta.value / (p.gamma.value + p.mu.value), 6);
    // all-or-nothing vaccination scales the initial reproduction number by the unprotected share
    expect(nextGeneration(compile(buildModel(opt({ R0: 4, I0: 0, vaxCoverage: 0.5, vaxEfficacy: 0.8 })))).R).toBeCloseTo(4 * (1 - 0.4), 5);
  });
  it('effective reproduction number crosses 1 at the epidemic peak (SIR)', () => {
    const m = compile(buildModel(opt({ R0: 2.5, days: 200 }))); const res = runOde(m); const s = summarize(m, res); const re = effectiveR(m, res);
    const at = re.R[re.t.indexOf(s.peakDay)];
    expect(Math.abs(at - 1)).toBeLessThan(0.06);
    expect(re.R[0]).toBeCloseTo(2.5, 2);
  });
  it('early doubling time matches ln 2 / (beta - gamma)', () => {
    const m = compile(buildModel(opt({ R0: 3, N: 1e7, I0: 1, days: 80, dt: 0.5 }))); const s = summarize(m, runOde(m));
    const g = 1 / 5; expect(s.doublingDays!).toBeCloseTo(Math.LN2 / (3 * g - g), 1);
  });
});

describe('solvers', () => {
  it('RK4 converges to the adaptive solution as the step shrinks (4th order)', () => {
    const ref = run({ ...buildModel(opt({ template: 'SEIR' })), solver: { method: 'rk45', rtol: 1e-11, atol: 1e-11 } });
    const err = (step: number) => { const r = run({ ...buildModel(opt({ template: 'SEIR' })), solver: { method: 'rk4', step } }); return Math.max(...r.t.map((_, i) => Math.abs(r.y.I[i] - ref.y.I[i]))); };
    const e1 = err(0.5); const e2 = err(0.25);
    expect(e2).toBeLessThan(e1); expect(e1 / e2).toBeGreaterThan(8); expect(e2).toBeLessThan(1e-2);
  });
  it('matches a recorded scipy reference (SEIR, DOP853, rtol 1e-10)', () => {
    // recorded with scipy 1.18: beta=0.5, sigma=1/3, gamma=0.2, N=10000, I0=5
    const r = run(buildModel(opt({ template: 'SEIR', R0: 2.5, days: 100 })));
    const ref = JSON.parse(execFileSync(PY, ['-c', `
import json, numpy as np
from scipy.integrate import solve_ivp
b,s,g,N=0.5,1/3,0.2,10000.0
f=lambda t,y:[-b*y[0]*y[2]/N, b*y[0]*y[2]/N-s*y[1], s*y[1]-g*y[2], g*y[2]]
sol=solve_ivp(f,(0,100),[N-5,0,5,0],method='DOP853',t_eval=[25,50,75,100],rtol=1e-11,atol=1e-11)
print(json.dumps(sol.y.tolist()))`]).toString());
    [25, 50, 75, 100].forEach((day, k) => { ['S', 'E', 'I', 'R'].forEach((c, j) => { expect(Math.abs(r.y[c][day] - ref[j][k])).toBeLessThan(1e-3); }); });
  });
  it('interventions switch on and off at the stated times', () => {
    const base = run(buildModel(opt({ days: 120 }))); const cut = run(buildModel(opt({ days: 120, reduce: 0.7, reduceStart: 15, reduceEnd: 60 })));
    expect(cut.y.I[14]).toBeCloseTo(base.y.I[14], 6);
    expect(cut.y.I[40]).toBeLessThan(base.y.I[40]);
  });
  it('stochastic runs are exactly reproducible from the seed and differ between seeds', () => {
    for (const solver of ['gillespie', 'tau-leap', 'chain-binomial'] as const) {
      const a = run(buildModel(opt({ N: 3000, solver, seed: 42 }))); const b = run(buildModel(opt({ N: 3000, solver, seed: 42 }))); const c = run(buildModel(opt({ N: 3000, solver, seed: 43 })));
      expect(a.y.I).toEqual(b.y.I); expect(a.y.I).not.toEqual(c.y.I);
      expect(a.meta.seed).toBe(42); expect(a.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
  it('the ensemble mean approaches the ODE solution for a large population', () => {
    const o = opt({ N: 100000, I0: 200, R0: 2.2, days: 90, solver: 'tau-leap', seed: 5 });
    const ens = runEnsemble(buildModel(o), 30); const ode = run(buildModel({ ...o, solver: 'rk45' }));
    const peakOde = Math.max(...ode.y.I); const day = ode.y.I.indexOf(peakOde);
    expect(Math.abs(ens.median[day] - peakOde) / peakOde).toBeLessThan(0.05);
    expect(ens.extinctionProbability).toBe(0); expect(ens.convergence.length).toBe(30);
  });
  it('reports limits instead of hanging', () => {
    expect(validateSpec(buildModel(opt({ N: 5e7, solver: 'gillespie', seed: 1 }))).join(' ')).toMatch(/exceeds the limit/);
    expect(validateSpec({ ...buildModel(opt()), time: { days: 99999, dt: 1 } }).join(' ')).toMatch(/time\.days/);
  });
});

describe('model spec schema and expression safety', () => {
  it('accepts every template', () => { for (const t of [...BASIC_TEMPLATES, ...ROUTE_TEMPLATES]) expect(validateSpec(buildModel(opt({ template: t })))).toEqual([]); });
  it('rejects unsafe or unknown expressions', () => {
    for (const bad of ['constructor', 'alert(1)', 'S.constructor', 'this', 'a=1', '(function(){})()', 'S["x"]', 'import("x")', 'eval(1)', '`x`', 'S;I', 'process.exit()', '1e999e', 'x => x', 'new Date()', '__proto__']) {
      const spec = { ...buildModel(opt()), flows: [{ id: 'f', from: 'S', to: 'I', rate: bad }] };
      expect(validateSpec(spec).length, bad).toBeGreaterThan(0);
    }
    expect(() => parseExpr('fetch(1)')).toThrow(ExprError);
    expect(() => compileAst(parseExpr('window'), { comp: {}, param: {} })).toThrow(ExprError);
    expect(compileAst(parseExpr('2*max(1, 3)^2 - step(-1)'), { comp: {}, param: {} })([], [], 0, 0)).toBe(18);
  });
  it('rejects specs that carry data, fitting targets or unknown fields', () => {
    const s: any = buildModel(opt());
    for (const extra of ['data', 'fitTo', 'observed', 'place', 'calendar', 'forecastUntil']) expect(validateSpec({ ...s, [extra]: 1 }).join(' ')).toMatch(/unknown field/);
    expect(validateSpec({ ...s, specVersion: '9' }).length).toBeGreaterThan(0);
    expect(validateSpec({ ...s, compartments: [{ id: 'S', initial: -1 }] }).length).toBeGreaterThan(0);
    expect(validateSpec({ ...s, seed: 1.5 }).length).toBeGreaterThan(0);
  });
  it('warns when a flow could empty a compartment below zero', () => {
    const s: ModelSpec = { ...buildModel(opt()), flows: [{ id: 'bad', from: 'S', to: 'I', rate: 'beta*10' }, { id: 'recovery', from: 'I', to: 'R', rate: 'gamma*I' }] };
    expect(compile(s).warnings.join(' ')).toMatch(/can become negative/);
  });
  it('round-trips a spec through a shareable URL parameter', () => {
    const s = buildModel(opt({ template: 'SEIRD', reduce: 0.3 }));
    expect(specFromParam(specToParam(s))).toEqual(s);
    expect(() => specFromParam(specToParam({ ...s, data: [1] } as any))).toThrow();
  });
  it('generates equations and a labelled diagram', () => {
    const s = buildModel(opt({ template: 'SEIR' }));
    expect(equationsTex(s)).toHaveLength(4); expect(equationsTex(s)[0]).toContain('\\frac{dS}{dt}');
    expect(flowDiagramSvg(s, { simulated: 'SIMULATED', inflow: 'in', outflow: 'out' })).toContain('SIMULATED');
  });
});

describe('observation layer', () => {
  const truth = Array.from({ length: 120 }, (_, d) => 1000 * Math.exp(-((d - 50) ** 2) / 400));
  it('reports the configured fraction of true infections once everything has arrived', () => {
    const o = observe(truth, { ...OBS_DEFAULTS, reportFraction: 0.25 });
    const t = truth.reduce((a, b) => a + b, 0);
    expect(o.byOnsetFinal.reduce((a, b) => a + b, 0)).toBeCloseTo(0.25 * t, 6);
    expect(o.reportedFinal.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.25 * t + 1e-6);
    expect(delayPmf(6, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it('delays shift the reported peak later, and recent days are incomplete', () => {
    const o = observe(truth, { ...OBS_DEFAULTS, delayMean: 8, delaySd: 3, viewDay: 55 });
    expect(o.reportedFinal.indexOf(Math.max(...o.reportedFinal))).toBeGreaterThan(50);
    expect(o.completeness[55]).toBeLessThan(0.05); expect(o.completeness[20]).toBeGreaterThan(0.99);
    expect(o.reportedSoFar[56]).toBeNull();
    expect(o.incompleteFromDay).toBe(55 - o.lagDays + 1);
    // the truncated view falls at the end although the truth is still near its peak: the "recent weeks look low" effect
    expect((o.reportedSoFar[55] as number) / o.byOnsetFinal[55]).toBeLessThan(0.05);
  });
  it('weekly batching publishes only every seventh day; definition changes raise the fraction', () => {
    const o = observe(truth, { ...OBS_DEFAULTS, weeklyBatch: true });
    o.reportedFinal.forEach((v, d) => { if (d % 7 !== 6) expect(v).toBe(0); });
    const c = observe(truth, { ...OBS_DEFAULTS, reportFraction: 0.2, definitionChangeDay: 60, definitionFactor: 2 });
    expect(c.fraction[59]).toBeCloseTo(0.2); expect(c.fraction[60]).toBeCloseTo(0.4);
  });
  it('stochastic observation is reproducible and never exceeds the truth', () => {
    const t = truth.map(Math.round);
    const a = observe(t, { ...OBS_DEFAULTS, stochastic: true, seed: 3 }); const b = observe(t, { ...OBS_DEFAULTS, stochastic: true, seed: 3 });
    expect(a.byOnsetFinal).toEqual(b.byOnsetFinal); a.byOnsetFinal.forEach((v, d) => expect(v).toBeLessThanOrEqual(t[d]));
  });
});

describe('branching, networks, metapopulation, sensitivity', () => {
  it('extinction probability: 1 below threshold; 1/R for geometric offspring; higher with overdispersion', () => {
    expect(extinctionProbability(0.9, null)).toBeCloseTo(1, 6);
    expect(extinctionProbability(2, 1)).toBeCloseTo(0.5, 8); // negative binomial with k = 1 is geometric
    expect(extinctionProbability(2, 0.1)).toBeGreaterThan(extinctionProbability(2, null));
    const sim = simulateBranching(2, 1, 4000, 11);
    expect(Math.abs(sim.extinct - 0.5)).toBeLessThan(0.04);
  });
  it('network generators give the requested size and roughly the requested mean degree', () => {
    for (const kind of ['random', 'small-world', 'scale-free', 'community'] as const) {
      const g = makeGraph(kind, 800, 6, 2); const mean = g.adj.reduce((a, b) => a + b.length, 0) / g.n;
      expect(g.n).toBe(800); expect(mean).toBeGreaterThan(3.5); expect(mean).toBeLessThan(8.5);
      g.adj.forEach((nb, i) => nb.forEach((j) => expect(g.adj[j]).toContain(i)));
      expect(degreeDistribution(g).reduce((a, b) => a + b.count, 0)).toBe(800);
    }
    expect(makeGraph('random', 1e6, 4, 1).n).toBe(5000); // size cap
  });
  it('network SIR conserves nodes, is reproducible, and no transmission means no spread', () => {
    const g = makeGraph('scale-free', 1000, 6, 3); const a = networkSir(g, 0.08, 5, 5, 150, 9); const b = networkSir(g, 0.08, 5, 5, 150, 9);
    expect(a.I).toEqual(b.I); a.t.forEach((_, i) => expect(a.S[i] + a.I[i] + a.R[i]).toBe(1000));
    expect(networkSir(g, 0, 5, 5, 100, 9).finalSize).toBeCloseTo(0.005, 6);
    expect(a.meanExcessDegree).toBeGreaterThan(a.meanDegree - 1); // heavy-tailed degrees raise the neighbour degree
  });
  it('metapopulation: coupling rows sum to 1, uncoupled patches stay uninfected, coupled ones are reached later', () => {
    const patches = [{ id: 'a', name: 'A', lon: 0, lat: 0, population: 50000, seedInfected: 10 }, { id: 'b', name: 'B', lon: 1, lat: 0, population: 20000, seedInfected: 0 }, { id: 'c', name: 'C', lon: 6, lat: 0, population: 20000, seedInfected: 0 }];
    const c = { model: 'gravity' as const, leaveFraction: 0.05, popExponent: 1, distExponent: 2, decayKm: 200 };
    couplingMatrix(patches, c).forEach((row) => expect(row.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10));
    const res = run(metapopSpec(patches, c, 2.5, 5, 3, 300));
    const peak = (k: number) => res.y['I' + k].indexOf(Math.max(...res.y['I' + k]));
    expect(peak(1)).toBeLessThan(peak(2)); expect(peak(2)).toBeLessThan(peak(3));
    const iso = run(metapopSpec(patches, { ...c, leaveFraction: 0 }, 2.5, 5, 3, 300));
    expect(Math.max(...iso.y.I2)).toBe(0);
    const tot = (r: any, i: number) => Object.values(r.y as Record<string, number[]>).reduce((s, v) => s + v[i], 0);
    expect(tot(res, 299)).toBeCloseTo(90000, 3);
  });
  it('Latin hypercube uses every stratum once; PRCC recovers the sign of monotone effects', () => {
    const s = latinHypercube([{ param: 'R0', min: 1, max: 5 }, { param: 'infectiousDays', min: 2, max: 10 }], 50, 4);
    const strata = new Set(s.map((x) => Math.floor(((x.R0 - 1) / 4) * 50))); expect(strata.size).toBe(50);
    const x1 = s.map((x) => x.R0); const x2 = s.map((x) => x.infectiousDays);
    const r = prcc({ a: x1, b: x2 }, x1.map((v, i) => v * 3 - x2[i]));
    expect(r.a).toBeGreaterThan(0.9); expect(r.b).toBeLessThan(-0.9);
  });
});

describe('generated code reproduces the in-browser run', () => {
  const cases: [string, Options][] = [['SEIR with contact reduction', opt({ template: 'SEIR', reduce: 0.5, reduceStart: 20, reduceEnd: 50, days: 120 })], ['SIRS seasonal with vaccination campaign', opt({ template: 'SIRS', seasonalAmp: 0.3, vaxCoverage: 0.4, vaxDay: 15, days: 200 })], ['vector-borne', opt({ template: 'vector', days: 200 })]];
  for (const [name, o] of cases) {
    it(`Python (scipy): ${name}`, () => {
      const spec = buildModel(o); const res = run({ ...spec, solver: { method: 'rk45', rtol: 1e-10, atol: 1e-10 } });
      const dir = mkdtempSync(join(tmpdir(), 'uo-sim-')); const file = join(dir, 'sim.py'); writeFileSync(file, pythonSim(spec));
      const lines = execFileSync(PY, [file]).toString().trim().split('\n'); const head = lines[0].split(',');
      expect(head).toEqual(['t', ...spec.compartments.map((c) => c.id)]);
      const rows = lines.slice(1).map((l) => l.split(',').map(Number));
      expect(rows.length).toBe(res.t.length);
      const scale = spec.compartments.reduce((a, c) => a + c.initial, 0);
      rows.forEach((r, i) => { expect(r[0]).toBeCloseTo(res.t[i], 9); head.slice(1).forEach((c, j) => expect(Math.abs(r[j + 1] - res.y[c][i]) / scale, `${c} day ${r[0]}`).toBeLessThan(2e-6)); });
    });
  }
  it.skipIf(!existsSync('/usr/local/bin/Rscript') && !existsSync('/usr/bin/Rscript') && !process.env.UO_RSCRIPT)('R (deSolve): SEIR with contact reduction', () => {
    const spec = buildModel(cases[0][1]); const res = run({ ...spec, solver: { method: 'rk45', rtol: 1e-10, atol: 1e-10 } });
    const dir = mkdtempSync(join(tmpdir(), 'uo-sim-')); const file = join(dir, 'sim.R'); writeFileSync(file, rSim(spec));
    const lines = execFileSync(process.env.UO_RSCRIPT ?? 'Rscript', [file]).toString().trim().split('\n'); const head = lines[0].replace(/"/g, '').split(',');
    const rows = lines.slice(1).map((l) => l.split(',').map(Number));
    rows.forEach((r, i) => head.slice(1).forEach((c, j) => expect(Math.abs(r[j + 1] - res.y[c][i]) / 10000).toBeLessThan(2e-6)));
  });
  it('new infections integrate to the change in susceptibles', () => {
    const m = compile(buildModel(opt())); const res = runOde(m);
    expect(newInfections(m, res).reduce((a, b) => a + b, 0)).toBeCloseTo(res.y.S[0] - res.y.S[res.t.length - 1], 4);
  });
});

/** Advanced teaching tools: stochastic ensembles, parameter sweeps and sensitivity, branching processes,
 *  network epidemics, metapopulation spread, and equilibrium / bifurcation helpers.
 *  All of these explore a model. None estimates anything about reality. */
import { infectiousSeries, newInfections, summarize } from './analysis';
import { Cancelled, LIMITS, Rng, compile, lgamma, runOde, runStochastic, type ModelSpec, type RunOptions } from './model';
import { buildModel, type Options } from './templates';

// ---------------------------------------------------------------- ensembles

export interface EnsembleResult {
  t: number[]; median: number[]; lo: number[]; hi: number[]; lo50: number[]; hi50: number[];
  finalSizes: number[]; peakDays: number[]; peaks: number[]; extinctionProbability: number; runs: number; seed: number;
  /** Running median of the final size after each realization, to judge convergence. */
  convergence: number[]; standardError: number; extinctThreshold: number;
}
const quantile = (sorted: number[], q: number) => { const i = (sorted.length - 1) * q; const a = Math.floor(i); const b = Math.ceil(i); return sorted[a] + (sorted[b] - sorted[a]) * (i - a); };

export function runEnsemble(spec: ModelSpec, runs: number, opts: RunOptions = {}): EnsembleResult {
  const n = Math.max(1, Math.min(LIMITS.realizations, Math.floor(runs)));
  const m = compile(spec); const base = new Rng(spec.seed ?? 1);
  const N = m.y0.reduce((a, b) => a + b, 0);
  const curves: number[][] = []; const finalSizes: number[] = []; const peakDays: number[] = []; const peaks: number[] = []; const convergence: number[] = [];
  let t: number[] = [];
  const threshold = Math.max(10, 0.01 * N); // an outbreak that infects fewer than this is counted as early extinction
  for (let i = 0; i < n; i++) {
    if (opts.shouldCancel?.()) throw new Cancelled();
    const res = runStochastic(m, { seed: base.fork(i).next() * 4294967296 >>> 0, shouldCancel: opts.shouldCancel });
    t = res.t; curves.push(infectiousSeries(m, res));
    const s = summarize(m, res); const total = newInfections(m, res).reduce((a, b) => a + b, 0);
    finalSizes.push(total); peakDays.push(s.peakDay); peaks.push(s.peak);
    const sorted = finalSizes.slice().sort((a, b) => a - b); convergence.push(quantile(sorted, 0.5));
    opts.onProgress?.((i + 1) / n);
  }
  const q = (p: number) => t.map((_, k) => quantile(curves.map((c) => c[k]).sort((a, b) => a - b), p));
  const mean = finalSizes.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(finalSizes.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { t, median: q(0.5), lo: q(0.05), hi: q(0.95), lo50: q(0.25), hi50: q(0.75), finalSizes, peakDays, peaks, extinctionProbability: finalSizes.filter((x) => x < threshold).length / n, runs: n, seed: spec.seed ?? 1, convergence, standardError: sd / Math.sqrt(n), extinctThreshold: threshold };
}

export function histogram(values: number[], bins = 20): { x0: number; x1: number; n: number }[] {
  if (!values.length) return [];
  const lo = Math.min(...values); const hi = Math.max(...values); const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, n: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - lo) / w))].n++;
  return out;
}

// ---------------------------------------------------------------- sweeps and sensitivity

export type Outcome = 'attack' | 'peak' | 'peakDay';
export type SweepParam = keyof Options;
export function outcomeOf(o: Options, outcome: Outcome): number {
  const spec = buildModel({ ...o, solver: 'rk45' }); const m = compile(spec); const s = summarize(m, runOde(m));
  return outcome === 'attack' ? s.attack : outcome === 'peak' ? s.peak : s.peakDay;
}
export function sweep1(base: Options, param: SweepParam, values: number[], outcome: Outcome, opts: RunOptions = {}): { x: number[]; y: number[] } {
  const y: number[] = [];
  values.forEach((v, i) => { if (opts.shouldCancel?.()) throw new Cancelled(); y.push(outcomeOf({ ...base, [param]: v } as Options, outcome)); opts.onProgress?.((i + 1) / values.length); });
  return { x: values, y };
}
export function sweep2(base: Options, px: SweepParam, xs: number[], py: SweepParam, ys: number[], outcome: Outcome, opts: RunOptions = {}): { xs: number[]; ys: number[]; z: number[][] } {
  const z: number[][] = [];
  ys.forEach((yv, j) => { const row: number[] = []; xs.forEach((xv) => { if (opts.shouldCancel?.()) throw new Cancelled(); row.push(outcomeOf({ ...base, [px]: xv, [py]: yv } as Options, outcome)); }); z.push(row); opts.onProgress?.((j + 1) / ys.length); });
  return { xs, ys, z };
}
export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));

/** Latin hypercube sample: each parameter's range is cut into n equal strata and each stratum is used exactly once. */
export function latinHypercube(ranges: { param: SweepParam; min: number; max: number }[], n: number, seed: number): Record<string, number>[] {
  const rng = new Rng(seed);
  const cols = ranges.map((r) => { const perm = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } return perm.map((k) => r.min + ((k + rng.next()) / n) * (r.max - r.min)); });
  return Array.from({ length: n }, (_, i) => Object.fromEntries(ranges.map((r, c) => [r.param, cols[c][i]])));
}
const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(v.length).fill(0); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
function residuals(y: number[], X: number[][]): number[] {
  // least squares of y on [1, X...] by normal equations (small systems)
  const n = y.length; const k = X.length + 1; const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  const col = (j: number, i: number) => (j === 0 ? 1 : X[j - 1][i]);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += col(a, i) * col(b, i); A[a][k] += col(a, i) * y[i]; }
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c] || 1e-12; for (let j = c; j <= k; j++) A[c][j] /= d; for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } }
  const beta = A.map((r) => r[k]);
  return y.map((v, i) => v - beta.reduce((s, b, j) => s + b * col(j, i), 0));
}
const corr = (a: number[], b: number[]) => { const ma = a.reduce((x, y) => x + y, 0) / a.length; const mb = b.reduce((x, y) => x + y, 0) / b.length; let sab = 0; let saa = 0; let sbb = 0; a.forEach((x, i) => { sab += (x - ma) * (b[i] - mb); saa += (x - ma) ** 2; sbb += (b[i] - mb) ** 2; }); return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0; };

/** Partial rank correlation coefficient of each input with the output, controlling for the other inputs. */
export function prcc(inputs: Record<string, number[]>, output: number[]): Record<string, number> {
  const names = Object.keys(inputs); const R = Object.fromEntries(names.map((k) => [k, rank(inputs[k])])); const ry = rank(output);
  const out: Record<string, number> = {};
  for (const k of names) { const others = names.filter((x) => x !== k).map((x) => R[x]); out[k] = corr(residuals(R[k], others), residuals(ry, others)); }
  return out;
}
export function sensitivity(base: Options, ranges: { param: SweepParam; min: number; max: number }[], n: number, outcome: Outcome, seed: number, opts: RunOptions = {}) {
  const samples = latinHypercube(ranges, n, seed); const y: number[] = [];
  samples.forEach((s, i) => { if (opts.shouldCancel?.()) throw new Cancelled(); y.push(outcomeOf({ ...base, ...s } as Options, outcome)); opts.onProgress?.((i + 1) / n); });
  const inputs = Object.fromEntries(ranges.map((r) => [r.param, samples.map((s) => s[r.param])]));
  const baseline = outcomeOf(base, outcome);
  const tornado = ranges.map((r) => ({ param: r.param, low: outcomeOf({ ...base, [r.param]: r.min } as Options, outcome), high: outcomeOf({ ...base, [r.param]: r.max } as Options, outcome) })).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return { samples, y, prcc: prcc(inputs, y), tornado, baseline, n, seed };
}

// ---------------------------------------------------------------- branching processes and superspreading

/** Extinction probability of a branching process started by one case. Offspring are Poisson(R) when k is null, otherwise
 *  negative binomial with mean R and dispersion k (small k = strong superspreading). Solves q = G(q) by iteration. */
export function extinctionProbability(R: number, k: number | null): number {
  const G = (s: number) => (k === null ? Math.exp(-R * (1 - s)) : Math.pow(1 + (R / k) * (1 - s), -k));
  let q = 0; for (let i = 0; i < 5000; i++) { const n = G(q); if (Math.abs(n - q) < 1e-13) { q = n; break; } q = n; }
  return Math.min(1, q);
}
export function offspringPmf(R: number, k: number | null, max = 30): number[] {
  return Array.from({ length: max + 1 }, (_, x) => (k === null ? Math.exp(-R + x * Math.log(R) - lgamma(x + 1)) : Math.exp(lgamma(x + k) - lgamma(k) - lgamma(x + 1) + k * Math.log(k / (k + R)) + x * Math.log(R / (k + R)))));
}
/** Share of all transmission caused by the most infectious 20% of cases (by simulation of individual reproduction numbers). */
export function top20Share(R: number, k: number | null, seed: number, n = 20000): number {
  if (k === null) return 0.2; // every case has the same expected number of secondary cases
  const rng = new Rng(seed); const v = Array.from({ length: n }, () => rng.gamma(k, R / k)).sort((a, b) => b - a);
  const tot = v.reduce((a, b) => a + b, 0); return v.slice(0, Math.floor(n * 0.2)).reduce((a, b) => a + b, 0) / tot;
}
export function simulateBranching(R: number, k: number | null, runs: number, seed: number, cap = 5000, maxGen = 60): { sizes: number[]; extinct: number; capped: number } {
  const rng = new Rng(seed); const sizes: number[] = []; let extinct = 0; let capped = 0;
  for (let r = 0; r < runs; r++) {
    let cur = 1; let total = 1; let g = 0;
    while (cur > 0 && total < cap && g < maxGen) {
      let next = 0;
      if (k === null) next = rng.poisson(R * cur); else for (let i = 0; i < cur; i++) next += rng.poisson(rng.gamma(k, R / k));
      cur = next; total += next; g++;
    }
    if (cur === 0) extinct++; else capped++;
    sizes.push(Math.min(total, cap));
  }
  return { sizes, extinct: extinct / runs, capped: capped / runs };
}

// ---------------------------------------------------------------- network epidemics

export type GraphKind = 'random' | 'small-world' | 'scale-free' | 'community';
export const NETWORK_LIMIT = 5000;
export interface Graph { n: number; adj: number[][]; kind: GraphKind }

export function makeGraph(kind: GraphKind, n: number, meanDegree: number, seed: number, extra = 0.1): Graph {
  const N = Math.max(10, Math.min(NETWORK_LIMIT, Math.floor(n))); const rng = new Rng(seed);
  const sets: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  const link = (a: number, b: number) => { if (a !== b) { sets[a].add(b); sets[b].add(a); } };
  if (kind === 'random') { const edges = Math.round((N * meanDegree) / 2); let made = 0; let guard = 0; while (made < edges && guard++ < edges * 20) { const a = Math.floor(rng.next() * N); const b = Math.floor(rng.next() * N); if (a !== b && !sets[a].has(b)) { link(a, b); made++; } } }
  else if (kind === 'small-world') { const k = Math.max(2, 2 * Math.round(meanDegree / 2)); for (let i = 0; i < N; i++) for (let j = 1; j <= k / 2; j++) { if (rng.next() < extra) { let b = Math.floor(rng.next() * N); let g = 0; while ((b === i || sets[i].has(b)) && g++ < 20) b = Math.floor(rng.next() * N); link(i, b); } else link(i, (i + j) % N); } }
  else if (kind === 'scale-free') { const mAttach = Math.max(1, Math.round(meanDegree / 2)); const pool: number[] = []; for (let i = 0; i <= mAttach; i++) for (let j = 0; j < i; j++) { link(i, j); pool.push(i, j); } for (let i = mAttach + 1; i < N; i++) { const chosen = new Set<number>(); let g = 0; while (chosen.size < mAttach && g++ < 200) chosen.add(pool[Math.floor(rng.next() * pool.length)]); chosen.forEach((b) => { link(i, b); pool.push(i, b); }); } }
  else { const groups = 5; const size = N / groups; const pin = (meanDegree * (1 - extra)) / Math.max(1, size - 1); const pout = (meanDegree * extra) / Math.max(1, N - size); const g = (i: number) => Math.min(groups - 1, Math.floor(i / size));
    // geometric skipping keeps this O(edges)
    const place = (p: number, same: boolean) => { if (p <= 0) return; let idx = -1; const total = (N * (N - 1)) / 2; const lg1p = Math.log(1 - Math.min(0.999999, p)); for (;;) { idx += 1 + Math.floor(Math.log(1 - rng.next()) / lg1p); if (idx >= total) break; const a = Math.floor((1 + Math.sqrt(1 + 8 * idx)) / 2); const b = idx - (a * (a - 1)) / 2; if ((g(a) === g(b)) === same) link(a, b); } };
    place(pin, true); place(pout, false); }
  return { n: N, adj: sets.map((s) => Array.from(s)), kind };
}
export function degreeDistribution(g: Graph): { degree: number; count: number }[] {
  const m = new Map<number, number>(); for (const a of g.adj) m.set(a.length, (m.get(a.length) ?? 0) + 1);
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([degree, count]) => ({ degree, count }));
}
/** Discrete-time SIR on a network: each day every infectious node infects each susceptible neighbour with probability
 *  `pTransmit`, then recovers with probability 1/infectiousDays. */
export function networkSir(g: Graph, pTransmit: number, infectiousDays: number, seeds: number, days: number, seed: number): { t: number[]; S: number[]; I: number[]; R: number[]; finalSize: number; meanDegree: number; meanExcessDegree: number } {
  const rng = new Rng(seed); const st = new Uint8Array(g.n); let inf: number[] = [];
  while (inf.length < Math.min(seeds, g.n)) { const i = Math.floor(rng.next() * g.n); if (st[i] === 0) { st[i] = 1; inf.push(i); } }
  const S = [g.n - inf.length]; const I = [inf.length]; const R = [0]; const t = [0]; const pr = 1 / Math.max(1, infectiousDays);
  for (let d = 1; d <= days; d++) {
    const newInf: number[] = []; const still: number[] = [];
    for (const i of inf) { for (const j of g.adj[i]) if (st[j] === 0 && rng.next() < pTransmit) { st[j] = 3; newInf.push(j); } if (rng.next() < pr) st[i] = 2; else still.push(i); }
    for (const j of newInf) st[j] = 1;
    inf = still.concat(newInf);
    const r = R[d - 1] + (I[d - 1] - still.length);
    t.push(d); I.push(inf.length); R.push(r); S.push(g.n - inf.length - r);
    if (!inf.length) { for (let k = d + 1; k <= days; k++) { t.push(k); I.push(0); R.push(r); S.push(g.n - r); } break; }
  }
  const deg = g.adj.map((a) => a.length); const k1 = deg.reduce((a, b) => a + b, 0) / g.n; const k2 = deg.reduce((a, b) => a + b * b, 0) / g.n;
  return { t, S, I, R, finalSize: R[R.length - 1] / g.n, meanDegree: k1, meanExcessDegree: k1 > 0 ? (k2 - k1) / k1 : 0 };
}

// ---------------------------------------------------------------- metapopulation (synthetic coupling only)

export interface Patch { id: string; name: string; lon: number; lat: number; population: number; seedInfected: number }
export interface Coupling { model: 'gravity' | 'distance-decay'; leaveFraction: number; popExponent: number; distExponent: number; decayKm: number }
export const METAPOP_LIMIT = 30;
const km = (a: Patch, b: Patch) => { const r = Math.PI / 180; const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

/** Synthetic mixing matrix M[i][j] = share of patch i's contacts made in patch j. Illustrative: it uses no real
 *  mobility, airline or travel data, only patch sizes and straight-line distance. */
export function couplingMatrix(patches: Patch[], c: Coupling): number[][] {
  const n = patches.length;
  return patches.map((a, i) => {
    const w = patches.map((b, j) => { if (i === j) return 0; const d = Math.max(1, km(a, b)); return c.model === 'gravity' ? Math.pow(b.population, c.popExponent) / Math.pow(d, c.distExponent) : Math.pow(b.population, c.popExponent) * Math.exp(-d / Math.max(1, c.decayKm)); });
    const tot = w.reduce((x, y) => x + y, 0);
    return w.map((x, j) => (i === j ? 1 - (n > 1 && tot > 0 ? c.leaveFraction : 0) : tot > 0 ? (c.leaveFraction * x) / tot : 0));
  });
}
export function metapopSpec(patches: Patch[], c: Coupling, R0: number, infectiousDays: number, incubationDays: number, days: number): ModelSpec {
  const M = couplingMatrix(patches.slice(0, METAPOP_LIMIT), c); const ps = patches.slice(0, METAPOP_LIMIT);
  const spec: ModelSpec = { specVersion: '1.0', id: 'metapop-teaching', name: 'Metapopulation SEIR (illustrative patches, synthetic coupling)', template: 'metapop', compartments: [], parameters: { beta: { value: R0 / infectiousDays, min: 0, max: 10, unit: '1/day', label: 'Transmission rate' }, sigma: { value: 1 / incubationDays, min: 0.02, max: 5, unit: '1/day' }, gamma: { value: 1 / infectiousDays, min: 0.01, max: 2, unit: '1/day' } }, flows: [], interventions: [], time: { days, dt: 1 }, solver: { method: 'rk45' }, seed: null, teachingScenario: null, notes: 'Illustrative patches with synthetic coupling. No real mobility data. Not a forecast.' };
  ps.forEach((p, i) => {
    const k = i + 1;
    spec.compartments.push({ id: `S${k}`, initial: Math.max(0, p.population - p.seedInfected) }, { id: `E${k}`, initial: 0, infected: true }, { id: `I${k}`, initial: p.seedInfected, infected: true }, { id: `R${k}`, initial: 0 });
    spec.parameters[`n${k}`] = { value: p.population, min: 1, max: 1e9, unit: 'people' };
    ps.forEach((_q, j) => { if (M[i][j] > 0) spec.parameters[`m${k}_${j + 1}`] = { value: M[i][j], min: 0, max: 1, unit: '1' }; });
  });
  ps.forEach((_p, i) => {
    const k = i + 1;
    // residents of i make a share m_ij of their contacts in j, where the infectious prevalence is that of people present in j (approximated by residents of j)
    const foi = ps.map((_q, j) => (M[i][j] > 0 ? `m${k}_${j + 1}*I${j + 1}/n${j + 1}` : '')).filter(Boolean).join(' + ');
    spec.flows.push({ id: `inf${k}`, from: `S${k}`, to: `E${k}`, rate: `beta*S${k}*(${foi})`, infection: true }, { id: `prog${k}`, from: `E${k}`, to: `I${k}`, rate: `sigma*E${k}` }, { id: `rec${k}`, from: `I${k}`, to: `R${k}`, rate: `gamma*I${k}` });
  });
  return spec;
}

// ---------------------------------------------------------------- equilibria and bifurcation

/** Long-run infectious share for a range of R0 values (bifurcation diagram for endemic templates), plus a numerical stability check. */
export function bifurcation(base: Options, r0s: number[], opts: RunOptions = {}): { R0: number[]; endemic: number[]; diseaseFreeStable: boolean[] } {
  const endemic: number[] = []; const dfs: boolean[] = [];
  r0s.forEach((R0, i) => {
    if (opts.shouldCancel?.()) throw new Cancelled();
    const o = { ...base, R0, days: 3650, dt: 10, solver: 'rk45' as const, I0: Math.max(1, base.N * 1e-4), reduce: 0, vaxCoverage: 0, seasonalAmp: 0 };
    const m = compile(buildModel(o)); const res = runOde(m); const I = infectiousSeries(m, res); const N = m.y0.reduce((a, b) => a + b, 0);
    const tail = I.slice(-20); endemic.push(tail.reduce((a, b) => a + b, 0) / tail.length / N);
    dfs.push(I[Math.min(I.length - 1, 30)] < I[0]); // a small introduction shrinks: the disease-free state is stable
    opts.onProgress?.((i + 1) / r0s.length);
  });
  return { R0: r0s, endemic, diseaseFreeStable: dfs };
}

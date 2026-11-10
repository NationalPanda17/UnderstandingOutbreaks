/** Analytical tools: next-generation-matrix R0 (with working shown), effective reproduction number, final size,
 *  herd immunity threshold, peak, early doubling time, and the observation layer.
 *  These describe a model. None of them estimate anything from reported data. */
import { Rng, type Compiled_, type RunResult } from './model';
import { spectralRadius } from './templates';

export interface Ngm { infected: string[]; F: number[][]; V: number[][]; K: number[][]; R: number; note?: string }

function invert(A: number[][]): number[][] | null {
  const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}

/** Next-generation matrix at a state with no infection (van den Driessche & Watmough construction).
 *  F: rate of new infections into each infected compartment; V: net transfer out by all other flows.
 *  Derivatives are taken numerically (central differences) at `state` with infected compartments set to zero. */
export function nextGeneration(m: Compiled_, state?: ArrayLike<number>, t = 0): Ngm {
  const inf = m.spec.compartments.map((c, i) => (c.infected ? i : -1)).filter((i) => i >= 0);
  const names = inf.map((i) => m.comp[i]);
  if (!inf.length) return { infected: [], F: [], V: [], K: [], R: 0, note: 'no infected compartments are marked' };
  // At the start (no state given) infection is removed to get the disease-free state. Along a run the actual state is
  // used. In both cases the population total N is held fixed while one infected compartment is nudged.
  const y0 = Float64Array.from(state ?? m.y0);
  let Nfix = 0; for (let i = 0; i < m.n; i++) Nfix += y0[i];
  if (!state) for (const i of inf) y0[i] = 0;
  const p = new Float64Array(m.baseParams.length); m.paramsAt(t, p);
  const k = inf.length; const F = Array.from({ length: k }, () => new Array(k).fill(0)); const V = Array.from({ length: k }, () => new Array(k).fill(0));
  const total = y0.reduce((a, b) => a + b, 0); const h = Math.max(1e-6, total * 1e-7);
  const evalAt = (y: Float64Array) => m.rate.map((r) => r(y, p, t, Nfix));
  inf.forEach((cj, j) => {
    const yp = Float64Array.from(y0); yp[cj] += h; const ym = Float64Array.from(y0); ym[cj] -= h;
    const rp = evalAt(yp); const rm = evalAt(ym);
    m.spec.flows.forEach((fl, f) => {
      const d = (rp[f] - rm[f]) / (2 * h);
      if (!Number.isFinite(d) || d === 0) return;
      const to = inf.indexOf(m.flowTo[f]); const from = inf.indexOf(m.flowFrom[f]);
      if (fl.infection) { if (to >= 0) F[to][j] += d; } else { if (to >= 0) V[to][j] -= d; if (from >= 0) V[from][j] += d; }
      if (fl.infection && from >= 0) V[from][j] += d;
    });
  });
  const Vi = invert(V);
  if (!Vi) return { infected: names, F, V, K: [], R: NaN, note: 'V is singular: some infected compartment has no way out' };
  const K = F.map((row) => row.map((_, j) => row.reduce((s, x, l) => s + x * Vi[l][j], 0)));
  return { infected: names, F, V, K, R: spectralRadius(K.map((r) => r.map((x) => Math.max(0, x)))) };
}

/** Effective reproduction number along a run: the next-generation value at each output time's susceptible state. */
export function effectiveR(m: Compiled_, res: RunResult, every = 1): { t: number[]; R: number[] } {
  const t: number[] = []; const R: number[] = [];
  for (let i = 0; i < res.t.length; i += every) {
    const y = Float64Array.from(m.comp.map((c) => res.y[c][i]));
    t.push(res.t[i]); R.push(nextGeneration(m, y, res.t[i]).R);
  }
  return { t, R };
}

/** Final size z of a closed SIR-type epidemic: z = s0 * (1 - exp(-R0 * z)), solved by fixed-point iteration. */
export function finalSize(R0: number, s0 = 1): number {
  if (!(R0 * s0 > 1)) return 0;
  let z = s0;
  for (let i = 0; i < 500; i++) { const n = s0 * (1 - Math.exp(-R0 * z)); if (Math.abs(n - z) < 1e-13) { z = n; break; } z = n; }
  return z;
}
export const herdImmunityThreshold = (R0: number) => (R0 > 1 ? 1 - 1 / R0 : 0);

export function infectiousSeries(m: Compiled_, res: RunResult): number[] {
  const ids = m.spec.compartments.filter((c) => c.infected && /^(I|Ih|P|A)/.test(c.id)).map((c) => c.id);
  const use = ids.length ? ids : m.spec.compartments.filter((c) => c.infected).map((c) => c.id);
  return res.t.map((_, i) => use.reduce((s, c) => s + res.y[c][i], 0));
}
export function newInfections(m: Compiled_, res: RunResult): number[] {
  const ids = m.spec.flows.filter((f) => f.infection && (f.to === null || !/^(Iv|W)$/.test(f.to))).map((f) => f.id);
  return res.t.map((_, i) => ids.reduce((s, f) => s + res.incidence[f][i], 0));
}

export interface Summary { peak: number; peakDay: number; attack: number; doublingDays: number | null; growthRate: number | null }
export function summarize(m: Compiled_, res: RunResult): Summary {
  const I = infectiousSeries(m, res);
  let peak = -Infinity; let pi = 0; I.forEach((v, i) => { if (v > peak) { peak = v; pi = i; } });
  const inc = newInfections(m, res); const N0 = m.y0.reduce((a, b) => a + b, 0);
  const hostN = m.spec.template === 'vector' ? m.spec.compartments.filter((c) => /h$/.test(c.id)).reduce((a, c) => a + c.initial, 0) : m.spec.template === 'water' ? N0 - (m.spec.compartments.find((c) => c.id === 'W')?.initial ?? 0) : N0;
  const attack = inc.reduce((a, b) => a + b, 0) / hostN;
  // early exponential growth: least-squares slope of log(I) while I is between 2x its start and 10% of its peak
  const lo = Math.max(I[0] * 2, 1e-9); const hi = peak * 0.1;
  const xs: number[] = []; const ys: number[] = [];
  for (let i = 1; i < pi; i++) if (I[i] > lo && I[i] < hi) { xs.push(res.t[i]); ys.push(Math.log(I[i])); }
  let r: number | null = null;
  if (xs.length >= 3) { const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length; let sxy = 0; let sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; }); r = sxx > 0 ? sxy / sxx : null; }
  return { peak, peakDay: res.t[pi], attack, doublingDays: r && r > 0 ? Math.LN2 / r : null, growthRate: r };
}

// ---------------------------------------------------------------- observation layer

export interface ObservationSettings {
  reportFraction: number;          // share of true infections that are ever reported
  delayMean: number;               // mean reporting delay (days), gamma-distributed
  delaySd: number;
  weeklyBatch: boolean;            // reports are published once every 7 days
  definitionChangeDay: number | null; // from this day the definition changes
  definitionFactor: number;        // multiplier on the reported fraction after the change
  testingChangeDay: number | null; // testing ramps from this day
  testingFactor: number;           // multiplier on the reported fraction reached 14 days after the ramp starts
  viewDay: number | null;          // "today" for the as-known-so-far view; null = everything has arrived
  stochastic: boolean;
  seed: number;
}
export const OBS_DEFAULTS: ObservationSettings = { reportFraction: 0.3, delayMean: 6, delaySd: 3, weeklyBatch: false, definitionChangeDay: null, definitionFactor: 1.5, testingChangeDay: null, testingFactor: 2, viewDay: null, stochastic: false, seed: 1 };

/** Discretised gamma delay distribution over whole days 0..max. */
export function delayPmf(mean: number, sd: number, max = 60): number[] {
  if (!(mean > 0) || !(sd > 0)) return [1];
  const shape = (mean / sd) ** 2; const scale = (sd * sd) / mean;
  const cdf = (x: number) => (x <= 0 ? 0 : regGammaP(shape, x / scale));
  const pmf: number[] = []; for (let d = 0; d <= max; d++) pmf.push(cdf(d + 1) - cdf(d));
  const s = pmf.reduce((a, b) => a + b, 0);
  return pmf.map((x) => x / s);
}
function regGammaP(a: number, x: number): number {
  // series for x < a + 1, continued fraction otherwise (Numerical Recipes)
  const gln = lg(a);
  if (x < a + 1) { let ap = a; let sum = 1 / a; let del = sum; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return sum * Math.exp(-x + a * Math.log(x) - gln); }
  let b = x + 1 - a; let c = 1e300; let d = 1 / b; let h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}
function lg(x: number): number { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += c[j] / ++y; return -tmp + Math.log((2.5066282746310005 * ser) / x); }

export interface Observed {
  day: number[];
  truth: number[];                 // true new infections per day
  reportedFinal: number[];         // reports by publication day once everything has arrived
  reportedSoFar: (number | null)[];// as known on viewDay, by *infection* day (right-truncated): what a dashboard shows
  byOnsetFinal: number[];          // eventually reported, by infection day
  completeness: number[];          // share of each day's eventual reports that has arrived by viewDay
  incompleteFromDay: number | null;// first day the site's rule would shade as "likely incomplete"
  lagDays: number;                 // days needed for 90% of reports to arrive
  fraction: number[];              // reported fraction in force each day
}

/** Turn a simulated "true" daily incidence into a simulated reported series.
 *  Deterministic (expected values) by default; with `stochastic`, binomial thinning and multinomial delays from a seeded RNG. */
export function observe(truthDaily: number[], s: ObservationSettings): Observed {
  const n = truthDaily.length; const pmf = delayPmf(s.delayMean, s.delaySd);
  const rng = new Rng(s.seed);
  const fraction = truthDaily.map((_, d) => {
    let f = s.reportFraction;
    if (s.definitionChangeDay !== null && d >= s.definitionChangeDay) f *= s.definitionFactor;
    if (s.testingChangeDay !== null && d >= s.testingChangeDay) f *= 1 + (s.testingFactor - 1) * Math.min(1, (d - s.testingChangeDay) / 14);
    return Math.max(0, Math.min(1, f));
  });
  const view = s.viewDay ?? Infinity;
  const pubDay = (d: number) => (s.weeklyBatch ? Math.ceil((d + 1) / 7) * 7 - 1 : d); // batches come out on days 6, 13, 20, ...
  const reportedFinal = new Array(n + pmf.length + 7).fill(0); const byOnsetFinal = new Array(n).fill(0); const soFar = new Array(n).fill(0); const completeness = new Array(n).fill(0);
  for (let d = 0; d < n; d++) {
    const eventually = s.stochastic ? rng.binomial(Math.round(truthDaily[d]), fraction[d]) : truthDaily[d] * fraction[d];
    byOnsetFinal[d] = eventually;
    let left = eventually; let rem = 1; let arrived = 0; let arrivedShare = 0;
    for (let k = 0; k < pmf.length; k++) {
      const share = pmf[k];
      const x = s.stochastic ? (k === pmf.length - 1 ? left : rng.binomial(left, Math.min(1, share / rem))) : eventually * share;
      left -= s.stochastic ? x : 0; rem -= share;
      const pub = pubDay(d + k);
      reportedFinal[pub] += x;
      if (pub <= view) { arrived += x; arrivedShare += share; }
    }
    soFar[d] = arrived; completeness[d] = arrivedShare;
  }
  let cum = 0; let lagDays = pmf.length - 1;
  for (let k = 0; k < pmf.length; k++) { cum += pmf[k]; if (cum >= 0.9) { lagDays = k + (s.weeklyBatch ? 6 : 0); break; } }
  const last = Number.isFinite(view) ? Math.min(n - 1, view) : n - 1;
  return {
    day: truthDaily.map((_, i) => i), truth: truthDaily, reportedFinal: reportedFinal.slice(0, n), byOnsetFinal,
    reportedSoFar: soFar.map((v, d) => (d <= last ? v : null)), completeness,
    incompleteFromDay: Number.isFinite(view) ? Math.max(0, last - lagDays + 1) : null, lagDays, fraction,
  };
}

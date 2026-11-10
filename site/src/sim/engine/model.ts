/** Model specification, validation, compilation and solvers (deterministic and stochastic).
 *
 * Educational engine. It has no access to the site's reported data: there is no import from the data layer, no
 * fitting, no calibration, and specs cannot carry data or real calendar dates (unknown fields are rejected).
 */
import { CONSTANTS, FUNCTIONS, ExprError, compileAst, identifiers, parseExpr, type Ast, type Compiled } from './expr';

export const ENGINE_VERSION = '1.0.0';
export const SPEC_VERSION = '1.0';
export const LIMITS = { compartments: 60, parameters: 80, flows: 240, interventions: 20, days: 3650, outputPoints: 4000, odePopulation: 1e10, stochasticPopulation: 2e6, gillespieEvents: 3e6, tauSteps: 2e5, realizations: 1000 };

export type SolverMethod = 'rk45' | 'rk4' | 'chain-binomial' | 'gillespie' | 'tau-leap';
export interface ParamDef { value: number; min: number; max: number; unit: string; label?: string }
export interface CompartmentDef { id: string; label?: string; initial: number; infected?: boolean }
export interface FlowDef { id: string; from: string | null; to: string | null; rate: string; infection?: boolean; label?: string }
export interface Intervention { id: string; label?: string; type: 'scale' | 'set'; param: string; value: number; start: number; end: number }
export interface ModelSpec {
  specVersion: string;
  id: string;
  name: string;
  template?: string;
  compartments: CompartmentDef[];
  parameters: Record<string, ParamDef>;
  flows: FlowDef[];
  interventions?: Intervention[];
  time: { days: number; dt: number };
  solver: { method: SolverMethod; rtol?: number; atol?: number; step?: number };
  seed: number | null;
  /** Optional teaching scenario with an invented calendar start. Never a real date range for a real place. */
  teachingScenario?: { label: string; inventedStart: string } | null;
  notes?: string;
}
const TOP_KEYS = new Set(['specVersion', 'id', 'name', 'template', 'compartments', 'parameters', 'flows', 'interventions', 'time', 'solver', 'seed', 'teachingScenario', 'notes']);
const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const RESERVED = new Set(['t', 'N', ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS)]);

/** Own-property test: names such as "constructor" must never resolve through the prototype chain. */
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export class SpecError extends Error { constructor(public problems: string[]) { super(problems.join('; ')); } }

export interface Compiled_ {
  spec: ModelSpec;
  n: number;
  comp: string[];
  compIndex: Record<string, number>;
  paramNames: string[];
  baseParams: Float64Array;
  flowFrom: Int32Array;
  flowTo: Int32Array;
  rate: Compiled[];
  rateAst: Ast[];
  breakpoints: number[];
  paramsAt: (t: number, out: Float64Array) => void;
  y0: Float64Array;
  closed: boolean;
  warnings: string[];
}

/** Validate a spec against the schema and well-posedness rules. Returns the list of problems (empty = valid). */
export function validateSpec(s: any): string[] {
  const p: string[] = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['spec must be an object'];
  for (const k of Object.keys(s)) if (!TOP_KEYS.has(k)) p.push(`unknown field "${k}" (specs cannot carry data, fitting targets or places)`);
  if (s.specVersion !== SPEC_VERSION) p.push(`specVersion must be "${SPEC_VERSION}"`);
  if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(s.id)) p.push('id must be lower-case letters, digits or hyphens');
  if (typeof s.name !== 'string' || !s.name || s.name.length > 120) p.push('name is required (max 120 characters)');
  const comps = Array.isArray(s.compartments) ? s.compartments : [];
  if (!comps.length || comps.length > LIMITS.compartments) p.push(`compartments: 1 to ${LIMITS.compartments} required`);
  const ids = new Set<string>();
  const checkId = (id: any, what: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) { p.push(`${what} id "${id}" is not a valid name`); return; }
    if (RESERVED.has(id)) p.push(`${what} id "${id}" is reserved`);
    if (ids.has(id)) p.push(`duplicate id "${id}"`);
    ids.add(id);
  };
  for (const c of comps) { checkId(c?.id, 'compartment'); if (typeof c?.initial !== 'number' || !Number.isFinite(c.initial) || c.initial < 0) p.push(`compartment "${c?.id}": initial must be a number >= 0`); }
  const params = s.parameters && typeof s.parameters === 'object' && !Array.isArray(s.parameters) ? s.parameters : {};
  if (Object.keys(params).length > LIMITS.parameters) p.push('too many parameters');
  for (const [k, d] of Object.entries<any>(params)) {
    checkId(k, 'parameter');
    if (!d || typeof d.value !== 'number' || !Number.isFinite(d.value)) { p.push(`parameter "${k}": value must be a finite number`); continue; }
    if (typeof d.min !== 'number' || typeof d.max !== 'number' || !(d.min <= d.value && d.value <= d.max)) p.push(`parameter "${k}": value must lie within [min, max]`);
    if (typeof d.unit !== 'string') p.push(`parameter "${k}": unit is required (use "1" for dimensionless)`);
  }
  const flows = Array.isArray(s.flows) ? s.flows : [];
  if (!flows.length || flows.length > LIMITS.flows) p.push(`flows: 1 to ${LIMITS.flows} required`);
  const compSet = new Set(comps.map((c: any) => c?.id));
  const flowIds = new Set<string>();
  for (const f of flows) {
    if (typeof f?.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(f.id) || flowIds.has(f.id)) p.push(`flow id "${f?.id}" is invalid or duplicated`);
    flowIds.add(f?.id);
    if (f?.from !== null && !compSet.has(f?.from)) p.push(`flow "${f?.id}": unknown source compartment "${f?.from}"`);
    if (f?.to !== null && !compSet.has(f?.to)) p.push(`flow "${f?.id}": unknown target compartment "${f?.to}"`);
    if (f?.from === f?.to) p.push(`flow "${f?.id}": source and target must differ`);
    try {
      const ast = parseExpr(f?.rate);
      for (const name of identifiers(ast)) if (name !== 't' && name !== 'N' && !compSet.has(name) && !own(params, name) && !own(CONSTANTS, name)) p.push(`flow "${f?.id}": unknown name "${name}" in rate`);
    } catch (e) { p.push(`flow "${f?.id}": ${(e as Error).message}`); }
  }
  const ivs = s.interventions ?? [];
  if (!Array.isArray(ivs) || ivs.length > LIMITS.interventions) p.push('interventions must be a list (max 20)');
  else for (const iv of ivs) {
    if (!iv || !own(params, iv.param)) p.push(`intervention "${iv?.id}": unknown parameter "${iv?.param}"`);
    if (iv?.type !== 'scale' && iv?.type !== 'set') p.push(`intervention "${iv?.id}": type must be "scale" or "set"`);
    if (typeof iv?.value !== 'number' || !Number.isFinite(iv.value) || iv.value < 0) p.push(`intervention "${iv?.id}": value must be a number >= 0`);
    if (typeof iv?.start !== 'number' || typeof iv?.end !== 'number' || !(iv.start >= 0) || !(iv.end > iv.start)) p.push(`intervention "${iv?.id}": needs 0 <= start < end (relative days)`);
  }
  const tm = s.time ?? {};
  if (typeof tm.days !== 'number' || !(tm.days > 0) || tm.days > LIMITS.days) p.push(`time.days must be between 0 and ${LIMITS.days}`);
  if (typeof tm.dt !== 'number' || !(tm.dt > 0) || tm.days / tm.dt > LIMITS.outputPoints) p.push(`time.dt must be positive and give at most ${LIMITS.outputPoints} output points`);
  const sv = s.solver ?? {};
  if (!['rk45', 'rk4', 'chain-binomial', 'gillespie', 'tau-leap'].includes(sv.method)) p.push('solver.method must be rk45, rk4, chain-binomial, gillespie or tau-leap');
  if (sv.step !== undefined && !(typeof sv.step === 'number' && sv.step > 0 && sv.step <= 10)) p.push('solver.step must be between 0 and 10 days');
  if (s.seed !== null && !(Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff)) p.push('seed must be null or an integer between 0 and 4294967295');
  if (s.teachingScenario != null && (typeof s.teachingScenario.label !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.teachingScenario.inventedStart ?? ''))) p.push('teachingScenario needs a label and an invented start date');
  const total = comps.reduce((a: number, c: any) => a + (typeof c?.initial === 'number' ? c.initial : 0), 0);
  if (!(total > 0)) p.push('total initial population must be positive');
  const stochastic = ['chain-binomial', 'gillespie', 'tau-leap'].includes(sv.method);
  if (total > (stochastic ? LIMITS.stochasticPopulation : LIMITS.odePopulation)) p.push(`population ${total} exceeds the limit for this solver (${stochastic ? LIMITS.stochasticPopulation : LIMITS.odePopulation})`);
  if (stochastic && comps.some((c: any) => !Number.isInteger(c?.initial))) p.push('stochastic solvers need whole-number initial values');
  return p;
}

export function compile(spec: ModelSpec): Compiled_ {
  const problems = validateSpec(spec);
  if (problems.length) throw new SpecError(problems);
  const comp = spec.compartments.map((c) => c.id);
  const compIndex: Record<string, number> = {}; comp.forEach((c, i) => { compIndex[c] = i; });
  const paramNames = Object.keys(spec.parameters);
  const paramIndex: Record<string, number> = {}; paramNames.forEach((c, i) => { paramIndex[c] = i; });
  const baseParams = Float64Array.from(paramNames.map((k) => spec.parameters[k].value));
  const rateAst = spec.flows.map((f) => parseExpr(f.rate));
  let rate: Compiled[];
  try { rate = rateAst.map((a) => compileAst(a, { comp: compIndex, param: paramIndex })); } catch (e) { throw new SpecError([(e as ExprError).message]); }
  const flowFrom = Int32Array.from(spec.flows.map((f) => (f.from === null ? -1 : compIndex[f.from])));
  const flowTo = Int32Array.from(spec.flows.map((f) => (f.to === null ? -1 : compIndex[f.to])));
  const ivs = (spec.interventions ?? []).map((iv) => ({ ...iv, ix: paramIndex[iv.param] }));
  const breakpoints = Array.from(new Set(ivs.flatMap((iv) => [iv.start, iv.end]).filter((x) => x > 0 && x < spec.time.days))).sort((a, b) => a - b);
  const paramsAt = (t: number, out: Float64Array) => {
    out.set(baseParams);
    for (const iv of ivs) if (t >= iv.start && t < iv.end) out[iv.ix] = iv.type === 'scale' ? out[iv.ix] * iv.value : iv.value;
  };
  const y0 = Float64Array.from(spec.compartments.map((c) => c.initial));
  const closed = spec.flows.every((f) => f.from !== null && f.to !== null);
  const warnings: string[] = [];
  // well-posedness: rates finite and non-negative at t=0, and an outflow must vanish when its source is empty
  const p0 = new Float64Array(baseParams.length); paramsAt(0, p0);
  const N0 = y0.reduce((a, b) => a + b, 0);
  rate.forEach((r, j) => {
    const v = r(y0, p0, 0, N0);
    if (!Number.isFinite(v)) throw new SpecError([`flow "${spec.flows[j].id}": rate is not a finite number at the start`]);
    if (v < -1e-9) throw new SpecError([`flow "${spec.flows[j].id}": rate is negative at the start`]);
    if (flowFrom[j] >= 0) {
      const y = Float64Array.from(y0); y[flowFrom[j]] = 0;
      const z = r(y, p0, 0, y.reduce((a, b) => a + b, 0));
      if (Number.isFinite(z) && Math.abs(z) > 1e-9) warnings.push(`flow "${spec.flows[j].id}" does not stop when "${comp[flowFrom[j]]}" is empty, so that compartment can become negative`);
    }
  });
  return { spec, n: comp.length, comp, compIndex, paramNames, baseParams, flowFrom, flowTo, rate, rateAst, breakpoints, paramsAt, y0, closed, warnings };
}

export interface RunResult {
  t: number[];
  y: Record<string, number[]>;
  /** New events per output interval for each flow (first entry is 0). */
  incidence: Record<string, number[]>;
  meta: { engineVersion: string; specVersion: string; seed: number | null; method: SolverMethod; settings: Record<string, number>; steps: number; closed: boolean; warnings: string[]; ms: number; stochastic: boolean };
}

// ---------------------------------------------------------------- seeded random numbers

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  /** mulberry32: small, fast, and exactly reproducible across platforms. */
  next(): number { let z = (this.s += 0x6d2b79f5); z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; }
  fork(i: number): Rng { return new Rng((Math.imul(this.s ^ 0x9e3779b9, 2654435761) + Math.imul(i + 1, 0x85ebca6b)) >>> 0); }
  normal(): number { let u = 0; while (u === 0) u = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next()); }
  poisson(lam: number): number {
    if (!(lam > 0)) return 0;
    if (lam < 30) { const L = Math.exp(-lam); let k = 0; let p = 1; do { k++; p *= this.next(); } while (p > L); return k - 1; }
    // PTRS (Hörmann 1993) transformed rejection
    const b = 0.931 + 2.53 * Math.sqrt(lam); const a = -0.059 + 0.02483 * b; const inv = 1.1239 + 1.1328 / (b - 3.4); const vr = 0.9277 - 3.6224 / (b - 2);
    for (;;) {
      const u = this.next() - 0.5; const v = this.next(); const us = 0.5 - Math.abs(u); const k = Math.floor(((2 * a) / us + b) * u + lam + 0.43);
      if (us >= 0.07 && v <= vr) return k;
      if (k < 0 || (us < 0.013 && v > us)) continue;
      if (Math.log(v) + Math.log(inv) - Math.log(a / (us * us) + b) <= -lam + k * Math.log(lam) - lgamma(k + 1)) return k;
    }
  }
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p);
    if (n < 40) { let k = 0; for (let i = 0; i < n; i++) if (this.next() < p) k++; return k; }
    const np = n * p;
    if (np < 12) { // inversion by sequential search
      const q = 1 - p; const s = p / q; let f = Math.pow(q, n); let u = this.next(); let k = 0;
      while (u > f && k < n) { u -= f; k++; f *= ((n - k + 1) / k) * s; }
      return k;
    }
    // normal approximation with continuity correction (documented approximation for large n*p)
    const k = Math.round(np + Math.sqrt(np * (1 - p)) * this.normal());
    return Math.max(0, Math.min(n, k));
  }
  gamma(shape: number, scale: number): number {
    if (shape < 1) return this.gamma(shape + 1, scale) * Math.pow(this.next() || 1e-12, 1 / shape);
    const d = shape - 1 / 3; const c = 1 / Math.sqrt(9 * d);
    for (;;) { let x: number; let v: number; do { x = this.normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = this.next(); if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale; }
  }
}
export function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// ---------------------------------------------------------------- deterministic solvers

function outputTimes(spec: ModelSpec): number[] {
  const n = Math.round(spec.time.days / spec.time.dt);
  return Array.from({ length: n + 1 }, (_, i) => Math.min(spec.time.days, i * spec.time.dt));
}

export interface RunOptions { onProgress?: (frac: number) => void; shouldCancel?: () => boolean; seed?: number }
export class Cancelled extends Error {}

export function runOde(m: Compiled_, opts: RunOptions = {}): RunResult {
  const t0 = Date.now();
  const { n } = m; const nf = m.rate.length; const dim = n + nf; // state is augmented with cumulative flows
  const p = new Float64Array(m.baseParams.length);
  const f = (t: number, y: Float64Array, out: Float64Array) => {
    m.paramsAt(t, p);
    let N = 0; for (let i = 0; i < n; i++) N += y[i];
    out.fill(0);
    for (let j = 0; j < nf; j++) {
      const r = m.rate[j](y, p, t, N);
      if (m.flowFrom[j] >= 0) out[m.flowFrom[j]] -= r;
      if (m.flowTo[j] >= 0) out[m.flowTo[j]] += r;
      out[n + j] = r;
    }
  };
  const method = m.spec.solver.method === 'rk4' ? 'rk4' : 'rk45';
  const times = outputTimes(m.spec);
  const y = new Float64Array(dim); y.set(m.y0);
  const rows: Float64Array[] = [Float64Array.from(y)];
  const k = Array.from({ length: 7 }, () => new Float64Array(dim)); const tmp = new Float64Array(dim); const y5 = new Float64Array(dim);
  const rtol = m.spec.solver.rtol ?? 1e-7; const atol = m.spec.solver.atol ?? 1e-9;
  const hFixed = m.spec.solver.step ?? Math.min(m.spec.time.dt, 0.1);
  let steps = 0; let h = Math.min(0.1, m.spec.time.dt); let t = 0;
  const stops = Array.from(new Set([...times.slice(1), ...m.breakpoints])).sort((a, b) => a - b);
  let ti = 1;
  for (const stop of stops) {
    while (t < stop - 1e-12) {
      if (opts.shouldCancel?.()) throw new Cancelled();
      if (method === 'rk4') {
        const hh = Math.min(hFixed, stop - t);
        f(t, y, k[0]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + 0.5 * hh * k[0][i]; f(t + 0.5 * hh, tmp, k[1]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + 0.5 * hh * k[1][i]; f(t + 0.5 * hh, tmp, k[2]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * k[2][i]; f(t + hh, tmp, k[3]);
        for (let i = 0; i < dim; i++) y[i] += (hh / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
        t += hh; steps++;
      } else {
        // Dormand–Prince 5(4) with step-size control
        const hh = Math.min(h, stop - t);
        f(t, y, k[0]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * (k[0][i] / 5); f(t + hh / 5, tmp, k[1]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * ((3 / 40) * k[0][i] + (9 / 40) * k[1][i]); f(t + (3 * hh) / 10, tmp, k[2]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * ((44 / 45) * k[0][i] - (56 / 15) * k[1][i] + (32 / 9) * k[2][i]); f(t + (4 * hh) / 5, tmp, k[3]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * ((19372 / 6561) * k[0][i] - (25360 / 2187) * k[1][i] + (64448 / 6561) * k[2][i] - (212 / 729) * k[3][i]); f(t + (8 * hh) / 9, tmp, k[4]);
        for (let i = 0; i < dim; i++) tmp[i] = y[i] + hh * ((9017 / 3168) * k[0][i] - (355 / 33) * k[1][i] + (46732 / 5247) * k[2][i] + (49 / 176) * k[3][i] - (5103 / 18656) * k[4][i]); f(t + hh, tmp, k[5]);
        for (let i = 0; i < dim; i++) y5[i] = y[i] + hh * ((35 / 384) * k[0][i] + (500 / 1113) * k[2][i] + (125 / 192) * k[3][i] - (2187 / 6784) * k[4][i] + (11 / 84) * k[5][i]);
        f(t + hh, y5, k[6]);
        let err = 0;
        for (let i = 0; i < dim; i++) {
          const y4 = y[i] + hh * ((5179 / 57600) * k[0][i] + (7571 / 16695) * k[2][i] + (393 / 640) * k[3][i] - (92097 / 339200) * k[4][i] + (187 / 2100) * k[5][i] + (1 / 40) * k[6][i]);
          const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
          const e = (y5[i] - y4) / sc; err += e * e;
        }
        err = Math.sqrt(err / dim);
        if (!Number.isFinite(err)) throw new SpecError(['the solution became non-finite; check rate expressions and parameter values']);
        if (err <= 1 || hh < 1e-10) { y.set(y5); t += hh; steps++; }
        h = Math.max(1e-10, Math.min(5, hh * Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-12), -0.2)))));
        if (steps > 5e6) throw new SpecError(['too many solver steps; the model may be stiff for this solver']);
      }
    }
    t = stop;
    if (ti < times.length && Math.abs(times[ti] - stop) < 1e-9) { rows.push(Float64Array.from(y)); ti++; if (ti % 50 === 0) opts.onProgress?.(ti / times.length); }
  }
  return pack(m, times, rows, { method, steps, ms: Date.now() - t0, stochastic: false, seed: null, settings: method === 'rk4' ? { step: hFixed } : { rtol, atol } });
}

function pack(m: Compiled_, times: number[], rows: Float64Array[], meta: { method: SolverMethod; steps: number; ms: number; stochastic: boolean; seed: number | null; settings: Record<string, number> }): RunResult {
  const y: Record<string, number[]> = {}; const incidence: Record<string, number[]> = {};
  m.comp.forEach((c, i) => { y[c] = rows.map((r) => r[i]); });
  m.spec.flows.forEach((fl, j) => { incidence[fl.id] = rows.map((r, i) => (i === 0 ? 0 : r[m.n + j] - rows[i - 1][m.n + j])); });
  return { t: times.slice(0, rows.length), y, incidence, meta: { engineVersion: ENGINE_VERSION, specVersion: SPEC_VERSION, closed: m.closed, warnings: m.warnings, ...meta } };
}

// ---------------------------------------------------------------- stochastic solvers

export function runStochastic(m: Compiled_, opts: RunOptions = {}): RunResult {
  const t0 = Date.now();
  const seed = opts.seed ?? m.spec.seed ?? 1;
  const rng = new Rng(seed);
  const method = m.spec.solver.method;
  const { n } = m; const nf = m.rate.length;
  const y = new Float64Array(n + nf); y.set(m.y0);
  const p = new Float64Array(m.baseParams.length);
  const a = new Float64Array(nf);
  const times = outputTimes(m.spec);
  const rows: Float64Array[] = [Float64Array.from(y)];
  let steps = 0;
  const rates = (t: number): number => {
    m.paramsAt(t, p);
    let N = 0; for (let i = 0; i < n; i++) N += y[i];
    let a0 = 0;
    for (let j = 0; j < nf; j++) { let r = m.rate[j](y, p, t, N); if (!(r > 0) || (m.flowFrom[j] >= 0 && y[m.flowFrom[j]] <= 0)) r = 0; a[j] = r; a0 += r; }
    return a0;
  };
  const fire = (j: number, k: number) => { if (m.flowFrom[j] >= 0) y[m.flowFrom[j]] -= k; if (m.flowTo[j] >= 0) y[m.flowTo[j]] += k; y[n + j] += k; };
  if (method === 'gillespie') {
    let t = 0; let bi = 0;
    for (let ti = 1; ti < times.length; ti++) {
      const stop = times[ti];
      while (t < stop) {
        if (opts.shouldCancel?.()) throw new Cancelled();
        const a0 = rates(t);
        const nextBreak = bi < m.breakpoints.length ? Math.min(stop, m.breakpoints[bi]) : stop;
        if (a0 <= 0) { t = nextBreak; if (bi < m.breakpoints.length && t >= m.breakpoints[bi]) bi++; continue; }
        const dt = -Math.log(1 - rng.next()) / a0;
        if (t + dt >= nextBreak) { t = nextBreak; if (bi < m.breakpoints.length && t >= m.breakpoints[bi]) bi++; continue; } // memoryless: redraw after a parameter change
        t += dt;
        let u = rng.next() * a0; let j = 0;
        while (j < nf - 1 && u >= a[j]) { u -= a[j]; j++; }
        fire(j, 1);
        if (++steps > LIMITS.gillespieEvents) throw new SpecError([`more than ${LIMITS.gillespieEvents} events: use tau-leaping or a smaller population`]);
      }
      rows.push(Float64Array.from(y));
      if (ti % 50 === 0) opts.onProgress?.(ti / times.length);
    }
  } else {
    const h = m.spec.solver.step ?? (method === 'chain-binomial' ? Math.min(1, m.spec.time.dt) : Math.min(0.25, m.spec.time.dt));
    if (m.spec.time.days / h > LIMITS.tauSteps) throw new SpecError(['too many time steps for this solver; increase solver.step']);
    const byFrom: number[][] = Array.from({ length: n }, () => []);
    for (let j = 0; j < nf; j++) if (m.flowFrom[j] >= 0) byFrom[m.flowFrom[j]].push(j);
    const draws = new Float64Array(nf);
    let t = 0;
    for (let ti = 1; ti < times.length; ti++) {
      const stop = times[ti];
      while (t < stop - 1e-12) {
        if (opts.shouldCancel?.()) throw new Cancelled();
        const hh = Math.min(h, stop - t);
        rates(t);
        draws.fill(0);
        for (let j = 0; j < nf; j++) if (m.flowFrom[j] < 0) draws[j] = rng.poisson(a[j] * hh);
        for (let c = 0; c < n; c++) {
          const fl = byFrom[c]; if (!fl.length || y[c] <= 0) continue;
          if (method === 'chain-binomial') {
            let tot = 0; for (const j of fl) tot += a[j];
            if (tot <= 0) continue;
            let left = rng.binomial(Math.round(y[c]), 1 - Math.exp(-(tot / y[c]) * hh));
            let rem = tot;
            for (let q = 0; q < fl.length; q++) { const j = fl[q]; const k = q === fl.length - 1 ? left : rng.binomial(left, Math.min(1, a[j] / rem)); draws[j] = k; left -= k; rem -= a[j]; if (left <= 0) break; }
          } else {
            let avail = Math.round(y[c]);
            for (const j of fl) { const k = Math.min(avail, rng.poisson(a[j] * hh)); draws[j] = k; avail -= k; }
          }
        }
        for (let j = 0; j < nf; j++) if (draws[j] > 0) fire(j, draws[j]);
        t += hh; steps++;
      }
      t = stop;
      rows.push(Float64Array.from(y));
      if (ti % 50 === 0) opts.onProgress?.(ti / times.length);
    }
  }
  return pack(m, times, rows, { method, steps, ms: Date.now() - t0, stochastic: true, seed, settings: method === 'gillespie' ? {} : { step: m.spec.solver.step ?? (method === 'chain-binomial' ? Math.min(1, m.spec.time.dt) : Math.min(0.25, m.spec.time.dt)) } });
}

export function run(spec: ModelSpec, opts: RunOptions = {}): RunResult {
  const m = compile(spec);
  return spec.solver.method === 'rk45' || spec.solver.method === 'rk4' ? runOde(m, opts) : runStochastic(m, opts);
}

/** Spec <-> URL (shareable scenarios, no accounts). Base64url of the JSON text. */
export function specToParam(spec: ModelSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function specFromParam(s: string): ModelSpec {
  if (s.length > 60000) throw new SpecError(['shared spec is too large']);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const spec = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  const problems = validateSpec(spec);
  if (problems.length) throw new SpecError(problems);
  return spec;
}

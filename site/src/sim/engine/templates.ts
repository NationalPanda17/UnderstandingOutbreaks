/** Model catalogue: builds declarative specs for the teaching templates. Everything the UI does compiles to a spec.
 *  Every template is a simplified teaching model with generic, invented settings. */
import { SPEC_VERSION, type CompartmentDef, type FlowDef, type Intervention, type ModelSpec, type ParamDef, type SolverMethod } from './model';

export type TemplateId = 'SIR' | 'SIS' | 'SEIR' | 'SIRS' | 'SEIRD' | 'vector' | 'water' | 'asymp' | 'age';
export const BASIC_TEMPLATES: TemplateId[] = ['SIR', 'SIS', 'SEIR', 'SIRS', 'SEIRD'];
export const ROUTE_TEMPLATES: TemplateId[] = ['vector', 'water', 'asymp', 'age'];

export interface Options {
  template: TemplateId;
  N: number;
  I0: number;
  R0: number;                 // transmission, expressed as beta / gamma
  infectiousDays: number;
  incubationDays: number;
  waningDays: number;
  cfr: number;                // fatality fraction (SEIRD)
  days: number;
  // S2
  lifeYears: number;          // 0 = no births and deaths
  seasonalAmp: number;        // 0..1
  seasonalPeakDay: number;
  stagesE: number;            // Erlang stages (1 = exponential)
  stagesI: number;
  // vaccination
  vaxCoverage: number;        // 0..1
  vaxEfficacy: number;        // 0..1
  vaxMode: 'aon' | 'leaky';
  vaxDay: number;             // 0 = before the start; otherwise campaign start day
  vaxCampaignDays: number;
  vaxWaningDays: number;      // 0 = no waning
  // contact reduction
  reduce: number;             // 0..1
  reduceStart: number;
  reduceEnd: number;
  // isolation / tracing (S2 intervention library)
  isolationRate: number;      // per day, I -> Q
  tracingRate: number;        // per day, E -> Q (needs an E stage)
  // route templates
  vectorsPerHost: number;
  vectorLifeDays: number;
  vectorControl: number;      // 0..1 reduction of vector births in the window
  waterShare: number;         // share of transmission through water (0..1)
  waterDecayDays: number;
  wash: number;               // 0..1 reduction of waterborne transmission in the window
  asymFraction: number;
  asymRelInf: number;
  presymDays: number;
  ageGroups: { label: string; share: number }[];
  contact: number[][];        // synthetic, user-editable; contacts per day of group i with group j
  solver: SolverMethod;
  seed: number | null;
  dt: number;
}

export const DEFAULTS: Options = {
  template: 'SIR', N: 10000, I0: 5, R0: 2.5, infectiousDays: 5, incubationDays: 3, waningDays: 180, cfr: 0.01, days: 160,
  lifeYears: 0, seasonalAmp: 0, seasonalPeakDay: 0, stagesE: 1, stagesI: 1,
  vaxCoverage: 0, vaxEfficacy: 0.9, vaxMode: 'aon', vaxDay: 0, vaxCampaignDays: 14, vaxWaningDays: 0,
  reduce: 0, reduceStart: 20, reduceEnd: 60, isolationRate: 0, tracingRate: 0,
  vectorsPerHost: 2, vectorLifeDays: 14, vectorControl: 0, waterShare: 0.6, waterDecayDays: 20, wash: 0,
  asymFraction: 0.4, asymRelInf: 0.5, presymDays: 2,
  ageGroups: [{ label: 'Children', share: 0.25 }, { label: 'Adults', share: 0.55 }, { label: 'Older adults', share: 0.2 }],
  contact: [[8, 4, 1], [4, 6, 2], [1, 2, 3]],
  solver: 'rk45', seed: null, dt: 1,
};

const P = (value: number, min: number, max: number, unit: string, label: string): ParamDef => ({ value, min: Math.min(min, value), max: Math.max(max, value), unit, label });

export function buildModel(o: Options): ModelSpec {
  const comps: CompartmentDef[] = []; const flows: FlowDef[] = []; const params: Record<string, ParamDef> = {}; const ivs: Intervention[] = [];
  const stochastic = o.solver !== 'rk45' && o.solver !== 'rk4';
  const whole = (x: number) => (stochastic ? Math.round(x) : x);
  const gamma = 1 / o.infectiousDays;
  const seasonal = o.seasonalAmp > 0;
  const add = (c: CompartmentDef) => { comps.push(c); };
  const betaExpr = seasonal ? 'beta*(1+amp*cos(2*pi*(t-peak)/365))' : 'beta';
  if (seasonal) { params.amp = P(o.seasonalAmp, 0, 1, '1', 'Seasonal amplitude'); params.peak = P(o.seasonalPeakDay, 0, 365, 'day', 'Day of peak transmission'); }
  const windowed = o.reduce > 0 && o.reduceEnd > o.reduceStart;

  if (o.template === 'vector') {
    const Nv = whole(o.N * o.vectorsPerHost); const muv = 1 / o.vectorLifeDays;
    // host-vector model in the spirit of Ross–Macdonald; R0^2 = (a^2 bh bv m) / (gamma muv). Here a*bh = a*bv = k is chosen so that R0 matches the slider.
    const k = o.R0 * Math.sqrt((gamma * muv) / o.vectorsPerHost);
    add({ id: 'Sh', label: 'Susceptible hosts', initial: whole(o.N - o.I0) }); add({ id: 'Ih', label: 'Infectious hosts', initial: whole(o.I0), infected: true }); add({ id: 'Rh', label: 'Recovered hosts', initial: 0 });
    add({ id: 'Sv', label: 'Susceptible vectors', initial: Nv }); add({ id: 'Iv', label: 'Infectious vectors', initial: 0, infected: true });
    params.k = P(k, 0, 5, '1/day', 'Biting rate × transmission probability'); params.gamma = P(gamma, 0.01, 2, '1/day', 'Host recovery rate'); params.muv = P(muv, 0.005, 1, '1/day', 'Vector death rate'); params.kv = P(1, 0, 1, '1', 'Vector birth multiplier');
    flows.push({ id: 'inf_host', from: 'Sh', to: 'Ih', rate: 'k*Sh*Iv/(Sh+Ih+Rh)', infection: true, label: 'Vector-to-host infection' }, { id: 'rec_host', from: 'Ih', to: 'Rh', rate: 'gamma*Ih' },
      { id: 'birth_vec', from: null, to: 'Sv', rate: 'kv*muv*(Sv+Iv)' }, { id: 'inf_vec', from: 'Sv', to: 'Iv', rate: 'k*Sv*Ih/(Sh+Ih+Rh)', infection: true, label: 'Host-to-vector infection' },
      { id: 'death_sv', from: 'Sv', to: null, rate: 'muv*Sv' }, { id: 'death_iv', from: 'Iv', to: null, rate: 'muv*Iv' });
    if (o.vectorControl > 0 && o.reduceEnd > o.reduceStart) ivs.push({ id: 'vector_control', label: 'Vector control', type: 'scale', param: 'kv', value: 1 - o.vectorControl, start: o.reduceStart, end: o.reduceEnd });
  } else if (o.template === 'water') {
    const delta = 1 / o.waterDecayDays;
    add({ id: 'S', label: 'Susceptible', initial: whole(o.N - o.I0) }); add({ id: 'I', label: 'Infectious', initial: whole(o.I0), infected: true }); add({ id: 'R', label: 'Recovered', initial: 0 }); add({ id: 'W', label: 'Pathogen in water (scaled)', initial: 0, infected: true });
    // SIWR-style model: R0 = (bI + bW) / gamma when W is scaled so that shedding rate = decay rate
    params.bI = P(o.R0 * gamma * (1 - o.waterShare), 0, 5, '1/day', 'Person-to-person transmission'); params.bW = P(o.R0 * gamma * o.waterShare, 0, 5, '1/day', 'Waterborne transmission');
    params.gamma = P(gamma, 0.01, 2, '1/day', 'Recovery rate'); params.delta = P(delta, 0.005, 2, '1/day', 'Pathogen decay rate in water');
    flows.push({ id: 'infection', from: 'S', to: 'I', rate: 'bI*S*I/(S+I+R) + bW*S*W/(S+I+R)', infection: true }, { id: 'recovery', from: 'I', to: 'R', rate: 'gamma*I' },
      { id: 'shedding', from: null, to: 'W', rate: 'delta*I', label: 'Shedding into water' }, { id: 'decay', from: 'W', to: null, rate: 'delta*W', label: 'Decay in water' });
    if (o.wash > 0 && o.reduceEnd > o.reduceStart) ivs.push({ id: 'wash', label: 'Water and sanitation measures', type: 'scale', param: 'bW', value: 1 - o.wash, start: o.reduceStart, end: o.reduceEnd });
  } else if (o.template === 'asymp') {
    const alpha = 1 / o.presymDays; const sigma = 1 / o.incubationDays;
    const denom = o.presymDays * 1 + o.asymFraction * o.asymRelInf * o.infectiousDays + (1 - o.asymFraction) * o.infectiousDays; // total infectiousness-days with rP = 1
    add({ id: 'S', label: 'Susceptible', initial: whole(o.N - o.I0) }); add({ id: 'E', label: 'Exposed', initial: 0, infected: true }); add({ id: 'P', label: 'Presymptomatic', initial: whole(o.I0), infected: true });
    add({ id: 'I', label: 'Symptomatic', initial: 0, infected: true }); add({ id: 'A', label: 'Asymptomatic', initial: 0, infected: true }); add({ id: 'R', label: 'Recovered', initial: 0 });
    params.beta = P(o.R0 / denom, 0, 5, '1/day', 'Transmission rate'); params.sigma = P(sigma, 0.02, 5, '1/day', 'Rate of leaving the exposed stage'); params.alpha = P(alpha, 0.05, 5, '1/day', 'Rate of leaving the presymptomatic stage');
    params.gamma = P(gamma, 0.01, 2, '1/day', 'Recovery rate'); params.pa = P(o.asymFraction, 0, 1, '1', 'Fraction never showing symptoms'); params.ra = P(o.asymRelInf, 0, 1, '1', 'Relative infectiousness without symptoms');
    flows.push({ id: 'infection', from: 'S', to: 'E', rate: `${betaExpr}*S*(P + I + ra*A)/N`, infection: true }, { id: 'onset', from: 'E', to: 'P', rate: 'sigma*E' },
      { id: 'symptoms', from: 'P', to: 'I', rate: '(1-pa)*alpha*P' }, { id: 'no_symptoms', from: 'P', to: 'A', rate: 'pa*alpha*P' }, { id: 'rec_i', from: 'I', to: 'R', rate: 'gamma*I' }, { id: 'rec_a', from: 'A', to: 'R', rate: 'gamma*A' });
    if (o.isolationRate > 0) { add({ id: 'Q', label: 'Isolated', initial: 0 }); params.iso = P(o.isolationRate, 0, 2, '1/day', 'Isolation rate of symptomatic cases'); flows.push({ id: 'isolation', from: 'I', to: 'Q', rate: 'iso*I' }, { id: 'rec_q', from: 'Q', to: 'R', rate: 'gamma*Q' }); }
    if (windowed) ivs.push({ id: 'contact_reduction', label: 'Contact reduction', type: 'scale', param: 'beta', value: 1 - o.reduce, start: o.reduceStart, end: o.reduceEnd });
  } else if (o.template === 'age') {
    const G = o.ageGroups.length; const tot = o.ageGroups.reduce((a, g) => a + g.share, 0);
    const sizes = o.ageGroups.map((g) => (o.N * g.share) / tot);
    // q scales the synthetic contact matrix so that the next-generation matrix has spectral radius R0
    const K = o.contact.map((row, i) => row.map((c, j) => (c * sizes[i]) / sizes[j] / gamma));
    params.q = P(o.R0 / spectralRadius(K), 0, 5, '1', 'Transmission probability per contact'); params.gamma = P(gamma, 0.01, 2, '1/day', 'Recovery rate');
    o.ageGroups.forEach((_g, i) => {
      const n = whole(sizes[i]); const i0 = i === 1 || G === 1 ? whole(o.I0) : 0;
      add({ id: `S${i + 1}`, label: `Susceptible, ${o.ageGroups[i].label}`, initial: Math.max(0, n - i0) }); add({ id: `I${i + 1}`, label: `Infectious, ${o.ageGroups[i].label}`, initial: i0, infected: true }); add({ id: `R${i + 1}`, label: `Recovered, ${o.ageGroups[i].label}`, initial: 0 });
      params[`n${i + 1}`] = P(sizes[i], 1, o.N, 'people', `Size of group ${o.ageGroups[i].label}`);
      o.ageGroups.forEach((_h, j) => { params[`c${i + 1}${j + 1}`] = P(o.contact[i][j], 0, 50, '1/day', `Contacts per day: ${o.ageGroups[i].label} with ${o.ageGroups[j].label}`); });
    });
    o.ageGroups.forEach((_g, i) => {
      const foi = o.ageGroups.map((_h, j) => `c${i + 1}${j + 1}*I${j + 1}/n${j + 1}`).join(' + ');
      flows.push({ id: `inf${i + 1}`, from: `S${i + 1}`, to: `I${i + 1}`, rate: `q*S${i + 1}*(${foi})`, infection: true }, { id: `rec${i + 1}`, from: `I${i + 1}`, to: `R${i + 1}`, rate: `gamma*I${i + 1}` });
    });
    if (windowed) ivs.push({ id: 'contact_reduction', label: 'Contact reduction', type: 'scale', param: 'q', value: 1 - o.reduce, start: o.reduceStart, end: o.reduceEnd });
  } else {
    // SIR / SIS / SEIR / SIRS / SEIRD with optional Erlang stages, demography, seasonality, vaccination, isolation, tracing
    const hasE = o.template === 'SEIR' || o.template === 'SEIRD';
    const kE = hasE ? Math.max(1, Math.round(o.stagesE)) : 0; const kI = Math.max(1, Math.round(o.stagesI));
    const Is = Array.from({ length: kI }, (_, i) => (kI === 1 ? 'I' : `I${i + 1}`)); const Es = Array.from({ length: kE }, (_, i) => (kE === 1 ? 'E' : `E${i + 1}`));
    const dead = o.template === 'SEIRD';
    const pre = o.vaxCoverage > 0 && o.vaxDay <= 0;
    let s0 = o.N - o.I0; let v0 = 0; let sv0 = 0;
    if (pre && o.vaxMode === 'aon') { v0 = s0 * o.vaxCoverage * o.vaxEfficacy; s0 -= v0; }
    if (pre && o.vaxMode === 'leaky') { sv0 = s0 * o.vaxCoverage; s0 -= sv0; }
    const useV = o.vaxCoverage > 0 && o.vaxMode === 'aon'; const useSv = o.vaxCoverage > 0 && o.vaxMode === 'leaky';
    add({ id: 'S', label: 'Susceptible', initial: whole(s0) });
    if (useSv) add({ id: 'Sv', label: 'Vaccinated, partly protected', initial: whole(sv0) });
    if (useV) add({ id: 'V', label: 'Vaccinated, immune', initial: whole(v0) });
    Es.forEach((e, i) => add({ id: e, label: kE === 1 ? 'Exposed' : `Exposed, stage ${i + 1}`, initial: 0, infected: true }));
    Is.forEach((c, i) => add({ id: c, label: kI === 1 ? 'Infectious' : `Infectious, stage ${i + 1}`, initial: i === 0 ? whole(o.I0) : 0, infected: true }));
    if (o.template !== 'SIS') add({ id: 'R', label: 'Recovered', initial: 0 });
    if (dead) add({ id: 'D', label: 'Died', initial: 0 });
    const living = dead ? '(N-D)' : 'N';
    const Isum = Is.length === 1 ? 'I' : `(${Is.join('+')})`;
    params.beta = P(o.R0 * gamma, 0, 10, '1/day', 'Transmission rate'); params.gamma = P(gamma, 0.01, 2, '1/day', 'Recovery rate');
    const to = hasE ? Es[0] : Is[0];
    flows.push({ id: 'infection', from: 'S', to, rate: `${betaExpr}*S*${Isum}/${living}`, infection: true, label: 'Infection' });
    if (useSv) { params.ve = P(o.vaxEfficacy, 0, 1, '1', 'Vaccine efficacy (leaky)'); flows.push({ id: 'infection_v', from: 'Sv', to, rate: `(1-ve)*${betaExpr}*Sv*${Isum}/${living}`, infection: true, label: 'Infection of vaccinated' }); }
    if (hasE) {
      params.sigma = P(1 / o.incubationDays, 0.02, 5, '1/day', 'Rate of becoming infectious');
      Es.forEach((e, i) => flows.push({ id: `progress${i + 1}`, from: e, to: i === kE - 1 ? Is[0] : Es[i + 1], rate: `${kE === 1 ? '' : kE + '*'}sigma*${e}` }));
    }
    Is.forEach((c, i) => {
      const r = `${kI === 1 ? '' : kI + '*'}gamma*${c}`;
      if (i < kI - 1) flows.push({ id: `stage${i + 1}`, from: c, to: Is[i + 1], rate: r });
      else if (o.template === 'SIS') flows.push({ id: 'recovery', from: c, to: 'S', rate: r });
      else if (dead) { params.cfr = P(o.cfr, 0, 1, '1', 'Fatality fraction'); flows.push({ id: 'recovery', from: c, to: 'R', rate: `(1-cfr)*${r}` }, { id: 'death', from: c, to: 'D', rate: `cfr*${r}`, label: 'Death from infection' }); }
      else flows.push({ id: 'recovery', from: c, to: 'R', rate: r });
    });
    if (o.template === 'SIRS') { params.omega = P(1 / o.waningDays, 0.0005, 1, '1/day', 'Rate of losing immunity'); flows.push({ id: 'waning', from: 'R', to: 'S', rate: 'omega*R' }); }
    if (o.vaxCoverage > 0 && o.vaxDay > 0) {
      // campaign: a constant per-capita rate that vaccinates `coverage` of susceptibles over the campaign window
      params.nu = P(0, 0, 5, '1/day', 'Vaccination rate (active during the campaign)');
      const rate = -Math.log(1 - Math.min(0.999, o.vaxCoverage)) / Math.max(1, o.vaxCampaignDays);
      if (useV) { params.eff = P(o.vaxEfficacy, 0, 1, '1', 'Vaccine efficacy (all-or-nothing)'); flows.push({ id: 'vaccination', from: 'S', to: 'V', rate: 'nu*eff*S' }); } else flows.push({ id: 'vaccination', from: 'S', to: 'Sv', rate: 'nu*S' });
      ivs.push({ id: 'campaign', label: 'Vaccination campaign', type: 'set', param: 'nu', value: rate, start: o.vaxDay, end: o.vaxDay + Math.max(1, o.vaxCampaignDays) });
    }
    if (o.vaxCoverage > 0 && o.vaxWaningDays > 0) { params.omegaV = P(1 / o.vaxWaningDays, 0.0005, 1, '1/day', 'Rate of losing vaccine protection'); flows.push({ id: 'vax_waning', from: useV ? 'V' : 'Sv', to: 'S', rate: `omegaV*${useV ? 'V' : 'Sv'}` }); }
    if (o.isolationRate > 0 || (o.tracingRate > 0 && hasE)) {
      add({ id: 'Q', label: 'Isolated or quarantined', initial: 0 });
      if (o.isolationRate > 0) { params.iso = P(o.isolationRate, 0, 2, '1/day', 'Isolation rate of infectious people'); Is.forEach((c, i) => flows.push({ id: `isolation${i + 1}`, from: c, to: 'Q', rate: `iso*${c}` })); }
      if (o.tracingRate > 0 && hasE) { params.trace = P(o.tracingRate, 0, 2, '1/day', 'Tracing and quarantine rate of exposed people'); Es.forEach((e, i) => flows.push({ id: `tracing${i + 1}`, from: e, to: 'Q', rate: `trace*${e}` })); }
      flows.push({ id: 'rec_q', from: 'Q', to: o.template === 'SIS' ? 'S' : 'R', rate: 'gamma*Q' });
    }
    if (o.lifeYears > 0) {
      params.mu = P(1 / (o.lifeYears * 365), 1e-6, 0.01, '1/day', 'Birth and death rate');
      flows.push({ id: 'birth', from: null, to: 'S', rate: `mu*${living}`, label: 'Births' });
      comps.filter((c) => c.id !== 'D').forEach((c) => flows.push({ id: `death_${c.id}`, from: c.id, to: null, rate: `mu*${c.id}`, label: 'Deaths from other causes' }));
    }
    if (windowed) ivs.push({ id: 'contact_reduction', label: 'Contact reduction', type: 'scale', param: 'beta', value: 1 - o.reduce, start: o.reduceStart, end: o.reduceEnd });
  }
  return {
    specVersion: SPEC_VERSION, id: `${o.template.toLowerCase()}-teaching`, name: `${o.template} teaching model`, template: o.template, compartments: comps, parameters: params, flows, interventions: ivs,
    time: { days: o.days, dt: o.dt }, solver: { method: o.solver }, seed: stochastic ? o.seed ?? 1 : null, teachingScenario: null,
    notes: 'Illustrative teaching model with invented settings. Not fitted to data. Not a forecast.',
  };
}

export function spectralRadius(K: number[][]): number {
  const n = K.length; let v = new Array(n).fill(1 / n); let lam = 0;
  for (let it = 0; it < 2000; it++) {
    const w = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = v[i]; for (let j = 0; j < n; j++) s += K[i][j] * v[j]; w[i] = s; } // (K + I) removes periodicity
    const norm = w.reduce((a, b) => a + Math.abs(b), 0);
    if (!(norm > 0)) return 0;
    const next = w.map((x) => x / norm);
    const diff = next.reduce((a, x, i) => a + Math.abs(x - v[i]), 0);
    v = next; lam = norm;
    if (diff < 1e-13) break;
  }
  return lam - 1;
}

/** Assumptions each template makes, and which are known to fail in real outbreaks. Keys are translated in the UI. */
export function assumptions(spec: ModelSpec): { key: string; fails: boolean }[] {
  const closed = spec.flows.every((f) => f.from !== null && f.to !== null);
  const seasonal = 'amp' in spec.parameters;
  const staged = spec.compartments.some((c) => /^[EI]\d$/.test(c.id)) && spec.template !== 'age';
  const out = [
    { key: spec.template === 'age' ? 'mixingByGroup' : 'homogeneousMixing', fails: true },
    { key: seasonal ? 'seasonalRates' : 'constantRates', fails: true },
    { key: closed ? 'closedPopulation' : 'openPopulation', fails: closed },
    { key: staged ? 'erlangDurations' : 'exponentialDurations', fails: !staged },
    { key: 'noBehaviourChange', fails: true },
    { key: 'perfectObservation', fails: true },
    { key: spec.solver.method === 'rk45' || spec.solver.method === 'rk4' ? 'deterministic' : 'stochastic', fails: spec.solver.method === 'rk45' || spec.solver.method === 'rk4' },
  ];
  if (['SIR', 'SEIR', 'SEIRD', 'vector', 'water', 'asymp', 'age'].includes(spec.template ?? '')) out.push({ key: 'lifelongImmunity', fails: true });
  return out;
}

# Simulation sandbox ("Learn and simulate")

**Illustrative simulations: not forecasts, not fitted to data.** The sandbox is a teaching tool. It never describes a
real current outbreak.

## Boundaries (enforced in code, copy and tests)

| Boundary | How it is enforced |
|---|---|
| No fitting, calibration, inference, R estimation from data, nowcasting or forecasting | No such function exists; `site/tests/site.test.ts` scans exported names and interface strings |
| The engine cannot read reported data | `src/sim/engine` and `src/sim/worker.ts` import nothing from the data layer and make no network calls (test) |
| No initialisation from live counts; relative time only | Specs reject unknown fields (`data`, `fitTo`, `place`, …); the time axis is "day 0, day 1, …"; a teaching scenario may carry an invented start label only |
| Generic invented settings | "A town of 10,000", "a school of 800", "a city of 250,000"; map patches are user-placed, labelled illustrative, with synthetic coupling |
| Always labelled | Persistent banner on every view; dashed purple lines; "SIMULATED" badges; watermark inside the chart and in every PNG/SVG; exports and embeds carry the disclaimer |
| Shape comparison is qualitative only | Off by default; separate chart and axis; only complete past years; a notice; no fit, no error metric, no extrapolation |

## Model specification (schema version 1.0)

Everything the interface does compiles to a JSON spec (`site/src/sim/engine/model.ts`):

```json
{
  "specVersion": "1.0", "id": "seir-teaching", "name": "SEIR teaching model", "template": "SEIR",
  "compartments": [{"id": "S", "label": "Susceptible", "initial": 9995}, {"id": "I", "initial": 5, "infected": true}],
  "parameters": {"beta": {"value": 0.5, "min": 0, "max": 10, "unit": "1/day", "label": "Transmission rate"}},
  "flows": [{"id": "infection", "from": "S", "to": "E", "rate": "beta*S*I/N", "infection": true}],
  "interventions": [{"id": "contact_reduction", "type": "scale", "param": "beta", "value": 0.5, "start": 20, "end": 60}],
  "time": {"days": 160, "dt": 1},
  "solver": {"method": "rk45", "rtol": 1e-7, "atol": 1e-9},
  "seed": null,
  "teachingScenario": null
}
```

- `rate` is the total flow in people per day, written in a small expression language: numbers, compartment and
  parameter names, `N` (total population), `t` (day), `pi`, `+ - * / ^`, and `exp log sqrt sin cos abs min max pow
  step`. Expressions are parsed to an AST and compiled to closures (`expr.ts`). There is no `eval`; anything outside
  the grammar is rejected.
- `interventions` scale or set a parameter between two relative days.
- Validation rejects unknown fields, bad ids, values outside ranges, unknown names in rates, and sizes over the
  limits. Compilation checks that rates are finite and non-negative at the start, reports whether the population is
  conserved, and warns when an outflow does not vanish with its source.
- Specs are shared as URLs (base64url of the JSON) and exported or imported as files. No accounts, no server.

Every run records engine version, spec version, seed and solver settings.

## Solvers

All solvers run in a Web Worker (`src/sim/worker.ts`) with progress and cancel (cancel terminates the worker).

| Method | Notes |
|---|---|
| `rk45` | Dormand–Prince 5(4) with adaptive steps; restarts at intervention times; integrates cumulative flows for incidence |
| `rk4` | Fixed-step classical Runge–Kutta, as a reference |
| `chain-binomial` | Discrete time; per-compartment exit binomial with multinomial split across flows |
| `gillespie` | Exact direct method; parameters change only at intervention times; event cap with a clear message |
| `tau-leap` | Poisson leaps, limited so no compartment goes negative |

Random numbers: mulberry32, seeded, with independent forks for ensemble members: runs are exactly reproducible.
Limits: 60 compartments, 240 flows, 3,650 days, 4,000 output points, population 10¹⁰ (ODE) or 2,000,000 (stochastic),
3,000,000 Gillespie events, 1,000 realisations, 5,000 network nodes, 30 patches.

## Model catalogue

| Tier | Template | Equations (flows) |
|---|---|---|
| S1 | SIR | S→I: βSI/N; I→R: γI |
| S1 | SIS | S→I: βSI/N; I→S: γI |
| S1 | SEIR | S→E: βSI/N; E→I: σE; I→R: γI |
| S1 | SIRS | SIR plus R→S: ωR |
| S1 | SEIRD | SEIR with I→R: (1−f)γI and I→D: fγI; mixing among the living, N−D |
| S1 | Vaccination | all-or-nothing: a share coverage×efficacy starts immune (or S→V: ν·e·S in a campaign); leaky: vaccinated are infected at (1−e)β |
| S1 | Contact reduction | β scaled by (1−reduction) between two days |
| S2 | Births and deaths | →S: μN; X→: μX for every living compartment |
| S2 | Seasonal forcing | β(t) = β(1 + a·cos(2π(t−peak)/365)) |
| S2 | Erlang stages | E and I split into k sub-stages with rates kσ, kγ |
| S2 | Age-structured | S_i→I_i: q·S_i·Σ_j c_ij I_j/n_j; synthetic, editable contact matrix |
| S2 | Vector-borne (Ross–Macdonald style) | S_h→I_h: k·S_h·I_v/N_h; S_v→I_v: k·S_v·I_h/N_h; vector births and deaths μ_v |
| S2 | Waterborne (SIWR style) | S→I: b_I·S·I/N + b_W·S·W/N; shedding →W: δI; decay W→: δW |
| S2 | Asymptomatic / presymptomatic | S→E→P→{I, A}→R with infectiousness P, I and r_A·A |
| S2 | Isolation, tracing | I→Q: iso·I; E→Q: trace·E; Q→R: γQ |
| S2 | Observation layer | under-reporting, gamma reporting delay, weekly batching, definition change, testing ramp, "as known on day T" |
| S3 | Ensembles, branching process, next-generation matrix, sweeps (1- and 2-way, Latin hypercube, PRCC, tornado), phase plane and bifurcation, networks (random, small-world, scale-free, community), metapopulation (gravity or distance decay), custom builder |

Assumptions shown for every model: homogeneous (or group-wise) mixing, constant or smoothly seasonal rates, closed or
balanced population, exponential or Erlang stage durations, no behaviour change, perfect observation, deterministic
or stochastic, lasting immunity. Each is marked when it is known to fail in real outbreaks, with the reason.

## Analytical tools

- **Next-generation matrix** (van den Driessche & Watmough 2002): F from infection flows, V from all other flows of
  infected compartments, derivatives by central differences at the disease-free state with N held fixed;
  R = ρ(FV⁻¹) by power iteration on K+I. F, V and FV⁻¹ are shown.
- **Effective reproduction number** along a run: the same construction at each output time's state.
- **Final size:** z = s₀(1 − e^(−R₀z)). **Herd immunity threshold:** 1 − 1/R₀. **Doubling time:** ln 2 / r from a
  log-linear fit to the *simulated* early curve.
- **Branching process:** extinction probability from q = G(q) for Poisson or negative-binomial offspring.

## Validation results

From `site/tests/sim-engine.test.ts` (41 tests passing; 1 skipped locally because R was not installed):

| Check | Result |
|---|---|
| Population conservation, all closed templates, ODE | relative drift < 1e-7 |
| Stochastic solvers conserve whole people, never negative | exact |
| SIR final size vs final-size relation, R₀ = 1.5, 2.5, 4 | agreement to 3 decimals |
| Threshold at R₀ = 1 | no growth below; outbreak above |
| Endemic equilibrium, SIR with demography | S*/N = 1/R₀ to 3 decimals; I*/N to 5 decimals |
| Herd immunity threshold | coverage above 1 − 1/R₀ prevents growth; below does not |
| Next-generation R₀: SIR, SEIR, Erlang SEIR, vector, waterborne, asymptomatic, age-structured, demography, vaccination | matches the closed form to 5–6 decimals |
| Effective R = 1 at the epidemic peak | within 0.06 |
| RK4 convergence to the adaptive solution | error ratio > 8 on halving the step |
| Agreement with scipy `solve_ivp` (DOP853, rtol 1e-11), SEIR | absolute difference < 1e-3 people of 10,000 |
| Reproducibility from seed (Gillespie, tau-leap, chain binomial) | identical trajectories; different seeds differ |
| Ensemble median vs ODE at the peak, N = 100,000 | within 5% |
| Observation layer | reported total = fraction × truth; delays shift the peak later; recent days incomplete; weekly batching; reproducible |
| Branching extinction | 1 below threshold; 0.5 for geometric offspring with R = 2 (analytical and simulated) |
| Networks | size, symmetry, mean degree, size cap, node conservation, reproducibility |
| Metapopulation | coupling rows sum to 1; uncoupled patches stay uninfected; nearer patches peak earlier; population conserved |
| Latin hypercube and PRCC | every stratum used once; correct sign for monotone effects |
| Unsafe expressions and specs | rejected (16 expression cases; data/fit/place fields) |
| Generated Python (scipy) vs in-browser | relative difference < 2e-6 for three models including interventions and seasonality |
| Generated R (deSolve) vs in-browser | **CI only** (not run locally) |

Reference outputs from deSolve are therefore produced in CI rather than recorded in the repository.

## Reproducibility and outputs

Every run exports its spec, seed, engine version and results as JSON and CSV in one zip with a provenance file;
"copy as code" produces Python (numpy/scipy) or R (deSolve) for compartmental models and plain numpy for networks;
PNG and SVG exports bake in the watermark, parameters, seed and engine version, with a caption that calls the figure
a simulation. Simulation embeds always show the banner and load only the solver they need.

## Learning layer

Eleven lessons in four paths, three challenges, a misconceptions page, "why simulations are not predictions",
scenario packs (static JSON) with printable worksheets and shareable links. All static, translated content.

## Presets and references

See `docs/SOURCES.md`. Presets are illustrative ranges with citations and a verification status; unverifiable values
are omitted or labelled "unverified, user-supplied".

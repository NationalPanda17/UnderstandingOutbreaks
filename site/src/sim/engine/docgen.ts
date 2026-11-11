/** Auto-generated documentation and reproducible code for any model spec:
 *  equations (LaTeX), a flow diagram (SVG), a plain-language outline, and equivalent Python / R code. */
import { parseExpr, toCode, toTex } from './expr';
import { ENGINE_VERSION, type ModelSpec } from './model';

const GREEK: Record<string, string> = { beta: '\\beta', gamma: '\\gamma', sigma: '\\sigma', omega: '\\omega', mu: '\\mu', alpha: '\\alpha', delta: '\\delta', nu: '\\nu', omegaV: '\\omega_V', muv: '\\mu_v' };
export function texSymbol(id: string): string {
  if (GREEK[id]) return GREEK[id];
  const m = /^([A-Za-z]+?)(\d+(?:_\d+)?)$/.exec(id);
  if (m) return `${GREEK[m[1]] ?? (m[1].length > 1 ? `\\mathit{${m[1]}}` : m[1])}_{${m[2].replace('_', ',')}}`;
  if (/^[A-Z][a-z]$/.test(id)) return `${id[0]}_{${id[1]}}`;
  return id.length > 1 ? `\\mathit{${id.replace(/_/g, '\\_')}}` : id;
}

/** One differential equation per compartment: dX/dt = sum of inflows - sum of outflows. */
export function equationsTex(spec: ModelSpec): string[] {
  return spec.compartments.map((c) => {
    const terms: string[] = [];
    for (const f of spec.flows) {
      const tex = toTex(parseExpr(f.rate), texSymbol, 2);
      if (f.to === c.id) terms.push(`+ ${tex}`);
      if (f.from === c.id) terms.push(`- ${tex}`);
    }
    const rhs = terms.length ? terms.join(' ').replace(/^\+ /, '') : '0';
    return `\\frac{d${texSymbol(c.id)}}{dt} = ${rhs}`;
  });
}

/** Simple left-to-right flow diagram. Compartments are placed by their distance from a source compartment. */
export function flowDiagramSvg(spec: ModelSpec, labels: { simulated: string; inflow: string; outflow: string }): string {
  const ids = spec.compartments.map((c) => c.id);
  const depth: Record<string, number> = {};
  const hasIn = new Set(spec.flows.filter((f) => f.from !== null && f.to !== null).map((f) => f.to as string));
  const roots = ids.filter((i) => !hasIn.has(i)); (roots.length ? roots : [ids[0]]).forEach((r) => { depth[r] = 0; });
  for (let it = 0; it < ids.length; it++) for (const f of spec.flows) if (f.from && f.to && depth[f.from] !== undefined && depth[f.to] === undefined) depth[f.to] = depth[f.from] + 1;
  ids.forEach((i) => { if (depth[i] === undefined) depth[i] = 0; });
  const cols: string[][] = []; ids.forEach((i) => { (cols[depth[i]] ??= []).push(i); });
  const bw = 78; const bh = 38; const gx = 62; const gy = 26;
  const rowsMax = Math.max(...cols.map((c) => c?.length ?? 0));
  const W = 30 + cols.length * (bw + gx); const H = 44 + rowsMax * (bh + gy);
  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach((col, ci) => (col ?? []).forEach((id, ri) => { pos[id] = { x: 24 + ci * (bw + gx), y: 30 + ri * (bh + gy) + ((rowsMax - col.length) * (bh + gy)) / 2 }; }));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="system-ui, sans-serif"><title>${esc(spec.name)}</title><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4b2a73"/></marker></defs><rect width="${W}" height="${H}" fill="#ffffff"/>`;
  out += `<text x="${W - 6}" y="14" text-anchor="end" font-size="10" font-weight="700" fill="#6a3d9a">${esc(labels.simulated)}</text>`;
  const seen = new Set<string>();
  for (const f of spec.flows) {
    const key = `${f.from}>${f.to}`; if (seen.has(key)) continue; seen.add(key);
    const a = f.from ? pos[f.from] : null; const b = f.to ? pos[f.to] : null;
    if (a && b) {
      const back = b.x < a.x; const same = b.x === a.x;
      if (same) out += `<path d="M${a.x + bw / 2},${a.y + (b.y > a.y ? bh : 0)} L${b.x + bw / 2},${b.y + (b.y > a.y ? 0 : bh)}" stroke="#4b2a73" stroke-width="1.4" stroke-dasharray="5 3" fill="none" marker-end="url(#arr)"/>`;
      else if (back) out += `<path d="M${a.x + bw / 2},${a.y} C${a.x + bw / 2},${a.y - 26} ${b.x + bw / 2},${b.y - 26} ${b.x + bw / 2},${b.y}" stroke="#4b2a73" stroke-width="1.4" stroke-dasharray="5 3" fill="none" marker-end="url(#arr)"/>`;
      else out += `<path d="M${a.x + bw},${a.y + bh / 2} L${b.x},${b.y + bh / 2}" stroke="#4b2a73" stroke-width="1.4" stroke-dasharray="5 3" fill="none" marker-end="url(#arr)"/>`;
    } else if (b) out += `<path d="M${b.x + 14},${b.y - 16} L${b.x + 14},${b.y}" stroke="#4b2a73" stroke-width="1.2" stroke-dasharray="2 3" fill="none" marker-end="url(#arr)"><title>${esc(labels.inflow)}</title></path>`;
    else if (a) out += `<path d="M${a.x + bw - 14},${a.y + bh} L${a.x + bw - 14},${a.y + bh + 16}" stroke="#4b2a73" stroke-width="1.2" stroke-dasharray="2 3" fill="none" marker-end="url(#arr)"><title>${esc(labels.outflow)}</title></path>`;
  }
  for (const c of spec.compartments) { const p = pos[c.id]; out += `<rect x="${p.x}" y="${p.y}" width="${bw}" height="${bh}" rx="7" fill="${c.infected ? '#f1eafa' : '#ffffff'}" stroke="#6a3d9a" stroke-width="1.5" stroke-dasharray="${c.infected ? '0' : '4 3'}"><title>${esc(c.label ?? c.id)}</title></rect><text x="${p.x + bw / 2}" y="${p.y + bh / 2 + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="#2b1746">${esc(c.id)}</text>`; }
  return out + '</svg>';
}

const header = (spec: ModelSpec, c: string) => [
  `${c} ILLUSTRATIVE SIMULATION: not a forecast, not fitted to data.`,
  `${c} Reproduces a run of the Understanding Outbreaks teaching sandbox (engine ${ENGINE_VERSION}, model spec ${spec.specVersion}).`,
  `${c} Model: ${spec.name}. Solver in the browser: ${spec.solver.method}${spec.seed !== null ? `, seed ${spec.seed}` : ''}.`,
].join('\n');

function paramSetup(spec: ModelSpec, lang: 'py' | 'r'): { lines: string[]; name: (id: string) => string } {
  const comps = spec.compartments.map((c) => c.id); const params = Object.keys(spec.parameters);
  const name = (id: string) => (id === 't' ? 't' : id === 'N' ? 'N' : comps.includes(id) ? `y[${comps.indexOf(id) + (lang === 'r' ? 1 : 0)}]` : lang === 'py' ? `p["${id}"]` : `p[["${id}"]]`);
  const lines: string[] = [];
  if (lang === 'py') {
    lines.push('BASE = {' + params.map((k) => `"${k}": ${spec.parameters[k].value}`).join(', ') + '}');
    lines.push('INTERVENTIONS = [' + (spec.interventions ?? []).map((iv) => `("${iv.type}", "${iv.param}", ${iv.value}, ${iv.start}, ${iv.end})`).join(', ') + ']');
    lines.push('', 'def params_at(t):', '    p = dict(BASE)', '    for kind, name, value, start, end in INTERVENTIONS:', '        if start <= t < end:', '            p[name] = p[name] * value if kind == "scale" else value', '    return p');
  } else {
    lines.push('BASE <- list(' + params.map((k) => `${k} = ${spec.parameters[k].value}`).join(', ') + ')');
    lines.push('INTERVENTIONS <- list(' + (spec.interventions ?? []).map((iv) => `list(kind = "${iv.type}", name = "${iv.param}", value = ${iv.value}, start = ${iv.start}, end = ${iv.end})`).join(', ') + ')');
    lines.push('params_at <- function(t) {', '  p <- BASE', '  for (iv in INTERVENTIONS) if (t >= iv$start && t < iv$end) p[[iv$name]] <- if (iv$kind == "scale") p[[iv$name]] * iv$value else iv$value', '  p', '}');
  }
  return { lines, name };
}

/** Python (numpy + scipy) code that reproduces a deterministic run. Stochastic runs are reproduced as their ODE counterpart, with a note. */
export function pythonSim(spec: ModelSpec): string {
  const comps = spec.compartments.map((c) => c.id); const n = comps.length; const { lines, name } = paramSetup(spec, 'py');
  const L = [header(spec, '#'), '# Requires: pip install numpy scipy', 'import numpy as np', 'from scipy.integrate import solve_ivp', ''];
  if (spec.solver.method !== 'rk45' && spec.solver.method !== 'rk4') L.push('# Note: the browser run was stochastic. This code integrates the matching deterministic (ODE) model,', '# which the average of many stochastic runs approaches for large populations.', '');
  L.push(`COMPARTMENTS = [${comps.map((c) => `"${c}"`).join(', ')}]`, `Y0 = [${spec.compartments.map((c) => c.initial).join(', ')}]`, ...lines, '', 'def rhs(t, y):', '    p = params_at(t)', `    N = sum(y[:${n}])`, `    d = [0.0] * ${n}`);
  spec.flows.forEach((f) => {
    L.push(`    r = ${toCode(parseExpr(f.rate), 'py', name)}  # ${f.id}`);
    if (f.from) L.push(`    d[${comps.indexOf(f.from)}] -= r`);
    if (f.to) L.push(`    d[${comps.indexOf(f.to)}] += r`);
  });
  L.push('    return d', '');
  const bps = Array.from(new Set((spec.interventions ?? []).flatMap((iv) => [iv.start, iv.end]).filter((x) => x > 0 && x < spec.time.days))).sort((a, b) => a - b);
  L.push(`T_END, DT = ${spec.time.days}, ${spec.time.dt}`, `BREAKS = [0.0, ${bps.map((b) => b.toFixed(6)).join(', ')}${bps.length ? ', ' : ''}float(T_END)]  # restart the solver where parameters jump`);
  L.push('t_out = np.arange(0, T_END + DT / 2, DT)', 'ys = [np.array(Y0, dtype=float)]', 'ts = [0.0]', 'y = np.array(Y0, dtype=float)', 'for a, b in zip(BREAKS[:-1], BREAKS[1:]):', '    grid = [x for x in t_out if a < x <= b + 1e-9]', '    sol = solve_ivp(rhs, (a, b), y, method="DOP853", t_eval=sorted(set(grid + [b])), rtol=1e-10, atol=1e-10)', '    for tt, col in zip(sol.t, sol.y.T):', '        if any(abs(tt - g) < 1e-9 for g in grid):', '            ts.append(float(tt)); ys.append(col.copy())', '    y = sol.y[:, -1]');
  L.push('result = np.column_stack([ts, np.array(ys)])', 'print(",".join(["t"] + COMPARTMENTS))', 'for row in result:', '    print(",".join(repr(float(v)) for v in row))');
  return L.join('\n') + '\n';
}

/** R (deSolve) code that reproduces a deterministic run. */
export function rSim(spec: ModelSpec): string {
  const comps = spec.compartments.map((c) => c.id); const n = comps.length; const { lines, name } = paramSetup(spec, 'r');
  const L = [header(spec, '#'), '# Requires: install.packages("deSolve")', 'library(deSolve)', ''];
  if (spec.solver.method !== 'rk45' && spec.solver.method !== 'rk4') L.push('# Note: the browser run was stochastic. This code integrates the matching deterministic (ODE) model.', '');
  L.push(`COMPARTMENTS <- c(${comps.map((c) => `"${c}"`).join(', ')})`, `Y0 <- c(${spec.compartments.map((c) => `${c.id} = ${c.initial}`).join(', ')})`, ...lines, 'rhs <- function(t, y, parms) {', '  p <- params_at(t)', `  N <- sum(y[1:${n}])`, `  d <- numeric(${n})`);
  spec.flows.forEach((f) => {
    L.push(`  r <- ${toCode(parseExpr(f.rate), 'r', name)}  # ${f.id}`);
    if (f.from) L.push(`  d[${comps.indexOf(f.from) + 1}] <- d[${comps.indexOf(f.from) + 1}] - r`);
    if (f.to) L.push(`  d[${comps.indexOf(f.to) + 1}] <- d[${comps.indexOf(f.to) + 1}] + r`);
  });
  const bps = Array.from(new Set((spec.interventions ?? []).flatMap((iv) => [iv.start, iv.end]).filter((x) => x > 0 && x < spec.time.days))).sort((a, b) => a - b);
  L.push('  list(d)', '}', `times <- sort(unique(c(seq(0, ${spec.time.days}, by = ${spec.time.dt})${bps.length ? ', ' + bps.join(', ') : ''})))`, 'out <- ode(y = Y0, times = times, func = rhs, parms = NULL, method = "lsoda", rtol = 1e-10, atol = 1e-10)', `out <- out[out[, "time"] %in% seq(0, ${spec.time.days}, by = ${spec.time.dt}), ]`, 'colnames(out)[1] <- "t"', 'write.csv(as.data.frame(out), row.names = FALSE)');
  return L.join('\n') + '\n';
}

/** Plain numpy code for a network SIR run with the same rules as the browser (structure matches; random streams differ). */
export function pythonNetwork(kind: string, n: number, meanDegree: number, p: number, infectiousDays: number, seeds: number, days: number, seed: number): string {
  return `${header({ name: `SIR on a ${kind} network`, specVersion: '1.0', solver: { method: 'chain-binomial' }, seed } as any, '#')}
# Plain numpy. Same rules as the browser tool; the random number stream differs, so compare distributions, not single runs.
import numpy as np
rng = np.random.default_rng(${seed})
N, MEAN_DEGREE, P_TRANSMIT, INFECTIOUS_DAYS, SEEDS, DAYS = ${n}, ${meanDegree}, ${p}, ${infectiousDays}, ${seeds}, ${days}

def make_graph(kind):
    adj = [set() for _ in range(N)]
    def link(a, b):
        if a != b:
            adj[a].add(b); adj[b].add(a)
    if kind == "random":
        while sum(len(a) for a in adj) < N * MEAN_DEGREE:
            link(int(rng.integers(N)), int(rng.integers(N)))
    elif kind == "small-world":
        k = max(2, 2 * round(MEAN_DEGREE / 2))
        for i in range(N):
            for j in range(1, k // 2 + 1):
                link(i, int(rng.integers(N)) if rng.random() < 0.1 else (i + j) % N)
    elif kind == "scale-free":
        m = max(1, round(MEAN_DEGREE / 2)); pool = []
        for i in range(m + 1):
            for j in range(i):
                link(i, j); pool += [i, j]
        for i in range(m + 1, N):
            for b in set(int(pool[int(rng.integers(len(pool)))]) for _ in range(m)):
                link(i, b); pool += [i, b]
    else:  # community: five equal groups, 90% of links inside a group
        size = N // 5
        for i in range(N):
            for _ in range(int(rng.poisson(MEAN_DEGREE / 2))):
                g = i // size
                j = int(rng.integers(g * size, min(N, (g + 1) * size))) if rng.random() < 0.9 else int(rng.integers(N))
                link(i, j)
    return [list(a) for a in adj]

adj = make_graph("${kind}")
state = np.zeros(N, dtype=int)  # 0 susceptible, 1 infectious, 2 recovered
state[rng.choice(N, SEEDS, replace=False)] = 1
print("t,S,I,R")
for day in range(DAYS + 1):
    print(f"{day},{(state == 0).sum()},{(state == 1).sum()},{(state == 2).sum()}")
    infectious = np.flatnonzero(state == 1); new = []
    for i in infectious:
        for j in adj[i]:
            if state[j] == 0 and rng.random() < P_TRANSMIT:
                new.append(j)
        if rng.random() < 1 / INFECTIOUS_DAYS:
            state[i] = 2
    state[new] = 1
`;
}

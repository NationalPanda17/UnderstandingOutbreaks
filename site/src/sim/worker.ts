/** Simulation worker: every solver runs here so the page never freezes. Cancelling = terminating the worker. */
import { effectiveR, nextGeneration, newInfections, infectiousSeries, summarize } from './engine/analysis';
import { bifurcation, makeGraph, degreeDistribution, networkSir, runEnsemble, sensitivity, simulateBranching, sweep1, sweep2, extinctionProbability, offspringPmf, top20Share } from './engine/extras';
import { compile, runOde, runStochastic, SpecError, type ModelSpec } from './engine/model';

export type Job =
  | { kind: 'run'; spec: ModelSpec }
  | { kind: 'ensemble'; spec: ModelSpec; runs: number }
  | { kind: 'sweep1'; args: Parameters<typeof sweep1> }
  | { kind: 'sweep2'; args: Parameters<typeof sweep2> }
  | { kind: 'sensitivity'; args: Parameters<typeof sensitivity> }
  | { kind: 'bifurcation'; args: Parameters<typeof bifurcation> }
  | { kind: 'network'; graph: { kind: any; n: number; meanDegree: number; seed: number; extra: number }; p: number; infectiousDays: number; seeds: number; days: number; runs: number }
  | { kind: 'branching'; R: number; k: number | null; runs: number; seed: number };

function handle(job: Job, progress: (f: number) => void): unknown {
  const opts = { onProgress: progress };
  switch (job.kind) {
    case 'run': {
      const m = compile(job.spec);
      const res = job.spec.solver.method === 'rk45' || job.spec.solver.method === 'rk4' ? runOde(m, opts) : runStochastic(m, opts);
      const every = Math.max(1, Math.floor(res.t.length / 400));
      return { res, summary: summarize(m, res), ngm: nextGeneration(m), re: effectiveR(m, res, every), infectious: infectiousSeries(m, res), incidence: newInfections(m, res), closed: m.closed, warnings: m.warnings };
    }
    case 'ensemble': return runEnsemble(job.spec, job.runs, opts);
    case 'sweep1': return sweep1(job.args[0], job.args[1], job.args[2], job.args[3], opts);
    case 'sweep2': return sweep2(job.args[0], job.args[1], job.args[2], job.args[3], job.args[4], job.args[5], opts);
    case 'sensitivity': return sensitivity(job.args[0], job.args[1], job.args[2], job.args[3], job.args[4], opts);
    case 'bifurcation': return bifurcation(job.args[0], job.args[1], opts);
    case 'network': {
      const g = makeGraph(job.graph.kind, job.graph.n, job.graph.meanDegree, job.graph.seed, job.graph.extra);
      const runs = []; for (let i = 0; i < job.runs; i++) { runs.push(networkSir(g, job.p, job.infectiousDays, job.seeds, job.days, job.graph.seed + 1000 + i)); progress((i + 1) / job.runs); }
      return { n: g.n, degrees: degreeDistribution(g), runs };
    }
    case 'branching': return { ...simulateBranching(job.R, job.k, job.runs, job.seed), q: extinctionProbability(job.R, job.k), pmf: offspringPmf(job.R, job.k), top20: top20Share(job.R, job.k, job.seed) };
  }
}

self.onmessage = (e: MessageEvent<{ id: number; job: Job }>) => {
  const { id, job } = e.data;
  let last = 0;
  try {
    const result = handle(job, (f) => { const now = Date.now(); if (now - last > 80 || f >= 1) { last = now; (self as any).postMessage({ id, progress: f }); } });
    (self as any).postMessage({ id, result });
  } catch (err: any) {
    (self as any).postMessage({ id, error: err instanceof SpecError ? err.problems.join('; ') : /memory|allocation/i.test(String(err?.message)) ? 'out-of-memory' : String(err?.message ?? err) });
  }
};

/** Simulation embed: always shows the illustrative banner; loads only the solver it needs (ODE or stochastic run). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Route } from '../../lib/app';
import { t } from '../../lib/i18n';
import { Chart, SIM_PALETTE } from '../../components/Chart';
import { SeriesTable } from '../../components/ChartCard';
import { run, specFromParam, ENGINE_VERSION, type RunResult } from '../engine/model';
import { simProv, toSim } from './common';

export default function EmbedSim({ route, Frame }: { route: Route; Frame: any }) {
  const spec = useMemo(() => { try { return specFromParam(route.params.get('spec') ?? ''); } catch { return null; } }, []);
  const [res, setRes] = useState<RunResult | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => { if (spec) setTimeout(() => { try { setRes(run(spec)); } catch { setRes(null); } }, 0); }, []);
  if (!spec) return <p role="alert">{t('sim.badSpec')}</p>;
  const series = res ? spec.compartments.slice(0, 8).map((c, i) => toSim(c.id, res.t, res.y[c.id], { color: SIM_PALETTE[i % SIM_PALETTE.length] })) : [];
  const title = t('sim.runTitle', { model: spec.name });
  return (
    <Frame title={title} subtitle={t('sim.subtitle', { solver: t('solver.' + spec.solver.method), seed: spec.seed === null ? '–' : String(spec.seed), engine: ENGINE_VERSION })} prov={simProv(title, spec)} route={route} sitePath={`/${route.locale}/learn/sim/basic?spec=${route.params.get('spec')}`}>
      {!res && <p role="status">{t('state.loading')}</p>}
      {res && !table && <Chart series={series} xMode="index" simulated xLabel={t('sim.dayAxis')} ariaLabel={`${t('sim.banner')} ${title}`} />}
      {res && table && <SeriesTable series={series} />}
      <button type="button" class="btn small" onClick={() => setTable(!table)}>{table ? t('action.viewChart') : t('action.viewData')}</button>
    </Frame>
  );
}

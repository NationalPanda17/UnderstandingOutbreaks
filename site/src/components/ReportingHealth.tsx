/** Reporting-health chip for a country and disease: how often it reports, how far behind it is, and how complete
 *  its recent reporting has been. It sets expectations before anyone reads the curve. */
import { getOptional } from '../lib/data';
import { t } from '../lib/i18n';
import { useAsync } from './Layout';

export interface Reporting {
  window: [string, string]; period_type: string; typical_lag_periods: number | null;
  places: Record<string, { present: number; expected: number; completeness: number; last_period: string; periods_behind: number }>;
}
export function loadReporting(disease: string) { return getOptional<Reporting>(`reporting/${disease}.json`); }

export function reportingText(r: Reporting, iso3: string): string | null {
  const x = r.places[iso3]; if (!x) return null;
  const pt = r.period_type;
  return [
    t('health.cadence.' + pt),
    x.periods_behind === 0 ? t('health.upToDate') : t('health.behind.' + pt, { n: x.periods_behind }),
    t('health.present', { pct: Math.round(x.completeness * 100), n: x.expected }),
    ...(r.typical_lag_periods ? [t('health.lag.' + pt, { n: r.typical_lag_periods })] : []),
  ].join(' · ');
}

export function ReportingChip({ disease, iso3 }: { disease: string; iso3: string }) {
  const rep = useAsync(() => loadReporting(disease), [disease]);
  const text = rep.data ? reportingText(rep.data, iso3) : null;
  if (!text) return null;
  return <p class="healthchip" data-testid="reporting-health" title={t('health.explain')}><span class="badge">{t('health.title')}</span> {text}</p>;
}

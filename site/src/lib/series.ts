/** Helpers that turn published time-series files into chart-ready series (with gaps kept as gaps). */
import type { Core, PType, SeriesMeta, TsFile } from './data';
import { regularize } from './data';
import { countryName, t } from './i18n';
import type { SeriesData } from './transforms';

export function placeName(core: Core, iso3: string): string {
  const p = core.places[iso3];
  return p ? countryName(p.iso2, p.name) : iso3;
}

/** What a series counts, in plain words: "Reported cases", "Confirmed deaths", "Laboratory detections".
 *  Each combination has its own string (adjectives agree with the noun in most languages). A combination without
 *  one falls back to "Cases (definition)". */
export function measureLabel(metric: string, definition: string, inSentence = false): string {
  const plain = metric === 'detections' || metric === 'specimens_processed' || definition === 'not_applicable';
  const key = plain ? `${inSentence ? 'measureIn' : 'measure'}.${metric}` : `${inSentence ? 'measureIn' : 'measure'}.${metric}.${definition}`;
  const out = t(key);
  return out === key ? `${t('metric.' + metric)} (${t('def.' + definition)})` : out;
}
/** The same, for the middle of a sentence: "reported cases". */
export function measureInSentence(metric: string, definition: string): string { return measureLabel(metric, definition, true); }

export function seriesLabel(core: Core, meta: SeriesMeta, opts: { place?: string; withSource?: boolean } = {}): string {
  const parts = [opts.place, measureLabel(meta.metric, meta.case_definition)];
  if (meta.surveillance_system !== 'national_notification' && meta.surveillance_system !== 'all_reported') parts.push(t('system.' + meta.surveillance_system));
  if (opts.withSource) parts.push(core.sources[meta.source_id]?.short_name ?? meta.source_id);
  return parts.filter(Boolean).join(' · ');
}

export function toSeries(core: Core, ts: TsFile | null, skey: string, label: string, extra: Partial<SeriesData> = {}): SeriesData | null {
  const meta = core.seriesByKey[skey];
  const raw = ts?.series[skey];
  if (!meta || !raw || !raw.p.length) return null;
  const reg = regularize(raw.p, raw.v, meta.period_type as PType);
  return { id: `${skey}.${ts!.iso3}`, label, p: reg.p, v: reg.v, ptype: meta.period_type as PType, population: core.places[ts!.iso3]?.population ?? null,
    incompleteFrom: meta.lag?.incomplete_from, skey, iso3: ts!.iso3, ...extra };
}

/** Series of a disease that are comparable with the default series (same metric, definition, period type). */
export function comparableKeys(core: Core, disease: string): string[] {
  const d = core.diseaseById[disease];
  const def = d?.default_skey ? core.seriesByKey[d.default_skey] : null;
  if (!d || !def) return [];
  return d.series.filter((s) => s.metric === def.metric && s.case_definition === def.case_definition && s.period_type === def.period_type && s.surveillance_system === def.surveillance_system).map((s) => s.skey);
}

export function mapMetricLabel(core: Core, disease: string, window: number, ptype: PType): string {
  const d = core.diseaseById[disease];
  if (d?.map_metric === 'percent_positive') return t('map.metric.percentPositive', { n: window });
  return t('map.metric.rate.' + ptype, { n: window });
}

// ---------------------------------------------------------------- context: the same period in earlier years

/** ISO week number and ISO year of a date (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(iso: string): { year: number; week: number } {
  const d = new Date(iso + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;                 // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3);              // the Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

export interface PastYear { period: string; year: number; value: number | null; index: number }
/** The same week (ISO week number) or the same month in each of the previous `years` years, newest first.
 *  A year with no such period, or no value for it, is listed with a null value rather than left out, so a gap in
 *  reporting stays visible. Week 53 is compared with week 52 of years that have no week 53. */
export function samePeriodPastYears(p: string[], v: (number | null)[], anchor: string, ptype: string, years = 5): PastYear[] {
  if (ptype !== 'W' && ptype !== 'M') return [];
  const out: PastYear[] = [];
  if (ptype === 'M') {
    for (let k = 1; k <= years; k++) {
      const period = `${parseInt(anchor.slice(0, 4), 10) - k}${anchor.slice(4)}`;
      const i = p.indexOf(period);
      out.push({ period, year: parseInt(period.slice(0, 4), 10), value: i >= 0 ? v[i] : null, index: i });
    }
    return out;
  }
  const a = isoWeek(anchor);
  const byKey = new Map<string, number>();
  p.forEach((x, i) => { const w = isoWeek(x); byKey.set(`${w.year}-${w.week}`, i); });
  for (let k = 1; k <= years; k++) {
    const y = a.year - k;
    const i = byKey.get(`${y}-${a.week}`) ?? (a.week === 53 ? byKey.get(`${y}-52`) : undefined) ?? -1;
    out.push({ period: i >= 0 ? p[i] : '', year: y, value: i >= 0 ? v[i] : null, index: i });
  }
  return out;
}

/** Highest and lowest reported value among the complete periods of a window ending at index `end`. */
export function rangeOver(p: string[], v: (number | null)[], end: number, span: number): { hi: { period: string; value: number }; lo: { period: string; value: number }; n: number } | null {
  let hi: { period: string; value: number } | null = null; let lo: { period: string; value: number } | null = null; let n = 0;
  for (let i = Math.max(0, end - span + 1); i <= end; i++) {
    const x = v[i]; if (x === null || x === undefined) continue; n++;
    if (!hi || x > hi.value) hi = { period: p[i], value: x };
    if (!lo || x < lo.value) lo = { period: p[i], value: x };
  }
  return hi && lo && n >= 2 ? { hi, lo, n } : null;
}

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

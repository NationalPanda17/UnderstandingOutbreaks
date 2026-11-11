/** Static data access (the /data/v1 API) and "data as of" reconstruction. Loads only what a view needs. */
import { dataUrl } from './app';

export type Origin = 'source-reported' | 'site-derived' | 'user-supplied' | 'simulated' | 'test-data';
export type PType = 'W' | 'M' | 'Y';

export interface Source {
  id: string; name: string; short_name: string; publisher: string; landing_url: string; license: string; license_url: string;
  license_verification: string; license_checked: string; redistribute_raw: boolean; citation: string; cadence: string; kind: string;
  stale?: boolean; state?: string; last_success?: string | null; datasets?: string[];
}
export interface Lag { lag_periods: number; basis: string; n_snapshots: number; n_revised_points: number; data_edge: string; incomplete_from: string; method: string; method_version: string; period_type: PType }
export interface SeriesMeta {
  skey: string; dataset_id: string; source_id: string; origin_type: Origin; metric: string; case_definition: string; case_definition_detail: string;
  surveillance_system: string; period_type: PType; chain_id: string; inputs: string[]; n_places: number; deep_link: string; link_kind: string;
  case_definition_note?: string; surveillance_system_note?: string; date_basis?: string; date_basis_field?: string | null; lag: Lag; stale: boolean; freshness_days: number | null; retrieved_at: string | null; dataset_state: string;
}
export interface Disease {
  id: string; name: string; icd11: string; mesh: string; data_type: string; seasonal?: boolean; cadence?: string; aliases: string[];
  has_timeseries: boolean; badge: 'timeseries' | 'events-only'; rate_metric: boolean; map_metric: string; default_skey?: string; series: SeriesMeta[];
}
export interface Place { iso3: string; iso2: string; name: string; continent: string; region: string; population: number | null; population_year: number | null; area_km2: number | null; centroid: [number, number] | null; neighbours: string[]; on_map: boolean }
export interface TsFile { disease: string; iso3: string; snapshot_id: string; series: Record<string, { p: string[]; v: (number | null)[] }> }
export interface Snapshot { id: string; created_at: string; n_value_changes: number; n_revised: number; n_new: number; n_removed: number }
export interface Manifest { schema_version: string; generated_at: string; snapshot_id: string; snapshots: Snapshot[]; datasets: Record<string, any>; bulk: any; counts: Record<string, number>; endpoints: Record<string, string> }
export interface Fetch { fetch_id: string; dataset_id: string; source_id: string; url: string; retrieved_at: string; raw_file_hash: string; bytes: number; archive_public: boolean; archive_key: string | null; link_kind: string; http_last_modified?: string | null }
export interface ChainStep { op: string; method_version: string; params: Record<string, unknown> }
export interface EventIdx {
  event_id: string; disease: string; name_in_source: string; countries: string[]; first_report: string; last_report: string; status: string; status_basis: string;
  cases: null | { value: number; case_definition: string; quote: string; as_of: string; report_id: string };
  deaths: null | { value: number; quote: string; as_of: string; report_id: string };
  n_reports: number; source_ids: string[]; rank: { score: number; components: Record<string, number>; active: boolean; method: string; method_version: string };
  counts_suppressed?: string | null; supersedes?: string[];
  latest_title: string; latest_url: string; quality_flags: string[]; locations: { iso3: string; precision: string; lon: number | null; lat: number | null; name: string }[]; days_since_last_report: number;
}
export interface Overview {
  disease: string; skey: string; period_type: PType; map_metric: string; anchor: string; incomplete_from: string; data_edge: string; snapshot_id: string; source_ids: string[];
  method: { name: string; version: string; window_periods: number };
  latest: Record<string, { window: [string, string]; n_periods: number; value: number | null; metric_value: number | null; last_period: string | null; trend: { latest_complete: string | null; value?: number; change_pct?: number | null; prev_period?: string | null } }>;
  grid: { periods: string[]; values: Record<string, (number | null)[]> };
  global: { p: string[]; v: number[]; n: number[]; n_total?: number };
  global_panel?: { p: string[]; v: (number | null)[]; n_panel: number; min_coverage: number };
}
export interface Flag {
  disease: string; iso3: string; skey: string; series_id: string; period: string; value: number; status: string; baseline_mean: number; baseline_sd: number; threshold: number;
  baseline_periods: [string, string]; baseline_points: number; seasonal: null | { years_used: number; mean: number; sd: number; threshold: number }; method: string; method_version: string; source_ids: string[];
  basis?: 'count' | 'percent_positive'; detections?: number; specimens?: number;
}

const cache = new Map<string, Promise<any>>();

export function getJSON<T = any>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(dataUrl(path), { credentials: 'omit' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export async function getOptional<T = any>(path: string): Promise<T | null> {
  try { return await getJSON<T>(path); } catch { return null; }
}

export interface Core { manifest: Manifest; sources: Record<string, Source>; diseases: Disease[]; diseaseById: Record<string, Disease>; places: Record<string, Place>; seriesByKey: Record<string, SeriesMeta & { disease: string }>; chains: Record<string, ChainStep[]>; fetches: Record<string, Fetch>; reconciliation: Record<string, { overlaps: number; disagreements: number; datasets: string[] }> }
let corePromise: Promise<Core> | null = null;

/** Small shared files every page needs (registry, vocabulary, places, snapshot list). */
export function loadCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = Promise.all([getJSON('manifest.json'), getJSON('sources.json'), getJSON('diseases.json'), getJSON('places.json'), getJSON('chains.json'), getJSON('fetches.json')])
      .then(([manifest, src, dis, pl, ch, fe]) => {
        const sources: Record<string, Source> = {};
        for (const s of src.sources) sources[s.id] = s;
        const diseaseById: Record<string, Disease> = {};
        const seriesByKey: Core['seriesByKey'] = {};
        for (const d of dis.diseases as Disease[]) {
          diseaseById[d.id] = d;
          for (const s of d.series) seriesByKey[s.skey] = { ...s, disease: d.id };
        }
        return { manifest, sources, diseases: dis.diseases, diseaseById, places: pl.places, seriesByKey, chains: ch.chains, fetches: { ...fe.fetches, ...pl.fetches }, reconciliation: dis.reconciliation };
      });
    corePromise.catch(() => { corePromise = null; });
  }
  return corePromise;
}

export function addPeriod(period: string, ptype: PType, n: number): string {
  const d = new Date(period + 'T00:00:00Z');
  if (ptype === 'W') d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (ptype === 'M') d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

/** Time series for one disease and place, optionally as it was published at an earlier snapshot. */
export async function loadTs(core: Core, disease: string, iso3: string, snapshot: string | null): Promise<TsFile | null> {
  const ts = await getOptional<TsFile>(`ts/${disease}/${iso3}.json`);
  if (!ts) return null;
  if (!snapshot || snapshot === core.manifest.snapshot_id) return ts;
  return reconstructAsOf(core, ts, snapshot);
}

/** Rebuild what the site showed at `snapshot` from the latest values plus the stored changes. */
export async function reconstructAsOf(core: Core, ts: TsFile, snapshot: string): Promise<TsFile> {
  const rix = await getJSON<{ snapshots: string[]; countries_with_changes: Record<string, string[]>; base_exceptions: Record<string, number> }>('revisions/index.json');
  const target = rix.snapshots.indexOf(snapshot);
  if (target < 0) return ts;
  const has = rix.countries_with_changes[ts.disease]?.includes(ts.iso3);
  const rev = has ? await getOptional<{ changes: Record<string, Record<string, [number, number | null][]>> }>(`revisions/${ts.disease}/${ts.iso3}.json`) : null;
  const out: TsFile = { ...ts, snapshot_id: snapshot, series: {} };
  for (const [skey, s] of Object.entries(ts.series)) {
    const base = rix.base_exceptions[`${skey}.${ts.iso3}`] ?? 0;
    if (base > target) continue; // the series did not exist yet
    const ch = rev?.changes?.[skey] ?? {};
    const p: string[] = [];
    const v: (number | null)[] = [];
    const seen = new Set<string>();
    s.p.forEach((period, i) => {
      seen.add(period);
      const hist = ch[period];
      if (!hist) { p.push(period); v.push(s.v[i]); return; }
      let val: number | null | undefined;
      for (const [si, x] of hist) if (si <= target) val = x;
      if (val !== undefined && val !== null) { p.push(period); v.push(val); }
    });
    for (const [period, hist] of Object.entries(ch)) { // values that were later removed
      if (seen.has(period)) continue;
      let val: number | null | undefined;
      for (const [si, x] of hist) if (si <= target) val = x;
      if (val !== undefined && val !== null) { p.push(period); v.push(val); }
    }
    const order = p.map((_, i) => i).sort((a, b) => (p[a] < p[b] ? -1 : 1));
    out.series[skey] = { p: order.map((i) => p[i]), v: order.map((i) => v[i]) };
  }
  return out;
}

/** Revision trail of one series: period -> [[snapshotIndex, value], ...] for values that changed after first publication. */
export async function loadRevisions(disease: string, iso3: string): Promise<{ snapshots: string[]; changes: Record<string, Record<string, [number, number | null][]>> }> {
  const rix = await getJSON<any>('revisions/index.json');
  const has = rix.countries_with_changes[disease]?.includes(iso3);
  const rev = has ? await getOptional<any>(`revisions/${disease}/${iso3}.json`) : null;
  return { snapshots: rix.snapshots, changes: rev?.changes ?? {} };
}

export function deepLink(meta: SeriesMeta, place?: Place): string {
  return meta.deep_link.replace('{iso3}', place?.iso3 ?? '').replace('{iso2}', place?.iso2 ?? '');
}

/** Fill gaps so missing periods are explicit nulls (missing data must look missing). */
export function regularize(p: string[], v: (number | null)[], ptype: PType): { p: string[]; v: (number | null)[] } {
  if (!p.length) return { p: [], v: [] };
  const look = new Map(p.map((x, i) => [x, v[i]]));
  const out: string[] = [];
  const vals: (number | null)[] = [];
  let cur = p[0];
  const last = p[p.length - 1];
  let guard = 0;
  while (cur <= last && guard++ < 20000) {
    out.push(cur);
    vals.push(look.has(cur) ? (look.get(cur) as number | null) : null);
    cur = addPeriod(cur, ptype, 1);
  }
  return { p: out, v: vals };
}

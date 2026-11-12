/** Map helpers with no MapLibre dependency, so pages can use legends and class breaks without loading the map chunk. */
import { smart, t } from '../lib/i18n';

export const RAMP = ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'];
/** Reporting completeness: a different hue from disease rates, so the two layers are never mistaken for each other. */
export const REPORT_RAMP = ['#ffffff', '#e6e1f0', '#c3bbdd', '#9b8fc7', '#7059aa', '#451c7e'];
export const DENSITY_RAMP = ['#f7f7f7', '#d9d9d9', '#bdbdbd', '#969696', '#636363', '#252525'];

export interface MapPoint { id: string; lon: number; lat: number; label: string; precision?: string; sources: string[]; weight?: number; color?: string; radius?: number; sub?: string }
/** Why an area has no value. 'pending': it reports to this source but not yet for this period. 'none': no report for this period. */
export type Missing = 'pending' | 'none';
export interface MapProps {
  values?: Record<string, number | null | undefined>;
  /** Areas without a value, by reason. Anything not listed and without a value is drawn as 'none'. */
  missing?: Record<string, Missing>;
  /** Tooltip text for an area without a value (for example "Not yet reported; last report March 2026"). */
  missingLabel?: Record<string, string>;
  projection?: 'mercator' | 'globe';
  /** What the colours show, for tooltips: disease and period, e.g. "Measles · Aug 2026". */
  context?: string;
  breaks?: number[];
  ramp?: string[];
  valueLabel?: string;
  sourceLabel?: string;
  names?: Record<string, string>;
  points?: MapPoint[];
  pointMode?: 'markers' | 'clusters' | 'heat';
  selected?: string[];
  onSelect?: (iso3: string) => void;
  onPoint?: (id: string) => void;
  onMapClick?: (lon: number, lat: number) => void;
  /** Draw-a-region tool: called with the ISO3 codes whose label point falls inside the drawn polygon. */
  onRegion?: (iso3: string[]) => void;
  centroids?: Record<string, [number, number] | null>;
  view?: { lng: number; lat: number; z: number };
  onMove?: (v: { lng: number; lat: number; z: number }) => void;
  tall?: boolean;
  ariaLabel: string;
  apiRef?: { current: null | { image: () => string; size: () => { width: number; height: number } } };
  lines?: { from: [number, number]; to: [number, number]; w: number }[];
}

export function quantileBreaks(vals: number[], classes = 6): number[] {
  const v = vals.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) {
    const q = v[Math.min(v.length - 1, Math.floor((i / classes) * v.length))];
    const r = Number(q.toPrecision(2));
    if (!out.length || r > out[out.length - 1]) out.push(r);
  }
  return out;
}
/** Fixed class breaks, the same on every map, period and view of a measure, so a colour always means the same range.
 *  Rates per 100,000 go up in tenfold steps (rates span five orders of magnitude between diseases and countries);
 *  percentages of samples positive use steps that roughly double. */
export function fixedBreaks(mapMetric: string | undefined): number[] {
  return mapMetric === 'percent_positive' ? [2, 5, 10, 20, 40] : [0.01, 0.1, 1, 10, 100];
}
export function colorFor(v: number | null | undefined, breaks: number[], ramp: string[]): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v <= 0) return ramp[0];
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return ramp[Math.min(ramp.length - 1, i + 1)];
}


/** For one period of a place-by-period grid, say why each place without a value has none. */
export function classifyMissing(grid: Record<string, (number | null)[]>, ti: number): Record<string, { kind: Missing; last: number }> {
  const out: Record<string, { kind: Missing; last: number }> = {};
  for (const [iso3, row] of Object.entries(grid)) {
    if (row[ti] !== null && row[ti] !== undefined) continue;
    let last = -1;
    for (let i = row.length - 1; i >= 0; i--) if (row[i] !== null && row[i] !== undefined) { last = i; break; }
    out[iso3] = { kind: last >= 0 && ti > last ? 'pending' : 'none', last };
  }
  return out;
}

export function MapLegend({ breaks, ramp = RAMP, title, pending, scale, zero }: { breaks: number[]; ramp?: string[]; title: string; pending?: boolean; scale?: 'view' | 'fixed' | 'own' | 'shared'; zero?: string }) {
  const stops = [0, ...breaks];
  return (
    <div class="maplegend" aria-label={title}>
      <span>{title}:</span>
      <span><span class="sw" style={{ background: ramp[0] }} /> {zero ?? t('map.zero')}</span>
      {stops.slice(1).map((b, i) => <span key={b}><span class="sw" style={{ background: ramp[Math.min(ramp.length - 1, i + 1)] }} /> {i === 0 ? '<' : '≥'} {smart(i === 0 ? b : stops[i])}</span>)}
      {stops.length > 1 && <span><span class="sw" style={{ background: ramp[Math.min(ramp.length - 1, stops.length)] }} /> ≥ {smart(stops[stops.length - 1])}</span>}
      {pending && <span><span class="sw pending" /> {t('map.pending')}</span>}
      <span><span class="sw missing" /> {pending ? t('map.noReport') : t('map.noData')}</span>
      {scale && <span class="legendnote">{t('legend.scale.' + scale)}</span>}
    </div>
  );
}

/** What a click on a country shows: its name, what the map says about it, and a way through to its page. */
export function CountryPopover({ name, context, lines, to, onClose }: { name: string; context?: string; lines: string[]; to: string; onClose: () => void }) {
  return (
    <div class="mappop" role="dialog" aria-label={name} data-testid="country-popover">
      <div class="row"><b>{name}</b><button type="button" class="btn small" onClick={onClose} aria-label={t('action.close')}>×</button></div>
      {context && <div class="small muted">{context}</div>}
      {lines.map((l) => <div class="small" key={l}>{l}</div>)}
      <a class="btn small primary" href={to} style={{ marginTop: '6px' }}>{t('popover.open', { name })}</a>
    </div>
  );
}

/** Preset views for the interactive map (centre and zoom) and for the static equal-area map (lon/lat box). */
export const REGION_VIEWS: Record<string, { lng: number; lat: number; z: number; box: [number, number, number, number] }> = {
  world: { lng: 15, lat: 18, z: 1.1, box: [-180, -58, 180, 84] },
  africa: { lng: 19, lat: 2, z: 2.3, box: [-20, -36, 53, 38] },
  americas: { lng: -80, lat: 8, z: 1.6, box: [-125, -56, -33, 60] },
  asia: { lng: 95, lat: 28, z: 2.1, box: [44, -11, 150, 55] },
  europe: { lng: 15, lat: 52, z: 2.7, box: [-25, 34, 45, 71] },
  oceania: { lng: 150, lat: -20, z: 2.3, box: [110, -48, 180, 5] },
};

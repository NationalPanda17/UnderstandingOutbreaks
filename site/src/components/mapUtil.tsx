/** Map helpers with no MapLibre dependency, so pages can use legends and class breaks without loading the map chunk. */
import { smart, t } from '../lib/i18n';

export const RAMP = ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'];
export const DENSITY_RAMP = ['#f7f7f7', '#d9d9d9', '#bdbdbd', '#969696', '#636363', '#252525'];

export interface MapPoint { id: string; lon: number; lat: number; label: string; precision?: string; sources: string[]; weight?: number; color?: string; radius?: number; sub?: string }
export interface MapProps {
  values?: Record<string, number | null | undefined>;
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
export function colorFor(v: number | null | undefined, breaks: number[], ramp: string[]): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v <= 0) return ramp[0];
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return ramp[Math.min(ramp.length - 1, i + 1)];
}


export function MapLegend({ breaks, ramp = RAMP, title }: { breaks: number[]; ramp?: string[]; title: string }) {
  const stops = [0, ...breaks];
  return (
    <div class="maplegend" aria-label={title}>
      <span>{title}:</span>
      <span class="sw" style={{ background: ramp[0] }} /> 0
      {stops.slice(1).map((b, i) => <span key={b}><span class="sw" style={{ background: ramp[Math.min(ramp.length - 1, i + 1)] }} /> {i === 0 ? '<' : '≥'} {smart(i === 0 ? b : stops[i])}</span>)}
      {stops.length > 1 && <span><span class="sw" style={{ background: ramp[Math.min(ramp.length - 1, stops.length)] }} /> ≥ {smart(stops[stops.length - 1])}</span>}
      <span><span class="sw missing" /> {t('map.noData')}</span>
    </div>
  );
}

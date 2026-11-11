/** Static equal-area maps drawn as SVG (Equal Earth projection): one large map, or a grid of small ones.
 *
 *  Web Mercator, used by the interactive map, stretches areas far from the equator: Greenland looks as large as
 *  Africa. Equal Earth keeps areas in proportion, so a shaded country takes up the share of the picture it takes up
 *  of the world. These maps are plain SVG: they export cleanly, print well and need no map engine.
 *  This file is loaded on demand (d3-geo is not in the main bundle). */
import { geoArea, geoEqualEarth, geoPath } from 'd3-geo';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { dataUrl } from '../lib/app';
import { smart, t } from '../lib/i18n';
import { RAMP, REGION_VIEWS, colorFor, type Missing } from './mapUtil';

type Box = [number, number, number, number];
interface Shape { iso3: string; name: string; d: string }

let boundaries: Promise<any> | null = null;
function loadBoundaries(): Promise<any> {
  boundaries ??= fetch(dataUrl('boundaries.geojson'), { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((fc) => { fc.features.forEach(fixWinding); return fc; })
    .catch((e) => { boundaries = null; throw e; });
  return boundaries;
}

/** d3-geo reads ring direction on the sphere. A polygon wound the other way means "everything except this shape",
 *  which would flood the map, so any polygon covering more than half the globe is reversed. */
function fixWinding(f: any): void {
  const g = f.geometry; if (!g) return;
  const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) if (geoArea({ type: 'Polygon', coordinates: poly } as any) > 2 * Math.PI) poly.forEach((ring) => ring.reverse());
}

type Project = (lonlat: [number, number]) => [number, number] | null;
const shapeCache = new Map<string, { list: Shape[]; project: Project }>();
function shapes(fc: any, box: Box, w: number, h: number): { list: Shape[]; project: Project } {
  const key = `${box.join(',')}|${w}|${h}`;
  const hit = shapeCache.get(key); if (hit) return hit;
  const world = box[0] <= -179 && box[2] >= 179;
  // Centre the projection on the region so it sits upright, then fit the region's lon/lat box to the frame.
  const proj = geoEqualEarth().rotate([world ? -11 : -(box[0] + box[2]) / 2, 0]);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) pts.push([box[0] + ((box[2] - box[0]) * i) / 12, box[1] + ((box[3] - box[1]) * j) / 12]);
  proj.fitExtent([[2, 2], [w - 2, h - 2]], { type: 'MultiPoint', coordinates: pts } as any);
  const path = geoPath(proj).digits(1);
  const out: Shape[] = [];
  for (const f of fc.features) { const d = path(f); if (d) out.push({ iso3: f.properties.iso3, name: f.properties.name, d }); }
  const res = { list: out, project: (ll: [number, number]) => proj(ll) as [number, number] | null };
  shapeCache.set(key, res);
  return res;
}

export interface StaticMapProps {
  values: Record<string, number | null | undefined>;
  breaks: number[];
  ramp?: string[];
  missing?: Record<string, Missing>;
  missingLabel?: Record<string, string>;
  names?: Record<string, string>;
  valueLabel?: string;
  region?: string;
  width?: number;
  height?: number;
  title: string;
  /** Small-multiple panel: no hover text per country, thinner lines. */
  compact?: boolean;
  onSelect?: (iso3: string) => void;
  /** Event points drawn on top (position, label, size). */
  points?: { id: string; lon: number; lat: number; label: string; radius?: number; precision?: string; sub?: string }[];
  onPoint?: (id: string) => void;
  svgRef?: { current: SVGSVGElement | null };
}

export function StaticMap(props: StaticMapProps) {
  const [fc, setFc] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let live = true; loadBoundaries().then((x) => { if (live) setFc(x); }).catch(() => setErr(true)); return () => { live = false; }; }, []);
  const w = props.width ?? 960; const h = props.height ?? 500;
  const box = (REGION_VIEWS[props.region ?? 'world'] ?? REGION_VIEWS.world).box;
  const { list, project } = useMemo(() => (fc ? shapes(fc, box, w, h) : { list: [] as Shape[], project: (() => null) as Project }), [fc, box, w, h]);
  const ramp = props.ramp ?? RAMP;
  if (err) return <div class="notice warn" role="alert">{t('map.failed')}</div>;
  if (!fc) return <div role="status" class="small muted">{t('state.loadingMap')}</div>;
  return (
    <svg ref={props.svgRef as any} viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={props.title} class={'staticmap' + (props.compact ? ' compact' : '')} style={{ display: 'block', background: '#eef3f4', borderRadius: '8px' }}>
      <defs>
        <pattern id="sm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f4f4" /><rect width="2.2" height="6" fill="#d2d2d2" /></pattern>
        <pattern id="sm-dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fbf6e6" /><circle cx="1.5" cy="1.5" r="0.9" fill="#b89b3c" /><circle cx="4.5" cy="4.5" r="0.9" fill="#b89b3c" /></pattern>
      </defs>
      {list.map((s) => {
        const v = props.values[s.iso3];
        const c = colorFor(v, props.breaks, ramp);
        const fill = c ?? (props.missing?.[s.iso3] === 'pending' ? 'url(#sm-dots)' : 'url(#sm-hatch)');
        const name = props.names?.[s.iso3] ?? s.name;
        return (
          <path key={s.iso3} d={s.d} fill={fill} stroke="#8fa1a5" stroke-width={props.compact ? 0.3 : 0.6} vector-effect="non-scaling-stroke"
            style={props.onSelect ? { cursor: 'pointer' } : undefined} onClick={props.onSelect ? () => props.onSelect!(s.iso3) : undefined}>
            {!props.compact && <title>{name}: {c === null ? (props.missingLabel?.[s.iso3] ?? t('chart.noData')) : `${props.valueLabel ? props.valueLabel + ': ' : ''}${smart(v as number)}`}</title>}
          </path>
        );
      })}
      {(props.points ?? []).map((p, i) => {
        const xy = project([p.lon, p.lat]); if (!xy || xy[0] < 0 || xy[0] > w || xy[1] < 0 || xy[1] > h) return null;
        const vague = p.precision === 'country' || p.precision === 'admin1';
        return (
          <g key={p.id + i} style={props.onPoint ? { cursor: 'pointer' } : undefined} onClick={props.onPoint ? () => props.onPoint!(p.id) : undefined}>
            {vague && <circle cx={xy[0]} cy={xy[1]} r={(p.radius ?? 5) + 5} fill="#7a5c00" fill-opacity="0.07" stroke="#7a5c00" stroke-opacity="0.35" stroke-width="0.8" />}
            <circle cx={xy[0]} cy={xy[1]} r={p.radius ?? 5} fill="#7a5c00" fill-opacity="0.88" stroke="#fff" stroke-width="1.5"><title>{p.label}{p.sub ? ' · ' + p.sub : ''}</title></circle>
          </g>
        );
      })}
    </svg>
  );
}

/** One country's first-level regions, fitted to the frame. Regions without a value are hatched. */
export function RegionMap({ iso3, values, breaks, labels, title, height = 440, svgRef }: { iso3: string; values: Record<string, number | null | undefined>; breaks: number[]; labels: Record<string, string>; title: string; height?: number; svgRef?: { current: SVGSVGElement | null } }) {
  const [fc, setFc] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true; setFc(null);
    fetch(dataUrl(`subnational/boundaries/${iso3}.geojson`), { credentials: 'omit' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((x) => { x.features.forEach(fixWinding); if (live) setFc(x); }).catch(() => setErr(true));
    return () => { live = false; };
  }, [iso3]);
  const w = 760;
  const list = useMemo(() => {
    if (!fc) return [];
    // centre on the country (its bounds can cross the antimeridian only for a few island states; the fit copes)
    let lo = 180, hi = -180;
    const scan = (c: any) => { if (typeof c[0] === 'number') { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[0]); } else c.forEach(scan); };
    fc.features.forEach((f: any) => scan(f.geometry.coordinates));
    const proj = geoEqualEarth().rotate([-(lo + hi) / 2, 0]).fitExtent([[6, 6], [w - 6, height - 6]], fc);
    const path = geoPath(proj).digits(1);
    return fc.features.map((f: any) => ({ id: f.properties.id as string, name: f.properties.name as string, d: path(f) ?? '' }));
  }, [fc, height]);
  if (err) return <div class="notice warn" role="alert">{t('map.failed')}</div>;
  if (!fc) return <div role="status" class="small muted">{t('state.loadingMap')}</div>;
  return (
    <svg ref={svgRef as any} viewBox={`0 0 ${w} ${height}`} width="100%" role="img" aria-label={title} class="staticmap" style={{ display: 'block', background: '#eef3f4', borderRadius: '8px', maxHeight: '70vh' }}>
      <defs><pattern id="rm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f4f4" /><rect width="2.2" height="6" fill="#d2d2d2" /></pattern></defs>
      {list.map((s: { id: string; name: string; d: string }) => {
        const c = colorFor(values[s.id], breaks, RAMP);
        return <path key={s.id} d={s.d} fill={c ?? 'url(#rm-hatch)'} stroke="#8fa1a5" stroke-width={0.7} vector-effect="non-scaling-stroke"><title>{s.name}: {labels[s.id] ?? t('chart.noData')}</title></path>;
      })}
    </svg>
  );
}

export interface Panel { key: string; title: string; note?: string; values: Record<string, number | null | undefined>; missing?: Record<string, Missing>; breaks?: number[] }

/** Small multiples: the same map repeated, one panel per period or per disease, for comparison at a glance. */
export function MapGrid({ panels, breaks, ramp, region, onPanel }: { panels: Panel[]; breaks: number[]; ramp?: string[]; region?: string; onPanel?: (key: string) => void }) {
  return (
    <div class="mapgrid">
      {panels.map((p) => (
        <figure key={p.key}>
          <figcaption>{onPanel ? <button type="button" class="linklike" onClick={() => onPanel(p.key)}>{p.title}</button> : p.title}{p.note && <span class="muted"> · {p.note}</span>}</figcaption>
          <StaticMap compact values={p.values} missing={p.missing} breaks={p.breaks ?? breaks} ramp={ramp} region={region} width={320} height={region && region !== 'world' ? 230 : 170} title={p.title} />
        </figure>
      ))}
    </div>
  );
}

export default StaticMap;

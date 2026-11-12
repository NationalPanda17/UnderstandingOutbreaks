/** Static equal-area maps drawn as SVG (Equal Earth projection): one large map, or a grid of small ones.
 *
 *  Web Mercator, used by the interactive map, stretches areas far from the equator: Greenland looks as large as
 *  Africa. Equal Earth keeps areas in proportion, so a shaded country takes up the share of the picture it takes up
 *  of the world. These maps are plain SVG: they export cleanly, print well and need no map engine.
 *  This file is loaded on demand (d3-geo is not in the main bundle). */
import { geoArea, geoEqualEarth, geoPath } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dataUrl } from '../lib/app';
import { smart, t } from '../lib/i18n';
import { RAMP, REGION_VIEWS, colorFor, type Missing } from './mapUtil';

type Box = [number, number, number, number];
interface Shape { iso3: string; name: string; d: string; cx: number; cy: number; area: number }

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
  for (const f of fc.features) { const d = path(f); if (d) { const [cx, cy] = path.centroid(f); out.push({ iso3: f.properties.iso3, name: f.properties.name, d, cx, cy, area: path.area(f) }); } }
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
  context?: string;
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

/** Keyboard movement between countries: from the current one, the nearest country lying in the arrow's direction.
 *  Distance across the direction counts double, so "right" prefers a neighbour to the east over one far north-east. */
export function nextInDirection(list: { cx: number; cy: number }[], from: number, key: string): number {
  const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const v = dir[key]; if (!v || !list[from]) return from;
  let best = from; let score = Infinity;
  list.forEach((s, i) => {
    if (i === from || !Number.isFinite(s.cx)) return;
    const dx = s.cx - list[from].cx; const dy = s.cy - list[from].cy;
    const along = dx * v[0] + dy * v[1]; const across = Math.abs(dx * v[1] - dy * v[0]);
    if (along <= 1 || across > along * 2) return;
    const sc = along + across * 2;
    if (sc < score) { score = sc; best = i; }
  });
  return best;
}

export function StaticMap(props: StaticMapProps) {
  const [fc, setFc] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let live = true; loadBoundaries().then((x) => { if (live) setFc(x); }).catch(() => setErr(true)); return () => { live = false; }; }, []);
  const w = props.width ?? 960; const h = props.height ?? 500;
  const box = (REGION_VIEWS[props.region ?? 'world'] ?? REGION_VIEWS.world).box;
  const { list, project } = useMemo(() => (fc ? shapes(fc, box, w, h) : { list: [] as Shape[], project: (() => null) as Project }), [fc, box, w, h]);
  const ramp = props.ramp ?? RAMP;
  const [focus, setFocus] = useState<number | null>(null);
  // Keyboard use: the map is one tab stop. Arrow keys move between countries, a letter jumps to the next country
  // starting with it, Enter opens the country, Escape leaves. One entry per country (its largest piece).
  const keyed = !!props.onSelect && !props.compact;
  const nav = useMemo(() => { const m = new Map<string, Shape>(); for (const s of list) { const x = m.get(s.iso3); if (!x || s.area > x.area) m.set(s.iso3, s); } return Array.from(m.values()).filter((s) => Number.isFinite(s.cx)); }, [list]);
  const [cur, setCur] = useState<number | null>(null);
  const [inMap, setInMap] = useState(false);
  const local = useRef<SVGSVGElement | null>(null);
  const nameOf = (s: Shape) => props.names?.[s.iso3] ?? s.name;
  const describe = (s: Shape) => { const v = props.values[s.iso3]; return `${nameOf(s)}: ${v === null || v === undefined ? (props.missingLabel?.[s.iso3] ?? t('chart.noData')) : `${props.valueLabel ? props.valueLabel + ': ' : ''}${smart(v as number)}`}`; };
  const onKey = (e: KeyboardEvent) => {
    if (!nav.length || e.target !== local.current) return;
    setInMap(true);
    const start = () => { let b = 0; let bd = Infinity; nav.forEach((s, i) => { const d = Math.hypot(s.cx - w / 2, s.cy - h / 2); if (d < bd) { bd = d; b = i; } }); return b; };
    if (e.key.startsWith('Arrow')) { e.preventDefault(); setCur(cur === null ? start() : nextInDirection(nav, cur, e.key)); }
    else if ((e.key === 'Enter' || e.key === ' ') && cur !== null) { e.preventDefault(); props.onSelect!(nav[cur].iso3); }
    else if (e.key === 'Escape') setCur(null);
    else if (e.key.length === 1 && /\p{L}/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLocaleLowerCase(); const order = nav.map((s, i) => i).sort((a, b) => nameOf(nav[a]).localeCompare(nameOf(nav[b])));
      const hits = order.filter((i) => nameOf(nav[i]).toLocaleLowerCase().startsWith(k)); if (!hits.length) return;
      const at = cur === null ? -1 : hits.indexOf(cur); setCur(hits[(at + 1) % hits.length]);
    }
  };
  if (err) return <div class="notice warn" role="alert">{t('map.failed')}</div>;
  if (!fc) return <div role="status" class="small muted">{t('state.loadingMap')}</div>;
  const here = keyed && inMap && cur !== null ? nav[cur] ?? null : null;
  return (
    <>
    <svg ref={(el: SVGSVGElement | null) => { local.current = el; if (props.svgRef) props.svgRef.current = el; }} viewBox={`0 0 ${w} ${h}`} width="100%" class={'staticmap' + (props.compact ? ' compact' : '')} style={{ display: 'block', background: '#eef3f4', borderRadius: '8px' }}
      {...(keyed ? { tabIndex: 0, role: 'application', 'aria-roledescription': t('map.kbd.role'), 'aria-label': `${props.title.replace(/[.\s]+$/, '')}. ${t('map.kbd.hint')}`, onKeyDown: onKey, onFocus: (e: FocusEvent) => { if (e.target === local.current) setInMap(true); }, onBlur: (e: FocusEvent) => { if (e.target === local.current) setInMap(false); }, 'data-testid': 'static-map' } : { role: 'img', 'aria-label': props.title })}>
      <defs>
        <pattern id="sm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f4f4" /><rect width="2.2" height="6" fill="#d2d2d2" /></pattern>
        <pattern id="sm-dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fbf6e6" /><circle cx="1.5" cy="1.5" r="0.9" fill="#b89b3c" /><circle cx="4.5" cy="4.5" r="0.9" fill="#b89b3c" /></pattern>
      </defs>
      {list.map((s, i) => {
        const v = props.values[s.iso3];
        const c = colorFor(v, props.breaks, ramp);
        const fill = c ?? (props.missing?.[s.iso3] === 'pending' ? 'url(#sm-dots)' : 'url(#sm-hatch)');
        const name = props.names?.[s.iso3] ?? s.name;
        return (
          <path key={s.iso3 + i} d={s.d} fill={fill} stroke="#8fa1a5" stroke-width={props.compact ? 0.3 : 0.6} vector-effect="non-scaling-stroke"
            style={props.onSelect ? { cursor: 'pointer' } : undefined} onClick={props.onSelect ? () => props.onSelect!(s.iso3) : undefined}>
            {!props.compact && <title>{name}{props.context ? ' · ' + props.context : ''}: {c === null ? (props.missingLabel?.[s.iso3] ?? t('chart.noData')) : `${props.valueLabel ? props.valueLabel + ': ' : ''}${smart(v as number)}`}</title>}
          </path>
        );
      })}
      {(props.points ?? []).map((p, i) => {
        const xy = project([p.lon, p.lat]); if (!xy || xy[0] < 0 || xy[0] > w || xy[1] < 0 || xy[1] > h) return null;
        const vague = p.precision === 'country' || p.precision === 'admin1';
        return (
          <g key={p.id + i} style={props.onPoint ? { cursor: 'pointer', outline: 'none' } : undefined} onClick={props.onPoint ? () => props.onPoint!(p.id) : undefined}
            tabIndex={props.onPoint ? 0 : undefined} role={props.onPoint ? 'link' : undefined} aria-label={p.label + (p.sub ? '. ' + p.sub : '')}
            onKeyDown={props.onPoint ? (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onPoint!(p.id); } } : undefined}
            onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)}>
            {vague && <circle cx={xy[0]} cy={xy[1]} r={(p.radius ?? 5) + 5} fill="#4d3900" fill-opacity="0.07" stroke="#4d3900" stroke-opacity="0.35" stroke-width="0.8" />}
            <circle cx={xy[0]} cy={xy[1]} r={(p.radius ?? 5) + (focus === i ? 2 : 0)} fill="#4d3900" fill-opacity="0.92" stroke={focus === i ? '#17272b' : '#fff'} stroke-width={focus === i ? 2.5 : 1.5} />
            {focus === i && (() => { const tx = Math.min(Math.max(xy[0], 150), w - 150); const ty = xy[1] > 60 ? xy[1] - 16 : xy[1] + 30; const txt = p.label + (p.sub ? ' · ' + p.sub : ''); return (<g pointer-events="none"><rect x={tx - 146} y={ty - 15} width="292" height="22" rx="5" fill="#fff" stroke="#8fa1a5" /><text x={tx} y={ty} text-anchor="middle" font-size="11.5" fill="#17272b">{txt.length > 52 ? txt.slice(0, 51) + '…' : txt}</text></g>); })()}
          </g>
        );
      })}
      {here && <g pointer-events="none" data-kbd-cursor><path d={here.d} fill="none" stroke="#fff" stroke-width="5" vector-effect="non-scaling-stroke" /><path d={here.d} fill="none" stroke="#17272b" stroke-width="2.5" vector-effect="non-scaling-stroke" /></g>}
    </svg>
    {keyed && <p class="small mapkbd" aria-live="polite" data-testid="map-kbd-status">{here ? <><b>{describe(here)}</b> · {t('map.kbd.enter')}</> : <span class="muted kbdhint">{t('map.kbd.hint')}</span>}</p>}
    </>
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

/** A map fitted to a set of countries (an outbreak's footprint), with a caller-supplied fill per country, rings for
 *  regions and dots only for places a notice names. It draws no lines between places: it shows where notices were
 *  published about, never a route. */
export interface FitMapProps {
  focus: string[];
  fills: Record<string, string>;
  labels?: { iso3: string; text: string }[];
  rings?: { id: string; lon: number; lat: number; label: string; solid: boolean }[];
  names?: Record<string, string>;
  notes?: Record<string, string>;
  centroids: Record<string, [number, number] | null | undefined>;
  title: string;
  height?: number;
  svgRef?: { current: SVGSVGElement | null };
  onSelect?: (iso3: string) => void;
}
export function FitMap(props: FitMapProps) {
  const [fc, setFc] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let live = true; loadBoundaries().then((x) => { if (live) setFc(x); }).catch(() => setErr(true)); return () => { live = false; }; }, []);
  const w = 960; const h = props.height ?? 520;
  const key = props.focus.slice().sort().join(',');
  const drawn = useMemo(() => {
    if (!fc) return null;
    const sel = fc.features.filter((f: any) => props.focus.includes(f.properties.iso3));
    // Fit to the middles of the countries, padded, rather than to their full outlines: far-flung territories
    // (Alaska, French Guiana) would otherwise shrink the countries that matter to a few pixels.
    const cs = props.focus.map((c) => props.centroids[c]).filter(Boolean) as [number, number][];
    const wide = !sel.length || props.focus.length > 40 || (cs.length > 1 && Math.max(...cs.map((c) => c[0])) - Math.min(...cs.map((c) => c[0])) > 150);
    const mid = wide || !cs.length ? 11 : cs.reduce((a, c) => a + c[0], 0) / cs.length;
    const proj = geoEqualEarth().rotate([-mid, 0]);
    if (wide) proj.fitExtent([[2, 2], [w - 2, h - 2]], { type: 'Sphere' } as any);
    else if (sel.length === 1) proj.fitExtent([[40, 40], [w - 40, h - 40]], sel[0]);
    else {
      const pad = 7; const pts: [number, number][] = [];
      for (const c of cs) for (const dx of [-pad, pad]) for (const dy of [-pad, pad]) pts.push([c[0] + dx, Math.max(-85, Math.min(85, c[1] + dy))]);
      proj.fitExtent([[20, 20], [w - 20, h - 20]], { type: 'MultiPoint', coordinates: pts } as any);
    }
    const path = geoPath(proj).digits(1);
    const list: Shape[] = [];
    for (const f of fc.features) { const d = path(f); if (d) list.push({ iso3: f.properties.iso3, name: f.properties.name, d, cx: NaN, cy: NaN, area: 0 }); }
    return { list, project: (ll: [number, number]) => proj(ll) as [number, number] | null };
  }, [fc, key, h]);
  if (err) return <div class="notice warn" role="alert">{t('map.failed')}</div>;
  if (!drawn) return <div role="status" class="small muted">{t('state.loadingMap')}</div>;
  const inside = (xy: [number, number] | null) => xy && xy[0] >= 0 && xy[0] <= w && xy[1] >= 0 && xy[1] <= h;
  return (
    <svg ref={props.svgRef as any} viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={props.title} class="staticmap" style={{ display: 'block', background: '#eef3f4', borderRadius: '8px' }}>
      <defs><pattern id="fm-adj" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fafafa" /><rect width="1.6" height="7" fill="#9aa7aa" /></pattern></defs>
      {drawn.list.map((s, i) => (
        <path key={s.iso3 + i} d={s.d} fill={props.fills[s.iso3] ?? '#fafafa'} stroke="#8fa1a5" stroke-width="0.6" vector-effect="non-scaling-stroke"
          style={props.onSelect && props.fills[s.iso3] ? { cursor: 'pointer' } : undefined} onClick={props.onSelect && props.fills[s.iso3] ? () => props.onSelect!(s.iso3) : undefined}>
          <title>{props.names?.[s.iso3] ?? s.name}{props.notes?.[s.iso3] ? ': ' + props.notes[s.iso3] : ''}</title>
        </path>
      ))}
      {(props.rings ?? []).map((r) => {
        const xy = drawn.project([r.lon, r.lat]); if (!inside(xy)) return null;
        return (
          <g key={r.id}>
            <title>{r.label}</title>
            {r.solid
              ? <circle cx={xy![0]} cy={xy![1]} r="4.5" fill="#4d3900" stroke="#fff" stroke-width="1.5" />
              : <><circle cx={xy![0]} cy={xy![1]} r="17" fill="#4d3900" fill-opacity="0.08" stroke="#4d3900" stroke-opacity="0.75" stroke-width="1.4" stroke-dasharray="4 3" /><circle cx={xy![0]} cy={xy![1]} r="2" fill="none" stroke="#4d3900" stroke-width="1" /></>}
          </g>
        );
      })}
      {(props.labels ?? []).map((l) => {
        const c = props.centroids[l.iso3]; const xy = c ? drawn.project(c) : null; if (!inside(xy)) return null;
        const wd = l.text.length * 6.4 + 12;
        return (
          <g key={l.iso3} pointer-events="none">
            <rect x={xy![0] - wd / 2} y={xy![1] - 10} width={wd} height="19" rx="4" fill="#fff" fill-opacity="0.93" stroke="#8fa1a5" stroke-width="0.8" />
            <text x={xy![0]} y={xy![1] + 4} text-anchor="middle" font-size="11.5" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill="#17272b">{l.text}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default StaticMap;

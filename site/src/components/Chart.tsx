/** Lightweight SVG line chart. All styling is inline so the SVG exports cleanly.
 *
 * Honest-uncertainty rules built in: missing periods are gaps (never zero), the "likely incomplete" region is
 * hatched and de-emphasised, and simulated or user-supplied series are dashed and labelled.
 */
import { scaleLinear, scaleLog } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import { useMemo, useRef, useState } from 'preact/hooks';
import { num, periodLabel, smart, t } from '../lib/i18n';
import type { SeriesData } from '../lib/transforms';

export const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#7a5c00', '#3b3b3b', '#8c6bb1'];
export const SIM_PALETTE = ['#6a3d9a', '#b15928', '#1b7c8c', '#a6761d', '#7570b3', '#666666'];
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export interface ChartProps {
  series: SeriesData[];
  /** 'time' = calendar axis; 'index' = periods/days since start (aligned outbreaks, simulations). */
  xMode?: 'time' | 'index';
  log?: boolean;
  height?: number;
  yLabel?: string;
  xLabel?: string;
  ariaLabel: string;
  svgRef?: { current: SVGSVGElement | null };
  marks?: { x: string | number; label: string }[];
  /** Horizontal reference line (e.g. a capacity line in a challenge). */
  hline?: { y: number; label: string };
  /** Shaded bands (e.g. intervention windows), in x units. */
  bands?: { x0: number | string; x1: number | string; label: string }[];
  /** Interval ribbons for ensembles: series id -> lower/upper. */
  ribbons?: { id: string; lo: (number | null)[]; hi: (number | null)[] }[];
  simulated?: boolean;
  onBrush?: (from: string, to: string) => void;
  compact?: boolean;
  /** Epi-curve style: one bar per period. */
  bars?: boolean;
}

const ms = (p: string) => Date.parse(p + 'T00:00:00Z');

export function Chart(props: ChartProps) {
  const { series, log, yLabel, xLabel, ariaLabel, marks, hline, bands, ribbons, compact } = props;
  const xMode = props.xMode ?? 'time';
  const W = 760; const H = props.height ?? (compact ? 220 : 340);
  const M = { t: 14, r: 16, b: xLabel ? 46 : 32, l: 56 };
  const [hover, setHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const xs = (s: SeriesData) => (xMode === 'time' ? s.p.map(ms) : s.p.map((p, i) => (isNaN(Number(p)) ? i : Number(p))));
    let x0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let ymin = Infinity;
    const data = series.map((s, si) => {
      const x = xs(s);
      for (let i = 0; i < x.length; i++) {
        const v = s.v[i];
        if (x[i] < x0) x0 = x[i];
        if (x[i] > x1) x1 = x[i];
        if (v !== null && Number.isFinite(v)) { if (v > y1) y1 = v; if (v > 0 && v < ymin) ymin = v; }
      }
      return { s, x, color: s.color ?? (s.simulated ? SIM_PALETTE : PALETTE)[si % 8 % (s.simulated ? SIM_PALETTE.length : PALETTE.length)] };
    });
    for (const r of ribbons ?? []) for (const v of r.hi) if (v !== null && v > y1) y1 = v;
    if (hline && hline.y > y1) y1 = hline.y;
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; }
    if (!Number.isFinite(y1) || y1 <= 0) y1 = 1;
    if (x0 === x1) x1 = x0 + 1;
    const sx = scaleLinear().domain([x0, x1]).range([M.l, W - M.r]);
    const useLog = !!log && Number.isFinite(ymin);
    const sy = useLog ? scaleLog().domain([Math.max(ymin * 0.8, 1e-6), y1 * 1.15]).range([H - M.b, M.t]).clamp(true)
      : scaleLinear().domain([0, y1 * 1.08]).range([H - M.b, M.t]).nice();
    return { data, sx, sy, x0, x1, useLog };
  }, [series, xMode, log, H, ribbons, hline?.y]);

  const { data, sx, sy, useLog } = model;
  const yTicks = (sy as any).ticks(useLog ? 4 : 5) as number[];
  const xTicks = useMemo(() => {
    if (xMode === 'index') return sx.ticks(8).map((v) => ({ v, label: num(v) }));
    const span = model.x1 - model.x0; const day = 86400000;
    const out: { v: number; label: string }[] = [];
    const d = new Date(model.x0);
    if (span > 5 * 366 * day) {
      const step = span > 25 * 366 * day ? 5 : span > 12 * 366 * day ? 2 : 1;
      for (let y = d.getUTCFullYear() + 1; ; y++) { const v = Date.UTC(y, 0, 1); if (v > model.x1) break; if (y % step === 0) out.push({ v, label: String(y) }); }
    } else {
      const stepM = span > 3 * 366 * day ? 6 : span > 366 * day ? 3 : span > 180 * day ? 2 : 1;
      const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      while (c.getTime() <= model.x1) {
        if (c.getUTCMonth() % stepM === 0) out.push({ v: c.getTime(), label: new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(c) });
        c.setUTCMonth(c.getUTCMonth() + 1);
      }
    }
    return out;
  }, [model.x0, model.x1, xMode]);

  // incomplete region: from the earliest incomplete period among the series to the right edge
  const incX = xMode === 'time' ? series.map((s) => s.incompleteFrom).filter((x): x is string => !!x && s_has(series, x)).sort()[0] : undefined;
  const incPx = incX ? Math.max(M.l, sx(ms(incX) - 3.5 * 86400000)) : null;

  const longest = data.reduce((a, b) => (b.x.length > a.x.length ? b : a), data[0] ?? { x: [] as number[], s: null as any, color: '' });
  const idxAt = (clientX: number): number | null => {
    const el = wrap.current?.querySelector('svg'); if (!el || !longest.x.length) return null;
    const r = el.getBoundingClientRect();
    const xv = sx.invert(((clientX - r.left) / r.width) * W);
    let best = 0; let bd = Infinity;
    longest.x.forEach((x, i) => { const dd = Math.abs(x - xv); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  const hx = hover !== null && longest.x[hover] !== undefined ? longest.x[hover] : null;
  const tipRows = hx === null ? [] : data.map((d) => {
    let j = -1; let bd = Infinity;
    d.x.forEach((x, i) => { const dd = Math.abs(x - hx); if (dd < bd) { bd = dd; j = i; } });
    const tol = xMode === 'time' ? 16 * 86400000 : 0.51;
    return { d, v: j >= 0 && bd <= tol ? d.s.v[j] : null, inc: j >= 0 && !!d.s.incompleteFrom && d.s.p[j] >= d.s.incompleteFrom && xMode === 'time' };
  });
  const xText = hx === null ? '' : xMode === 'time' ? periodLabel(new Date(hx).toISOString().slice(0, 10), longest.s?.ptype ?? 'W') : `${xLabel ?? ''} ${num(hx)}`.trim();
  const toX = (x: string | number) => (typeof x === 'number' ? sx(x) : sx(ms(x)));

  const onKey = (e: KeyboardEvent) => {
    if (!longest.x.length) return;
    if (e.key === 'ArrowRight') { setHover((h) => Math.min(longest.x.length - 1, (h ?? -1) + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setHover((h) => Math.max(0, (h ?? longest.x.length) - 1)); e.preventDefault(); }
    if (e.key === 'Home') { setHover(0); e.preventDefault(); }
    if (e.key === 'End') { setHover(longest.x.length - 1); e.preventDefault(); }
    if (e.key === 'Escape') setHover(null);
  };

  return (
    <div class="chart" ref={wrap}>
      <svg ref={props.svgRef as any} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey as any}
        onPointerMove={(e) => { const i = idxAt(e.clientX); setHover(i); if (brush && i !== null) setBrush([brush[0], i]); }}
        onPointerLeave={() => { setHover(null); }}
        onPointerDown={(e) => { if (props.onBrush) { const i = idxAt(e.clientX); if (i !== null) setBrush([i, i]); } }}
        onPointerUp={() => { if (brush && props.onBrush && longest.s && brush[0] !== brush[1]) { const a = Math.min(...brush); const b = Math.max(...brush); props.onBrush(longest.s.p[a], longest.s.p[b]); } setBrush(null); }}
        font-family={FONT}>
        <defs>
          <pattern id="uo-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f2f2f2" /><line x1="0" y1="0" x2="0" y2="6" stroke="#c9c9c9" stroke-width="2" /></pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        {yTicks.map((v) => (
          <g key={'y' + v}>
            <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="#e6ecee" stroke-width="1" />
            <text x={M.l - 6} y={sy(v) + 4} text-anchor="end" font-size="11" fill="#4a5b5f">{smart(v)}</text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <g key={'x' + tk.v}>
            <line x1={sx(tk.v)} x2={sx(tk.v)} y1={H - M.b} y2={H - M.b + 4} stroke="#9aa8ab" />
            <text x={sx(tk.v)} y={H - M.b + 16} text-anchor="middle" font-size="11" fill="#4a5b5f">{tk.label}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="#9aa8ab" />
        {yLabel && <text x={12} y={M.t + 2} font-size="11" fill="#4a5b5f" transform={`rotate(-90 12 ${M.t + 2})`} text-anchor="end">{yLabel}</text>}
        {xLabel && <text x={(W + M.l - M.r) / 2} y={H - 6} font-size="11" fill="#4a5b5f" text-anchor="middle">{xLabel}</text>}
        {(bands ?? []).map((b, i) => (
          <g key={'b' + i}>
            <rect x={toX(b.x0)} y={M.t} width={Math.max(1, toX(b.x1) - toX(b.x0))} height={H - M.b - M.t} fill="#d9e8f5" opacity="0.55" />
            <text x={toX(b.x0) + 3} y={M.t + 11} font-size="10" fill="#27506e">{b.label}</text>
          </g>
        ))}
        {incPx !== null && incPx < W - M.r && (
          <g data-testid="incomplete-region">
            <rect x={incPx} y={M.t} width={W - M.r - incPx} height={H - M.b - M.t} fill="url(#uo-hatch)" opacity="0.85"><title>{t('chart.incompleteTip')}</title></rect>
            <text x={Math.min(incPx + 3, W - M.r - 4)} y={M.t + 11} font-size="10" fill="#555" text-anchor={incPx > W - 150 ? 'end' : 'start'}>{t('chart.incomplete')}</text>
          </g>
        )}
        {(ribbons ?? []).map((r) => {
          const d = data.find((x) => x.s.id === r.id); if (!d) return null;
          const up: string[] = []; const dn: string[] = [];
          d.x.forEach((x, i) => { const lo = r.lo[i]; const hi = r.hi[i]; if (lo === null || hi === null) return; up.push(`${sx(x)},${sy(Math.max(hi, useLog ? 1e-6 : 0))}`); dn.unshift(`${sx(x)},${sy(Math.max(lo, useLog ? 1e-6 : 0))}`); });
          return <polygon key={'r' + r.id} points={[...up, ...dn].join(' ')} fill={d.color} opacity="0.16" />;
        })}
        {hline && (
          <g><line x1={M.l} x2={W - M.r} y1={sy(hline.y)} y2={sy(hline.y)} stroke="#3b3b3b" stroke-width="1.5" stroke-dasharray="2 4" />
            <text x={W - M.r - 4} y={sy(hline.y) - 5} font-size="11" fill="#3b3b3b" text-anchor="end">{hline.label}</text></g>
        )}
        {data.map((d) => {
          const pts = d.x.map((x, i) => ({ x, v: d.s.v[i], inc: !!d.s.incompleteFrom && xMode === 'time' && d.s.p[i] >= d.s.incompleteFrom }));
          const gen = d3line<{ x: number; v: number | null }>().defined((p) => p.v !== null && Number.isFinite(p.v) && (!useLog || (p.v as number) > 0)).x((p) => sx(p.x)).y((p) => sy(p.v as number));
          const solid = pts.filter((p) => !p.inc);
          const firstInc = pts.findIndex((p) => p.inc);
          const incPts = firstInc > 0 ? pts.slice(firstInc - 1) : firstInc === 0 ? pts : [];
          if (props.bars) {
            const step = d.x.length > 1 ? Math.abs(sx(d.x[1]) - sx(d.x[0])) : 12;
            const bw = Math.max(1, (step * 0.84) / data.length);
            const off = data.indexOf(d) * bw - (bw * data.length) / 2;
            return (
              <g key={d.s.id}>
                {pts.map((p, i) => (p.v === null || !Number.isFinite(p.v) || (useLog && p.v <= 0) ? null : (
                  <rect key={i} x={sx(p.x) + off} y={sy(p.v)} width={bw} height={Math.max(0, H - M.b - sy(p.v))} fill={d.color} opacity={p.inc ? 0.4 : 0.9} stroke={p.inc ? d.color : 'none'} stroke-dasharray={p.inc ? '2 2' : undefined} />
                )))}
              </g>
            );
          }
          const dash = d.s.simulated || d.s.dashed ? '7 4' : d.s.userSupplied ? '2 3' : undefined;
          const isolated = pts.filter((p, i) => p.v !== null && (pts[i - 1]?.v ?? null) === null && (pts[i + 1]?.v ?? null) === null);
          return (
            <g key={d.s.id}>
              <path d={gen(solid) ?? ''} fill="none" stroke={d.color} stroke-width={compact ? 1.6 : 2} stroke-dasharray={dash} stroke-linejoin="round" />
              {incPts.length > 0 && <path d={gen(incPts) ?? ''} fill="none" stroke={d.color} stroke-width="1.4" stroke-dasharray="3 3" opacity="0.55" />}
              {isolated.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.v as number)} r="2.2" fill={d.color} opacity={p.inc ? 0.55 : 1} />)}
            </g>
          );
        })}
        {(marks ?? []).map((m, i) => (
          <g key={'m' + i}><line x1={toX(m.x)} x2={toX(m.x)} y1={M.t} y2={H - M.b} stroke="#7a5c00" stroke-dasharray="2 3" />
            <path d={`M${toX(m.x) - 5},${M.t} l10,0 l-5,7 z`} fill="#7a5c00"><title>{m.label}</title></path></g>
        ))}
        {props.simulated && <text x={W - M.r - 4} y={H - M.b - 6} text-anchor="end" font-size="11" font-weight="700" fill="#6a3d9a" opacity="0.9" letter-spacing="0.5">{t('sim.watermarkShort')}</text>}
        {brush && longest.x.length > 0 && (
          <rect data-noexport x={Math.min(sx(longest.x[brush[0]]), sx(longest.x[brush[1]]))} y={M.t} width={Math.abs(sx(longest.x[brush[1]]) - sx(longest.x[brush[0]]))} height={H - M.b - M.t} fill="#0b6e75" opacity="0.15" />
        )}
        {hx !== null && <line data-noexport x1={sx(hx)} x2={sx(hx)} y1={M.t} y2={H - M.b} stroke="#17272b" stroke-width="1" opacity="0.5" />}
      </svg>
      {hx !== null && (
        <div class="tip" role="status" aria-live="polite" style={{ left: `${Math.min(70, Math.max(2, (sx(hx) / W) * 100))}%`, top: '4px' }}>
          <b>{xText}</b>
          {tipRows.map((r) => (
            <div key={r.d.s.id}><span style={{ color: r.d.color }}>●</span> {r.d.s.label}: <b>{r.v === null ? t('chart.noData') : smart(r.v)}</b>{r.inc && <> <span class="badge inc">{t('chart.incompleteShort')}</span></>}</div>
          ))}
        </div>
      )}
      {!compact && (
        <ul class="legend">
          {data.map((d) => (
            <li key={d.s.id}><span class={'sw' + (d.s.simulated || d.s.dashed || d.s.userSupplied ? ' dash' : '')} style={{ borderColor: d.color }} />{d.s.label}
              {d.s.simulated && <> <span class="badge sim">{t('sim.simulated')}</span></>}{d.s.userSupplied && <> <span class="badge">{t('origin.user-supplied')}</span></>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function s_has(series: SeriesData[], period: string): boolean {
  return series.some((s) => s.p.length > 0 && s.p[s.p.length - 1] >= period);
}

export function Sparkline({ p, v, incompleteFrom, label }: { p: string[]; v: (number | null)[]; incompleteFrom?: string; label: string }) {
  const W = 120; const H = 30;
  const vals = v.filter((x): x is number => x !== null);
  if (vals.length < 2) return <span class="muted small">{t('chart.noData')}</span>;
  const max = Math.max(...vals, 1);
  const sx = (i: number) => 2 + (i / (v.length - 1)) * (W - 4);
  const sy = (x: number) => H - 3 - (x / max) * (H - 6);
  const cut = incompleteFrom ? p.findIndex((x) => x >= incompleteFrom) : -1;
  const seg = (from: number, to: number) => {
    let d = ''; let pen = false;
    for (let i = from; i < to; i++) { const x = v[i]; if (x === null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(x).toFixed(1)}`; pen = true; }
    return d;
  };
  const end = cut >= 0 ? cut : v.length;
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={seg(0, end)} fill="none" stroke="#0b6e75" stroke-width="1.5" />
      {cut > 0 && <path d={seg(cut - 1, v.length)} fill="none" stroke="#9aa8ab" stroke-width="1.2" stroke-dasharray="2 2" />}
    </svg>
  );
}

/** View transforms for time series. Pure functions; the same code feeds charts, tables, exports and "copy as code".
 *
 * Order of application (fixed, documented in the methodology):
 *   1. per-capita  2. rolling average  3. cumulative  4. rebase to peak  5. align by first report  (log scale is display-only)
 */
import type { PType } from './data';

export interface TransformState {
  perCapita: boolean;
  rolling: number;       // window in periods; 0 or 1 = off
  cumulative: boolean;
  rebase: boolean;       // each series as % of its own peak
  align: boolean;        // x = periods since the first reported non-zero value
  log: boolean;
  excludeIncomplete: boolean;
}
export const NO_TRANSFORMS: TransformState = { perCapita: false, rolling: 0, cumulative: false, rebase: false, align: false, log: false, excludeIncomplete: false };

export interface SeriesData { id: string; label: string; p: string[]; v: (number | null)[]; ptype: PType; population?: number | null; incompleteFrom?: string; simulated?: boolean; userSupplied?: boolean; color?: string; dashed?: boolean; skey?: string; iso3?: string }

export function perCapita(v: (number | null)[], population: number | null | undefined): (number | null)[] {
  if (!population) return v.map(() => null);
  return v.map((x) => (x === null ? null : (x / population) * 1e5));
}

/** Trailing mean over `window` periods. A window with any missing value yields null (no silent gap filling). */
export function rolling(v: (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return v.slice();
  const out: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    if (i < window - 1) { out.push(null); continue; }
    let s = 0; let ok = true;
    for (let j = i - window + 1; j <= i; j++) { const x = v[j]; if (x === null) { ok = false; break; } s += x; }
    out.push(ok ? s / window : null);
  }
  return out;
}

/** Running total. Missing periods add nothing and are shown as missing. */
export function cumulative(v: (number | null)[]): (number | null)[] {
  let s = 0;
  return v.map((x) => { if (x === null) return null; s += x; return s; });
}

export function rebaseToPeak(v: (number | null)[]): (number | null)[] {
  let peak = 0;
  for (const x of v) if (x !== null && x > peak) peak = x;
  if (peak <= 0) return v.map((x) => (x === null ? null : 0));
  return v.map((x) => (x === null ? null : (x / peak) * 100));
}

/** Index of the first reported value above zero, or -1. */
export function firstReportIndex(v: (number | null)[]): number {
  return v.findIndex((x) => x !== null && x > 0);
}

export function applyTransforms(s: SeriesData, tr: TransformState): SeriesData {
  let p = s.p.slice();
  let v = s.v.slice();
  if (tr.excludeIncomplete && s.incompleteFrom) {
    const cut = p.findIndex((x) => x >= s.incompleteFrom!);
    if (cut >= 0) { p = p.slice(0, cut); v = v.slice(0, cut); }
  }
  if (tr.perCapita) v = perCapita(v, s.population);
  if (tr.rolling > 1) v = rolling(v, tr.rolling);
  if (tr.cumulative) v = cumulative(v);
  if (tr.rebase) v = rebaseToPeak(v);
  if (tr.align) {
    const i = firstReportIndex(s.v);
    if (i >= 0) { p = p.slice(i); v = v.slice(i); } else { p = []; v = []; }
  }
  return { ...s, p, v };
}

export function activeTransformKeys(tr: TransformState): string[] {
  const out: string[] = [];
  if (tr.perCapita) out.push('perCapita');
  if (tr.rolling > 1) out.push('rolling');
  if (tr.cumulative) out.push('cumulative');
  if (tr.rebase) out.push('rebase');
  if (tr.align) out.push('align');
  if (tr.log) out.push('log');
  if (tr.excludeIncomplete) out.push('excludeIncomplete');
  return out;
}

export function transformsToParam(tr: TransformState): string {
  const parts: string[] = [];
  if (tr.perCapita) parts.push('pc');
  if (tr.rolling > 1) parts.push('r' + tr.rolling);
  if (tr.cumulative) parts.push('cum');
  if (tr.rebase) parts.push('peak');
  if (tr.align) parts.push('align');
  if (tr.log) parts.push('log');
  if (tr.excludeIncomplete) parts.push('xi');
  return parts.join('.');
}

export function transformsFromParam(s: string | null | undefined): TransformState {
  const tr = { ...NO_TRANSFORMS };
  for (const part of (s ?? '').split('.')) {
    if (part === 'pc') tr.perCapita = true;
    else if (/^r\d+$/.test(part)) tr.rolling = Math.min(52, parseInt(part.slice(1), 10));
    else if (part === 'cum') tr.cumulative = true;
    else if (part === 'peak') tr.rebase = true;
    else if (part === 'align') tr.align = true;
    else if (part === 'log') tr.log = true;
    else if (part === 'xi') tr.excludeIncomplete = true;
  }
  return tr;
}

/** Year-over-year overlay: one series per calendar year on a shared within-year axis. */
export function yearOverYear(p: string[], v: (number | null)[], ptype: PType): { year: number; x: number[]; v: (number | null)[] }[] {
  const byYear = new Map<number, { x: number[]; v: (number | null)[] }>();
  p.forEach((period, i) => {
    const d = new Date(period + 'T00:00:00Z');
    let year = d.getUTCFullYear();
    let x: number;
    if (ptype === 'M') x = d.getUTCMonth() + 1;
    else {
      const { isoYear, isoWeek } = isoWeekOf(d);
      year = isoYear; x = isoWeek;
    }
    if (!byYear.has(year)) byYear.set(year, { x: [], v: [] });
    const e = byYear.get(year)!;
    e.x.push(x); e.v.push(v[i]);
  });
  return Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, ...e }));
}

export function isoWeekOf(d: Date): { isoYear: number; isoWeek: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { isoYear: t.getUTCFullYear(), isoWeek: Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}
